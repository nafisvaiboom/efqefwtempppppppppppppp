import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import pool from '../db/init.js';

const router = express.Router();

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();

    await pool.query(
      'INSERT INTO users (id, email, password) VALUES (?, ?, ?)',
      [id, email, hashedPassword]
    );

    const token = jwt.sign(
      { id, email, isAdmin: false },
      process.env.JWT_SECRET
    );

    res.json({ token, user: { id, email, isAdmin: false } });
  } catch (error) {
    console.error('Registration failed:', error);
    res.status(400).json({ error: 'Registration failed' });
  }
});

// Login with email/password
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

    // Update last login time
    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    const token = jwt.sign(
      { id: user.id, email: user.email, isAdmin: user.is_admin },
      process.env.JWT_SECRET
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        isAdmin: user.is_admin,
        lastLogin: user.last_login
      }
    });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(400).json({ error: 'Login failed' });
  }
});

// Google OAuth login/register
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
      'SELECT * FROM users WHERE email = ? OR google_id = ?',
      [email, googleId]
    );

    let user;
    if (users.length === 0) {
      // Create new user if doesn't exist
      const id = uuidv4();
      const hashedPassword = await bcrypt.hash(googleId, 10);

      await pool.query(
        'INSERT INTO users (id, email, password, google_id, last_login) VALUES (?, ?, ?, ?, NOW())',
        [id, email, hashedPassword, googleId]
      );

      user = { id, email, isAdmin: false };
    } else {
      user = users[0];
      
      // Update last login time and Google ID if not set
      await pool.query(
        'UPDATE users SET last_login = NOW(), google_id = COALESCE(google_id, ?) WHERE id = ?',
        [googleId, user.id]
      );
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
        isAdmin: user.is_admin,
        googleId: user.google_id,
        lastLogin: user.last_login
      }
    });
  } catch (error) {
    console.error('Google OAuth login failed:', error);
    res.status(400).json({ error: 'Google login failed' });
  }
});

// Change password
router.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const validPassword = await bcrypt.compare(currentPassword, users[0].password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Password change failed:', error);
    res.status(400).json({ error: 'Failed to change password' });
  }
});

// Delete account
router.post('/delete-account', async (req, res) => {
  try {
    const { password } = req.body;
    const userId = req.user.id;

    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const validPassword = await bcrypt.compare(password, users[0].password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    await pool.query('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Account deletion failed:', error);
    res.status(400).json({ error: 'Failed to delete account' });
  }
});

export default router;
