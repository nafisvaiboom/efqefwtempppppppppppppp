import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import pool from '../db/init.js';

const router = express.Router();

// Verify Mailgun webhook signature
function verifyWebhookSignature(timestamp, token, signature) {
  const encodedToken = crypto
    .createHmac('sha256', process.env.MAILGUN_WEBHOOK_SIGNING_KEY)
    .update(timestamp.concat(token))
    .digest('hex');
  
  return encodedToken === signature;
}

// Webhook endpoint for receiving emails
router.post('/email/incoming', async (req, res) => {
  try {
    // Verify the webhook signature from Mailgun
    const timestamp = req.body.signature.timestamp;
    const token = req.body.signature.token;
    const signature = req.body.signature.signature;

    if (!verifyWebhookSignature(timestamp, token, signature)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const {
      recipient,
      sender,
      subject,
      'body-html': bodyHtml,
      'body-plain': bodyPlain,
      attachments
    } = req.body;

    // Validate the recipient email exists in our system
    const [tempEmails] = await pool.query(
      'SELECT id FROM temp_emails WHERE email = ? AND expires_at > NOW()',
      [recipient]
    );

    if (tempEmails.length === 0) {
      return res.status(404).json({ error: 'Recipient email not found or expired' });
    }

    const tempEmailId = tempEmails[0].id;
    const emailId = uuidv4();

    // Store the received email (prefer HTML body if available)
    await pool.query(`
      INSERT INTO received_emails (id, temp_email_id, from_email, subject, body)
      VALUES (?, ?, ?, ?, ?)
    `, [emailId, tempEmailId, sender, subject, bodyHtml || bodyPlain]);

    // If there are attachments, store them
    if (attachments && Object.keys(attachments).length > 0) {
      for (const attachment of Object.values(attachments)) {
        const attachmentId = uuidv4();
        await pool.query(`
          INSERT INTO email_attachments (id, email_id, filename, content_type, size, url)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          attachmentId,
          emailId,
          attachment.name,
          attachment['content-type'],
          attachment.size,
          attachment.url
        ]);
      }
    }

    res.status(200).json({ message: 'Email received and stored successfully' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Failed to process incoming email' });
  }
});

export default router;