import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/init.js';

const router = express.Router();

// Helper function to parse email content
function parseEmailContent(rawContent) {
  try {
    // Log raw content for debugging
    console.log('Raw email content:', rawContent);

    // Extract headers and body
    const [headers, ...bodyParts] = rawContent.split('\n\n');
    const headerLines = headers.split('\n');
    
    const parsedHeaders = {};
    let currentHeader = '';
    
    headerLines.forEach(line => {
      if (line.startsWith(' ') && currentHeader) {
        parsedHeaders[currentHeader] += line.trim();
      } else {
        const match = line.match(/^([\w-]+):\s*(.*)$/);
        if (match) {
          currentHeader = match[1].toLowerCase();
          parsedHeaders[currentHeader] = match[2];
        }
      }
    });

    // Find boundary if multipart
    let boundary = '';
    const contentType = parsedHeaders['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/);
    if (boundaryMatch) {
      boundary = boundaryMatch[1];
    }

    // Parse body parts
    let htmlContent = '';
    let textContent = '';
    let attachments = [];

    if (boundary) {
      const bodyContent = bodyParts.join('\n\n');
      const multipartSections = bodyContent.split('--' + boundary);
      
      multipartSections.forEach(section => {
        if (section.trim() && !section.includes('--')) {
          const [partHeaders, ...partContent] = section.trim().split('\n\n');
          const contentTypeMatch = partHeaders.match(/Content-Type:\s*([^;\n]+)/i);
          
          if (contentTypeMatch) {
            const partType = contentTypeMatch[1].trim().toLowerCase();
            const content = partContent.join('\n\n').trim();

            if (partType === 'text/html') {
              htmlContent = content;
            } else if (partType === 'text/plain') {
              textContent = content;
            } else if (partType.startsWith('image/') || partType.startsWith('application/')) {
              attachments.push({
                contentType: partType,
                content: content
              });
            }
          }
        }
      });
    } else {
      // Single part email
      textContent = bodyParts.join('\n\n');
      // Try to detect if content is HTML
      if (textContent.includes('<!DOCTYPE html>') || textContent.includes('<html')) {
        htmlContent = textContent;
        textContent = textContent.replace(/<[^>]*>/g, '');
      }
    }

    return {
      headers: parsedHeaders,
      html: htmlContent,
      text: textContent,
      attachments
    };
  } catch (error) {
    console.error('Error parsing email content:', error);
    return {
      headers: {},
      html: '',
      text: rawContent,
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
    const parsedEmail = parseEmailContent(rawContent);
    
    // Extract email data
    const emailData = {
      recipient: req.body.recipient,
      sender: req.body.sender,
      subject: req.body.subject || parsedEmail.headers.subject || 'No Subject',
      body_html: parsedEmail.html,
      body_text: parsedEmail.text,
      attachments: parsedEmail.attachments
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
            content_type,
            content,
            created_at
          ) VALUES (?, ?, ?, ?, NOW())
        `, [
          attachmentId,
          emailId,
          attachment.contentType,
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
