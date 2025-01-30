import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth.js';
import { pool } from '../db/init.js';  // Updated import statement

const router = express.Router();

// Get a specific temporary email
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [emails] = await pool.query(
      'SELECT * FROM temp_emails WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (emails.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    res.json(emails[0]);
  } catch (error) {
    res.status(400).json({ error: 'Failed to fetch email' });
  }
});

// Get received emails for a specific temporary email
router.get('/:id/received', authenticateToken, async (req, res) => {
  try {
    const [emails] = await pool.query(`
      SELECT re.*, te.email as temp_email
      FROM received_emails re
      JOIN temp_emails te ON re.temp_email_id = te.id
      WHERE te.id = ? AND te.user_id = ?
      ORDER BY re.received_at DESC
    `, [req.params.id, req.user.id]);

    res.json(emails);
  } catch (error) {
    res.status(400).json({ error: 'Failed to fetch received emails' });
  }
});

router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { email, domainId } = req.body;
    const id = uuidv4();
    
    // Set expiry date to 2 months from now
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 2);

    const [result] = await pool.query(
      'INSERT INTO temp_emails (id, user_id, email, domain_id, expires_at) VALUES (?, ?, ?, ?, ?)',
      [id, req.user.id, email, domainId, expiresAt]
    );

    const [createdEmail] = await pool.query(
      'SELECT * FROM temp_emails WHERE id = ?',
      [id]
    );

    res.json(createdEmail[0]);
  } catch (error) {
    console.error('Create email error:', error);
    res.status(400).json({ error: 'Failed to create temporary email' });
  }
});

router.delete('/delete/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await pool.query(
      'DELETE FROM temp_emails WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    res.json({ message: 'Email deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Failed to delete email' });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const [emails] = await pool.query(
      'SELECT * FROM temp_emails WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(emails);
  } catch (error) {
    res.status(400).json({ error: 'Failed to fetch emails' });
  }
});

export default router;
// Get public emails (no auth required)
router.get('/public/:email', async (req, res) => {
  try {
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
router.post('/public/create', async (req, res) => {
  try {
    const { email, domainId } = req.body;
    const id = uuidv4();
    
    // Set expiry date to 48 hours from now
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    const [result] = await pool.query(
      'INSERT INTO temp_emails (id, email, domain_id, expires_at) VALUES (?, ?, ?, ?)',
      [id, email, domainId, expiresAt]
    );

    const [createdEmail] = await pool.query(
      'SELECT * FROM temp_emails WHERE id = ?',
      [id]
    );

    res.json(createdEmail[0]);
  } catch (error) {
    console.error('Create public email error:', error);
    res.status(400).json({ error: 'Failed to create temporary email' });
  }
});
