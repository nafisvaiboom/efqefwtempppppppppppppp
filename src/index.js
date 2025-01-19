import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeDatabase } from './db/init.js';
import { cleanupOldEmails } from './utils/cleanup.js';
import authRoutes from './routes/auth.js';
import emailRoutes from './routes/emails.js';
import domainRoutes from './routes/domains.js';
import webhookRoutes from './routes/webhook.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Configure CORS
app.use(cors({
  origin: [
    'https://yourdomain.com',
    'https://www.yourdomain.com',
    // Add any other domains that need access
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Routes
app.use('/auth', authRoutes);
app.use('/emails', emailRoutes);
app.use('/domains', domainRoutes);
app.use('/webhook', webhookRoutes);

// Schedule cleanup to run every 24 hours
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

function scheduleCleanup() {
  setInterval(async () => {
    try {
      const deletedCount = await cleanupOldEmails();
      console.log(`Scheduled cleanup completed. Deleted ${deletedCount} old emails.`);
    } catch (error) {
      console.error('Scheduled cleanup failed:', error);
    }
  }, CLEANUP_INTERVAL);
}

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    scheduleCleanup(); // Start the cleanup schedule
    console.log('Email cleanup scheduler started');
  });
}).catch(error => {
  console.error('Failed to initialize database:', error);
  process.exit(1);
});