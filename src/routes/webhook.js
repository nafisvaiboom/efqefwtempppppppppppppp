import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import pool from '../db/init.js';

const router = express.Router();

function verifyWebhookSignature(req) {
  console.log('Verifying webhook signature');
  
  try {
    // Get signature data from Mailgun's standard headers
    const timestamp = req.get('X-Mailgun-Timestamp');
    const token = req.get('X-Mailgun-Token');
    const signature = req.get('X-Mailgun-Signature');

    // Also try to get from the event data structure
    const eventSignature = req.body?.signature;
    if (eventSignature) {
      console.log('Found signature in event data:', {
        timestamp: eventSignature.timestamp,
        token: eventSignature.token,
        signature: eventSignature.signature
      });
      
      const encodedToken = crypto
        .createHmac('sha256', process.env.MAILGUN_WEBHOOK_SIGNING_KEY)
        .update(eventSignature.timestamp.concat(eventSignature.token))
        .digest('hex');
      
      return encodedToken === eventSignature.signature;
    }

    // If we have header data, verify that
    if (timestamp && token && signature) {
      console.log('Found signature in headers:', { timestamp, token, signature });
      
      const encodedToken = crypto
        .createHmac('sha256', process.env.MAILGUN_WEBHOOK_SIGNING_KEY)
        .update(timestamp.concat(token))
        .digest('hex');
      
      return encodedToken === signature;
    }

    console.log('No valid signature data found');
    return false;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

router.post('/email/incoming', async (req, res) => {
  try {
    console.log('Received webhook payload:', JSON.stringify(req.body, null, 2));
    console.log('Request headers:', req.headers);

    // Verify the signature
    const isValid = verifyWebhookSignature(req);
    console.log('Signature verification result:', isValid);

    // Extract email details from the Mailgun payload
    let recipient, sender, subject, bodyHtml, bodyPlain;

    if (req.body['event-data']) {
      // Handle event webhook format
      const eventData = req.body['event-data'];
      const message = eventData.message || {};
      recipient = eventData.recipient;
      sender = message.headers?.from || eventData.sender;
      subject = message.headers?.subject;
      bodyHtml = message['body-html'];
      bodyPlain = message['body-plain'];
    } else {
      // Handle legacy webhook format
      recipient = req.body.recipient;
      sender = req.body.sender || req.body.from;
      subject = req.body.subject;
      bodyHtml = req.body['body-html'];
      bodyPlain = req.body['body-plain'];
    }

    console.log('Extracted email details:', {
      recipient,
      sender,
      subject,
      hasHtmlBody: !!bodyHtml,
      hasPlainBody: !!bodyPlain
    });

    if (!recipient) {
      console.log('No recipient found in payload');
      return res.status(400).json({ error: 'No recipient specified' });
    }

    // Get the temp_email record
    const [tempEmails] = await pool.query(
      'SELECT id FROM temp_emails WHERE email = ? AND expires_at > NOW()',
      [recipient]
    );

    console.log('Found temp emails:', tempEmails);

    if (tempEmails.length === 0) {
      console.log('No matching temp email found for recipient:', recipient);
      return res.status(404).json({ error: 'Recipient email not found or expired' });
    }

    const tempEmailId = tempEmails[0].id;
    const emailId = uuidv4();

    console.log('Storing email with ID:', emailId);

    // Store the received email
    await pool.query(`
      INSERT INTO received_emails (id, temp_email_id, from_email, subject, body, received_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `, [emailId, tempEmailId, sender, subject, bodyHtml || bodyPlain]);

    console.log('Email processed successfully');
    res.status(200).json({ message: 'Email received and stored successfully' });
  } catch (error) {
    console.error('Webhook error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to process incoming email' });
  }
});

export default router;
