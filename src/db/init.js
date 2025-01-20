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
  debug: process.env.NODE_ENV !== 'production'
});

export async function initializeDatabase() {
  let retries = 5;
  while (retries > 0) {
    try {
      console.log('Attempting to connect to database...');
      console.log('Database host:', process.env.DB_HOST);
      
      const connection = await pool.getConnection();
      console.log('Successfully connected to database');
      
      // Test the connection
      await connection.query('SELECT 1');
      console.log('Database connection test successful');
      
      // Set session variables one at a time
      await connection.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
      await connection.query("SET time_zone = '+00:00'");
      
      connection.release();
      return pool;
    } catch (error) {
      console.error(`Database connection attempt failed (${retries} retries left):`, error);
      retries--;
      if (retries === 0) {
        console.error('All database connection attempts failed');
        throw error;
      }
      // Wait 5 seconds before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
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
