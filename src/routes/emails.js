import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth.js';
import pool from '../db/init.js';

const router = express.Router();

router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { email, domainId } = req.body;
    const id = uuidv4();
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 2);

    await pool.query(
      'INSERT INTO temp_emails (id, user_id, email, domain_id, expires_at) VALUES (?, ?, ?, ?, ?)',
      [id, req.user.id, email, domainId, expiresAt]
    );

    res.json({ id, email, expiresAt });
  } catch (error) {
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

router.get('/received', authenticateToken, async (req, res) => {
  try {
    const [emails] = await pool.query(`
      SELECT re.*, te.email as temp_email
      FROM received_emails re
      JOIN temp_emails te ON re.temp_email_id = te.id
      WHERE te.user_id = ?
      ORDER BY re.received_at DESC
    `, [req.user.id]);

    res.json(emails);
  } catch (error) {
    res.status(400).json({ error: 'Failed to fetch emails' });
  }
});

router.post('/receive', async (req, res) => {
  try {
    const { recipient, sender, subject, body } = req.body;
    const [tempEmails] = await pool.query(
      'SELECT id FROM temp_emails WHERE email = ?',
      [recipient]
    );

    if (tempEmails.length === 0) {
      return res.status(404).json({ error: 'Temporary email not found' });
    }

    const id = uuidv4();
    await pool.query(`
      INSERT INTO received_emails (id, temp_email_id, from_email, subject, body)
      VALUES (?, ?, ?, ?, ?)
    `, [id, tempEmails[0].id, sender, subject, body]);

    res.json({ message: 'Email received successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Failed to process received email' });
  }
});

export default router;