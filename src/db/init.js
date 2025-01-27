import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  process.exit(1);
}

// Production-ready pool configuration
export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  
  // Connection settings
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000,
  
  // Production SSL settings
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : undefined,
  
  // Connection resilience
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  
  // Timezone handling
  timezone: 'Z',
  
  // Debug in development only
  debug: process.env.NODE_ENV !== 'production',

  // Pool specific settings
  maxIdle: 10,
  idleTimeout: 60000,
});

// Only log pool events in development
if (process.env.NODE_ENV !== 'production') {
  pool.on('acquire', function (connection) {
    console.log('Connection %d acquired', connection.threadId);
  });

  pool.on('connection', function (connection) {
    console.log('New connection %d created', connection.threadId);
  });

  pool.on('enqueue', function () {
    console.warn('Waiting for available connection slot');
  });

  pool.on('release', function (connection) {
    console.log('Connection %d released', connection.threadId);
  });
}

// Add error handler for the pool
pool.on('error', function (err) {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Initialize database with retry logic
export async function initializeDatabase() {
  let retries = 5;
  while (retries > 0) {
    try {
      console.log('Attempting to connect to database...');
      
      const connection = await pool.getConnection();
      
      // Test the connection
      await connection.query('SELECT 1');
      
      // Set session variables
      await connection.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
      await connection.query("SET time_zone = '+00:00'");
      
      // Initialize tables
      await initializeTables(connection);

      connection.release();
      console.log('Database initialized successfully');
      return pool;
    } catch (error) {
      console.error(`Database connection attempt failed (${retries} retries left):`, error);
      retries--;
      if (retries === 0) {
        console.error('All database connection attempts failed');
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Initialize database tables
async function initializeTables(connection) {
  // Users table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      google_id VARCHAR(255) UNIQUE,
      is_admin BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMP
    );
  `);

  // Domains table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS domains (
      id VARCHAR(36) PRIMARY KEY,
      domain VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Temporary emails table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS temp_emails (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      domain_id VARCHAR(36) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
    );
  `);

  // Received emails table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS received_emails (
      id VARCHAR(36) PRIMARY KEY,
      temp_email_id VARCHAR(36) NOT NULL,
      from_email VARCHAR(255) NOT NULL,
      subject TEXT,
      body_html LONGTEXT,
      body_text LONGTEXT,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_read BOOLEAN DEFAULT FALSE,
      is_starred BOOLEAN DEFAULT FALSE,
      is_archived BOOLEAN DEFAULT FALSE,
      is_spam BOOLEAN DEFAULT FALSE,
      FOREIGN KEY (temp_email_id) REFERENCES temp_emails(id) ON DELETE CASCADE
    );
  `);

  // Email attachments table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS email_attachments (
      id VARCHAR(36) PRIMARY KEY,
      email_id VARCHAR(36) NOT NULL,
      filename VARCHAR(255),
      content_type VARCHAR(100),
      content LONGTEXT,
      size BIGINT,
      is_inline BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (email_id) REFERENCES received_emails(id) ON DELETE CASCADE
    );
  `);
}

// Check database connection health
export async function checkDatabaseConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.query('SELECT 1');
    connection.release();
    return true;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}