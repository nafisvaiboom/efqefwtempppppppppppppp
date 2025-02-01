import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/init.js';
import { isBot } from '../utils/botDetection.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiter for email creation
const createEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 email creations per windowMs
  message: { error: 'Too many email addresses created from this IP, please try again later.' }
});

// Get a specific temporary email
router.get('/:id', async (req, res) => {
  try {
    const [emails] = await pool.query(
      'SELECT * FROM temp_emails WHERE id = ?',
      [req.params.id]
    );

    if (emails.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    res.json(emails[0]);
  } catch (error) {
    console.error('Failed to fetch email:', error);
    res.status(400).json({ error: 'Failed to fetch email' });
  }
});

// Get received emails for a specific temporary email
router.get('/:id/received', async (req, res) => {
  try {
    const [emails] = await pool.query(`
      SELECT re.*, te.email as temp_email
      FROM received_emails re
      JOIN temp_emails te ON re.temp_email_id = te.id
      WHERE te.id = ?
      ORDER BY re.received_at DESC
    `, [req.params.id]);

    res.json(emails);
  } catch (error) {
    console.error('Failed to fetch received emails:', error);
    res.status(400).json({ error: 'Failed to fetch received emails' });
  }
});

// Get public emails (no auth required)
router.get('/public/:email', async (req, res) => {
  try {
    // Set cache headers
    res.setHeader('Cache-Control', 'public, max-age=5'); // Cache for 5 seconds
    
    const [emails] = await pool.query(`
      SELECT re.*, te.email as temp_email
      FROM received_emails re
      JOIN temp_emails te ON re.temp_email_id = te.id
      WHERE te.email = ?
      ORDER BY re.received_at DESC
    `, [req.params.email]);

    res.json(emails);
  } catch (error) {
    console.error('Failed to fetch public emails:', error);
    res.status(400).json({ error: 'Failed to fetch emails' });
  }
});

// Create public temporary email (no auth required)
router.post('/public/create', createEmailLimiter, async (req, res) => {
  try {
    // Check if request is from a bot
    if (isBot(req)) {
      // Return a demo email for bots
      return res.status(200).json({
        id: 'demo-id',
        email: 'demo@boomlify.com',
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString()
      });
    }

    const { email, domainId } = req.body;
    const id = uuidv4();
    
    // Set expiry date to 48 hours from now
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    try {
      // First try to find if email already exists and is still valid
      const [existingEmails] = await pool.query(
        'SELECT * FROM temp_emails WHERE email = ? AND expires_at > NOW()',
        [email]
      );

      if (existingEmails.length > 0) {
        return res.json(existingEmails[0]);
      }

      // If no existing valid email, create new one
      await pool.query(
        'INSERT INTO temp_emails (id, email, domain_id, expires_at) VALUES (?, ?, ?, ?)',
        [id, email, domainId, expiresAt]
      );

      const [createdEmail] = await pool.query(
        'SELECT * FROM temp_emails WHERE id = ?',
        [id]
      );

      res.json(createdEmail[0]);
    } catch (error) {
      // Handle duplicate email error gracefully
      if (error.code === 'ER_DUP_ENTRY') {
        const [existingEmail] = await pool.query(
          'SELECT * FROM temp_emails WHERE email = ?',
          [email]
        );
        
        if (existingEmail.length > 0) {
          return res.json(existingEmail[0]);
        }
      }
      throw error;
    }
  } catch (error) {
    console.error('Create public email error:', error);
    // Return 200 status for bots to prevent soft 404
    if (isBot(req)) {
      return res.status(200).json({
        id: 'demo-id',
        email: 'demo@boomlify.com',
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString()
      });
    }
    res.status(400).json({ error: 'Failed to create temporary email' });
  }
});

export default router;
