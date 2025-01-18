import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000, // Increased timeout for more reliable connections
  ssl: {
    rejectUnauthorized: false // Required for some hosting providers
  }
});

export async function initializeDatabase() {
  try {
    console.log('Attempting to connect to database...');
    console.log('Database host:', process.env.DB_HOST);
    
    const connection = await pool.getConnection();
    console.log('Successfully connected to database');
    
    // Create tables with proper foreign key constraints and indexes
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_email (email)
      );
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS domains (
        id VARCHAR(36) PRIMARY KEY,
        domain VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_domain_name (domain)
      );
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS temp_emails (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        domain_id VARCHAR(36) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
        INDEX idx_temp_email (email),
        INDEX idx_user_id (user_id),
        INDEX idx_expiry (expires_at)
      );
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS received_emails (
        id VARCHAR(36) PRIMARY KEY,
        temp_email_id VARCHAR(36) NOT NULL,
        from_email VARCHAR(255) NOT NULL,
        subject TEXT,
        body LONGTEXT,
        received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (temp_email_id) REFERENCES temp_emails(id) ON DELETE CASCADE,
        INDEX idx_temp_email_id (temp_email_id),
        INDEX idx_received_at (received_at),
        INDEX idx_email_created_at (created_at)
      );
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS email_attachments (
        id VARCHAR(36) PRIMARY KEY,
        email_id VARCHAR(36) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        content_type VARCHAR(100),
        size BIGINT,
        url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (email_id) REFERENCES received_emails(id) ON DELETE CASCADE,
        INDEX idx_email_id (email_id),
        INDEX idx_attachment_filename (filename)
      );
    `);

    connection.release();
    console.log('Database initialized successfully');
    return pool;
  } catch (error) {
    console.error('Error initializing database:', error);
    console.error('Error details:', error.message);
    throw error;
  }
}

export default pool;