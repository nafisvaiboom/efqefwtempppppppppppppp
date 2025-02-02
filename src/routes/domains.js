import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { pool } from '../db/init.js';

const router = express.Router();

// Get public domains (no auth required)
router.get('/public', async (req, res) => {
  try {
    const [domains] = await pool.query('SELECT * FROM domains ORDER BY created_at DESC');
    res.json(domains);
  } catch (error) {
    res.status(400).json({ error: 'Failed to fetch domains' });
  }
});

// Protected routes
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [domains] = await pool.query('SELECT * FROM domains ORDER BY created_at DESC');
    res.json(domains);
  } catch (error) {
    res.status(400).json({ error: 'Failed to fetch domains' });
  }
});

router.post('/add', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { domain } = req.body;
    const id = uuidv4();

    await pool.query(
      'INSERT INTO domains (id, domain) VALUES (?, ?)',
      [id, domain]
    );

    res.json({ id, domain });
  } catch (error) {
    res.status(400).json({ error: 'Failed to add domain' });
  }
});

export default router;
