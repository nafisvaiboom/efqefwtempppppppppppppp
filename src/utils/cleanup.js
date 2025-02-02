import { pool } from '../db/init.js';  // Updated import statement

export async function cleanupOldEmails() {
  try {
    console.log('Starting email cleanup process...');
    
    // Delete emails older than 3 days
    const [result] = await pool.query(`
      DELETE FROM received_emails 
      WHERE received_at < DATE_SUB(NOW(), INTERVAL 3 DAY)
    `);

    console.log(`Cleanup completed. Deleted ${result.affectedRows} old emails.`);
    
    // Cleanup any orphaned attachments
    await pool.query(`
      DELETE FROM email_attachments 
      WHERE email_id NOT IN (SELECT id FROM received_emails)
    `);
    
    return result.affectedRows;
  } catch (error) {
    console.error('Error during email cleanup:', error);
    throw error;
  }
}