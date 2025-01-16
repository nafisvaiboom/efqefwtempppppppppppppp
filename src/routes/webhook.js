import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import pool from '../db/init.js';

const router = express.Router();

function verifyWebhookSignature(timestamp, token, signature) {
  console.log('Verifying webhook signature:');
  console.log('Timestamp:', timestamp);
  console.log('Token:', token);
  console.log('Received signature:', signature);
  
  const encodedToken = crypto
    .createHmac('sha256', process.env.MAILGUN_WEBHOOK_SIGNING_KEY)
    .update(timestamp.concat(token))
    .digest('hex');
  
  console.log('Calculated signature:', encodedToken);
  return encodedToken === signature;
}

router.post('/email/incoming', async (req, res) => {
  try {
    console.log('Received webhook payload:', JSON.stringify(req.body, null, 2));
    
    const timestamp = req.body.signature?.timestamp;
    const token = req.body.signature?.token;
    const signature = req.body.signature?.signature;

    console.log('Signature details:', { timestamp, token, signature });

    if (!timestamp || !token || !signature) {
      console.log('Missing signature components');
      return res.status(401).json({ error: 'Invalid webhook signature - missing components' });
    }

    if (!verifyWebhookSignature(timestamp, token, signature)) {
      console.log('Signature verification failed');
      return res.status(401).json({ error: 'Invalid webhook signature - verification failed' });
    }

    console.log('Signature verified successfully');

    const {
      recipient,
      sender,
      subject,
      'body-html': bodyHtml,
      'body-plain': bodyPlain,
      attachments
    } = req.body;

    console.log('Extracted email details:', {
      recipient,
      sender,
      subject,
      hasHtmlBody: !!bodyHtml,
      hasPlainBody: !!bodyPlain
    });

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

    // Store attachments if any
    if (attachments && Object.keys(attachments).length > 0) {
      console.log('Processing attachments:', Object.keys(attachments).length);
      
      for (const attachment of Object.values(attachments)) {
        const attachmentId = uuidv4();
        console.log('Storing attachment:', attachment.name);
        
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

    console.log('Email processed successfully');
    res.status(200).json({ message: 'Email received and stored successfully' });
  } catch (error) {
    console.error('Webhook error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to process incoming email' });
  }
});

export default router;
