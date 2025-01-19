import pool from '../db/init.js';

export async function cleanupOldEmails() {
  const DAYS_TO_KEEP = 4; // Keep emails for 4 days
  
  try {
    console.log('Starting email cleanup process...');
    
    // Delete emails older than DAYS_TO_KEEP days
    const [result] = await pool.query(`
      DELETE FROM received_emails 
      WHERE received_at < DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [DAYS_TO_KEEP]);

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