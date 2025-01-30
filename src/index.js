import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { initializeDatabase, checkDatabaseConnection, pool } from './db/init.js';
import { cleanupOldEmails } from './utils/cleanup.js';
import authRoutes from './routes/auth.js';
import emailRoutes from './routes/emails.js';
import domainRoutes from './routes/domains.js';
import webhookRoutes from './routes/webhook.js';
import messageRoutes from './routes/messages.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://boomlify.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Configure CORS
app.use(cors({
  origin: '*', // Allow all origins in development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// Health check endpoint
app.get('/health', async (req, res) => {
  const dbHealthy = await checkDatabaseConnection();
  if (dbHealthy) {
    res.status(200).json({ 
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } else {
    res.status(503).json({ 
      status: 'unhealthy',
      database: 'disconnected',
      timestamp: new Date().toISOString()
    });
  }
});

// Add these routes before the auth-protected routes
app.use('/domains/public', domainRoutes);
app.use('/emails/public', emailRoutes);

// Protected routes
app.use('/auth', authRoutes);
app.use('/emails', emailRoutes);
app.use('/domains', domainRoutes);
app.use('/webhook', webhookRoutes);
app.use('/messages', messageRoutes);

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
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
    scheduleCleanup();
    console.log('Email cleanup scheduler started');
  });
}).catch(error => {
  console.error('Failed to initialize database:', error);
  process.exit(1);
});

export default app;
