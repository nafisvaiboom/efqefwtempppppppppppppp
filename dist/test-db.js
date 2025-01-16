import { initializeDatabase } from './db/init.js';

async function testDatabaseConnection() {
  try {
    console.log('Testing database connection...');
    await initializeDatabase();
    console.log('✅ Database connection successful!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

testDatabaseConnection();