import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db/init.js';

const router = express.Router();

router.post('/email/incoming', express.urlencoded({ extended: true }), async (req, res) => {
  console.log('Received webhook request');
  console.log('Content-Type:', req.headers['content-type']);
  
  try {
    // Extract email data from the form
    const emailData = {
      recipient: req.body['recipient'] || req.body['to'],
      sender: req.body['sender'] || req.body['from'],
      subject: req.body['subject'],
      bodyHtml: req.body['body-html'] || req.body['html'],
      bodyPlain: req.body['body-plain'] || req.body['text'],
      timestamp: new Date().toISOString()
    };

    console.log('Extracted email data:', {
      recipient: emailData.recipient,
      sender: emailData.sender,
      subject: emailData.subject,
      hasHtmlBody: !!emailData.bodyHtml,
      hasPlainBody: !!emailData.bodyPlain
    });

    if (!emailData.recipient) {
      console.error('No recipient specified in the webhook data');
      return res.status(400).json({ error: 'No recipient specified' });
    }

    // Clean the recipient email address
    const cleanRecipient = emailData.recipient.includes('<') ? 
      emailData.recipient.match(/<(.+)>/)[1] : 
      emailData.recipient.trim();

    console.log('Cleaned recipient:', cleanRecipient);

    // Find the temporary email in the database
    const [tempEmails] = await pool.query(
      'SELECT id FROM temp_emails WHERE email = ? AND expires_at > NOW()',
      [cleanRecipient]
    );

    if (tempEmails.length === 0) {
      console.error('No active temporary email found for recipient:', cleanRecipient);
      return res.status(404).json({ 
        error: 'Recipient not found',
        message: 'No active temporary email found for the specified recipient'
      });
    }

    const tempEmailId = tempEmails[0].id;
    const emailId = uuidv4();

    console.log('Storing email:', {
      id: emailId,
      tempEmailId,
      recipient: cleanRecipient
    });

    // Store the email in the database
    await pool.query(`
      INSERT INTO received_emails (
        id, 
        temp_email_id, 
        from_email, 
        subject, 
        body, 
        received_at
      ) VALUES (?, ?, ?, ?, ?, NOW())
    `, [
      emailId,
      tempEmailId,
      emailData.sender,
      emailData.subject,
      emailData.bodyHtml || emailData.bodyPlain || 'No content'
    ]);

    // Handle attachments if present
    if (req.body['attachments']) {
      try {
        const attachments = JSON.parse(req.body['attachments']);
        
        for (const attachment of Object.values(attachments)) {
          const attachmentId = uuidv4();
          
          await pool.query(`
            INSERT INTO email_attachments (
              id,
              email_id,
              filename,
              content_type,
              size,
              url
            ) VALUES (?, ?, ?, ?, ?, ?)
          `, [
            attachmentId,
            emailId,
            attachment.name,
            attachment['content-type'],
            attachment.size,
            attachment.url
          ]);

          console.log('Stored attachment:', {
            id: attachmentId,
            filename: attachment.name,
            size: attachment.size
          });
        }
      } catch (error) {
        console.error('Failed to process attachments:', error);
        // Continue processing even if attachment storage fails
      }
    }

    console.log('Email processed and stored successfully');
    
    res.status(200).json({
      message: 'Email received and stored successfully',
      emailId,
      recipient: cleanRecipient
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to process the incoming email'
    });
  }
});

export default router;