import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { pool } from '../db/init.js';

const router = express.Router();

// Get active messages for the current user
router.get('/', authenticateToken, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const [messages] = await connection.query(`
      SELECT m.*, 
             CASE WHEN udm.user_id IS NOT NULL THEN TRUE ELSE FALSE END as dismissed
      FROM custom_messages m
      LEFT JOIN user_dismissed_messages udm 
        ON m.id = udm.message_id 
        AND udm.user_id = ?
      WHERE m.is_active = TRUE
      ORDER BY m.created_at DESC
    `, [req.user.id]);

    res.json(messages);
  } catch (error) {
    console.error('Failed to fetch messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  } finally {
    connection.release();
  }
});

// Create a new message (admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { message, type } = req.body;
    const id = uuidv4();

    await connection.query(
      'INSERT INTO custom_messages (id, message, type, created_by) VALUES (?, ?, ?, ?)',
      [id, message, type, req.user.id]
    );

    const [createdMessage] = await connection.query(
      'SELECT * FROM custom_messages WHERE id = ?',
      [id]
    );

    res.json(createdMessage[0]);
  } catch (error) {
    console.error('Failed to create message:', error);
    res.status(500).json({ error: 'Failed to create message' });
  } finally {
    connection.release();
  }
});

// Dismiss a message for the current user
router.post('/:id/dismiss', authenticateToken, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.query(
      'INSERT INTO user_dismissed_messages (user_id, message_id) VALUES (?, ?)',
      [req.user.id, req.params.id]
    );

    res.json({ message: 'Message dismissed successfully' });
  } catch (error) {
    console.error('Failed to dismiss message:', error);
    res.status(500).json({ error: 'Failed to dismiss message' });
  } finally {
    connection.release();
  }
});

// Get all messages (admin only)
router.get('/admin', authenticateToken, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const [messages] = await connection.query(`
      SELECT m.*, u.email as created_by_email,
             COUNT(DISTINCT udm.user_id) as dismiss_count
      FROM custom_messages m
      LEFT JOIN users u ON m.created_by = u.id
      LEFT JOIN user_dismissed_messages udm ON m.id = udm.message_id
      GROUP BY m.id
      ORDER BY m.created_at DESC
    `);

    res.json(messages);
  } catch (error) {
    console.error('Failed to fetch admin messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  } finally {
    connection.release();
  }
});

// Update message status (admin only)
router.patch('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { is_active } = req.body;
    
    await connection.query(
      'UPDATE custom_messages SET is_active = ? WHERE id = ?',
      [is_active, req.params.id]
    );

    res.json({ message: 'Message updated successfully' });
  } catch (error) {
    console.error('Failed to update message:', error);
    res.status(500).json({ error: 'Failed to update message' });
  } finally {
    connection.release();
  }
});

// Delete a message (admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.query('DELETE FROM custom_messages WHERE id = ?', [req.params.id]);
    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Failed to delete message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  } finally {
    connection.release();
  }
});

export default router;