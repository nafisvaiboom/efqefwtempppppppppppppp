import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { pool } from '../db/init.js';  // Updated import statement
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Utility function to generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, isAdmin: user.is_admin },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const [existingUsers] = await pool.query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();

    await pool.query(
      'INSERT INTO users (id, email, password, last_login) VALUES (?, ?, ?, NOW())',
      [id, email, hashedPassword]
    );

    const token = generateToken({ id, email, is_admin: false });

    res.json({
      token,
      user: { id, email, isAdmin: false, lastLogin: new Date() }
    });
  } catch (error) {
    console.error('Registration failed:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login with email/password
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const [users] = await pool.query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        isAdmin: user.is_admin,
        lastLogin: new Date()
      }
    });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Google OAuth login/register
router.post('/google', async (req, res) => {
  try {
    const { access_token } = req.body;

    if (!access_token) {
      return res.status(400).json({ error: 'Access token is required' });
    }

    const response = await axios.get(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: { Authorization: `Bearer ${access_token}` }
      }
    );

    const { email, sub: googleId } = response.data;

    let [users] = await pool.query(
      'SELECT * FROM users WHERE email = ? OR google_id = ?',
      [email, googleId]
    );

    let user;
    if (users.length === 0) {
      const id = uuidv4();
      const hashedPassword = await bcrypt.hash(googleId, 10);

      await pool.query(
        'INSERT INTO users (id, email, password, google_id, last_login) VALUES (?, ?, ?, ?, NOW())',
        [id, email, hashedPassword, googleId]
      );

      user = { id, email, is_admin: false };
    } else {
      user = users[0];
      await pool.query(
        'UPDATE users SET last_login = NOW(), google_id = COALESCE(google_id, ?) WHERE id = ?',
        [googleId, user.id]
      );
    }

    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        isAdmin: user.is_admin,
        googleId: user.google_id,
        lastLogin: new Date()
      }
    });
  } catch (error) {
    console.error('Google OAuth login failed:', error);
    res.status(400).json({ error: 'Google login failed' });
  }
});

// Refresh token
router.post('/refresh-token', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const newToken = generateToken(user);
    res.json({ token: newToken });
  } catch (error) {
    console.error('Token refresh failed:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

export default router;
