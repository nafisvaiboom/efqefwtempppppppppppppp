import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/init.js';
import { simpleParser } from 'mailparser';
import iconv from 'iconv-lite';

const router = express.Router();

async function parseEmailContent(rawContent) {
  try {
    // Decode content if needed
    let decodedContent = rawContent;
    if (typeof rawContent === 'string') {
      try {
        // Try UTF-8 first
        decodedContent = iconv.decode(Buffer.from(rawContent), 'utf8');
      } catch (err) {
        // Fallback to latin1
        decodedContent = iconv.decode(Buffer.from(rawContent), 'latin1');
      }
    }

    // Parse email using mailparser
    const parsed = await simpleParser(decodedContent);

    return {
      headers: parsed.headers,
      subject: parsed.subject,
      from: parsed.from?.text || '',
      to: parsed.to?.text || '',
      text: parsed.text,
      html: parsed.html,
      attachments: parsed.attachments.map(attachment => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        content: attachment.content.toString('base64')
      }))
    };
  } catch (error) {
    console.error('Error parsing email:', error);
    return {
      headers: {},
      subject: 'Unable to parse subject',
      from: '',
      to: '',
      text: rawContent,
      html: '',
      attachments: []
    };
  }
}

router.post('/email/incoming', express.urlencoded({ extended: true }), async (req, res) => {
  console.log('Received webhook request');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Request body:', req.body);
  
  try {
    const rawContent = req.body.body;
    const parsedEmail = await parseEmailContent(rawContent);
    
    // Extract email data
    const emailData = {
      recipient: req.body.recipient || parsedEmail.to,
      sender: req.body.sender || parsedEmail.from,
      subject: parsedEmail.subject || 'No Subject',
      body_html: parsedEmail.html || '',
      body_text: parsedEmail.text || '',
      attachments: parsedEmail.attachments || []
    };

    // Clean the recipient email address
    const cleanRecipient = emailData.recipient.includes('<') ? 
      emailData.recipient.match(/<(.+)>/)[1] : 
      emailData.recipient.trim();

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

    // Start a transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Store the email
      await connection.query(`
        INSERT INTO received_emails (
          id, 
          temp_email_id, 
          from_email, 
          subject, 
          body_html,
          body_text,
          received_at
        ) VALUES (?, ?, ?, ?, ?, ?, NOW())
      `, [
        emailId,
        tempEmailId,
        emailData.sender,
        emailData.subject,
        emailData.body_html,
        emailData.body_text
      ]);

      // Store attachments if any
      for (const attachment of emailData.attachments) {
        const attachmentId = uuidv4();
        await connection.query(`
          INSERT INTO email_attachments (
            id,
            email_id,
            filename,
            content_type,
            size,
            content,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NOW())
        `, [
          attachmentId,
          emailId,
          attachment.filename,
          attachment.contentType,
          attachment.size,
          attachment.content
        ]);
      }

      await connection.commit();
      console.log('Email and attachments stored successfully');

      res.status(200).json({
        message: 'Email received and stored successfully',
        emailId,
        recipient: cleanRecipient
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
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
