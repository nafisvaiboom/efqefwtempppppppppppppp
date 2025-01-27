import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import pool from '../db/init.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Register a new user
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();

    await pool.query(
      'INSERT INTO users (id, email, password) VALUES (?, ?, ?)',
      [id, email, hashedPassword]
    );

    const token = jwt.sign({ id, email }, process.env.JWT_SECRET);
    res.json({ token, user: { id, email, isAdmin: false } });
  } catch (error) {
    console.error('Registration failed:', error);
    res.status(400).json({ error: 'Registration failed' });
  }
});

// Login with email and password
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, isAdmin: user.is_admin },
      process.env.JWT_SECRET
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        isAdmin: user.is_admin
      }
    });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(400).json({ error: 'Login failed' });
  }
});

// Google OAuth login
router.post('/google', async (req, res) => {
  try {
    const { access_token } = req.body;

    // Verify the token with Google
    const response = await axios.get(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: { Authorization: `Bearer ${access_token}` }
      }
    );

    const { email, sub: googleId } = response.data;

    // Check if user exists
    let [users] = await pool.query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    let user;
    if (users.length === 0) {
      // Create new user if doesn't exist
      const id = uuidv4();
      const hashedPassword = await bcrypt.hash(googleId, 10); // Use Google ID as password

      await pool.query(
        'INSERT INTO users (id, email, password, google_id) VALUES (?, ?, ?, ?)',
        [id, email, hashedPassword, googleId]
      );

      user = { id, email, isAdmin: false };
    } else {
      user = {
        id: users[0].id,
        email: users[0].email,
        isAdmin: users[0].is_admin
      };
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, isAdmin: user.isAdmin },
      process.env.JWT_SECRET
    );

    res.json({ token, user });
  } catch (error) {
    console.error('Google login failed:', error);
    res.status(400).json({ error: 'Google login failed' });
  }
});

// ... rest of the auth routes ...

export default router;