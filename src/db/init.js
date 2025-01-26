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
const pool = mysql.createPool({
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
  maxIdle: 10, // max idle connections, equal to connectionLimit
  idleTimeout: 60000, // 60 seconds
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
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

export async function initializeDatabase() {
  let retries = 5;
  while (retries > 0) {
    try {
      console.log('Attempting to connect to database...');
      
      const connection = await pool.getConnection();
      
      // Test the connection
      await connection.query('SELECT 1');
      
      // Set session variables
      await connection.query(`
        SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
        SET time_zone = '+00:00';
      `);
      
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

async function initializeTables(connection) {
  // Update received_emails table
  await connection.query(`
    ALTER TABLE received_emails 
    ADD COLUMN IF NOT EXISTS body_html LONGTEXT,
    ADD COLUMN IF NOT EXISTS body_text LONGTEXT,
    ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_spam BOOLEAN DEFAULT FALSE;
  `);

  // Update email_attachments table
  await connection.query(`
    ALTER TABLE email_attachments 
    ADD COLUMN IF NOT EXISTS content LONGTEXT,
    ADD COLUMN IF NOT EXISTS size BIGINT,
    ADD COLUMN IF NOT EXISTS filename VARCHAR(255),
    ADD COLUMN IF NOT EXISTS is_inline BOOLEAN DEFAULT FALSE;
  `);
}

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

export default pool;
