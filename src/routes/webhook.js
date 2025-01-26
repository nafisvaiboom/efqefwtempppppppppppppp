import express from 'express';
import { pool } from '../db/init.js'; // Assuming you're using a connection pool

const router = express.Router();

/**
 * Parses raw email content into headers, body, and attachments.
 * @param {string} rawContent - The raw email content.
 * @returns {Object} - Parsed email with headers, parts, and attachments.
 */
function parseEmailContent(rawContent) {
  try {
    // Split headers and body more reliably
    const headerBodySplit = rawContent.split(/\r?\n\r?\n/);
    const headers = headerBodySplit[0];
    const body = headerBodySplit.slice(1).join('\n\n');

    // Parse headers more accurately
    const headerLines = headers.split(/\r?\n/);
    const parsedHeaders = {};
    let currentHeader = '';

    headerLines.forEach(line => {
      if (line.match(/^\s+/) && currentHeader) {
        // Continue previous header
        parsedHeaders[currentHeader] += ' ' + line.trim();
      } else {
        const match = line.match(/^([\w-]+):\s*(.*)$/i);
        if (match) {
          currentHeader = match[1].toLowerCase();
          parsedHeaders[currentHeader] = match[2].trim();
        }
      }
    });

    // Handle multipart content
    const contentType = parsedHeaders['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/i);
    const parts = [];

    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      const multipartSections = body.split(new RegExp(`--${boundary}(?:--)?[\r\n]*`));

      multipartSections.forEach(section => {
        if (section.trim()) {
          const [partHeaders, ...partContent] = section.trim().split(/\r?\n\r?\n/);
          const contentTypeMatch = partHeaders.match(/Content-Type:\s*([^;\r\n]+)/i);
          const contentEncodingMatch = partHeaders.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
          const filenameMatch = partHeaders.match(/filename="?([^"]+)"?/i);

          if (contentTypeMatch) {
            let content = partContent.join('\n\n');

            // Handle different content encodings
            if (contentEncodingMatch) {
              const encoding = contentEncodingMatch[1].toLowerCase();
              if (encoding === 'base64') {
                try {
                  content = Buffer.from(content, 'base64').toString('utf8');
                } catch (e) {
                  console.error('Failed to decode base64 content:', e);
                }
              } else if (encoding === 'quoted-printable') {
                content = content.replace(/=\r?\n/g, '')
                  .replace(/=([\da-fA-F]{2})/g, (_, hex) =>
                    String.fromCharCode(parseInt(hex, 16)));
              }
            }

            parts.push({
              contentType: contentTypeMatch[1].trim(),
              content: content.trim(),
              filename: filenameMatch ? filenameMatch[1] : null
            });
          }
        }
      });
    } else {
      // Handle non-multipart emails
      parts.push({
        contentType: contentType.split(';')[0] || 'text/plain',
        content: body.trim(),
        filename: null
      });
    }

    return {
      headers: parsedHeaders,
      parts: parts
    };
  } catch (error) {
    console.error('Error parsing email content:', error);
    return {
      headers: {},
      parts: [{
        contentType: 'text/plain',
        content: rawContent,
        filename: null
      }]
    };
  }
}

/**
 * Webhook route to handle incoming emails.
 */
router.post('/email/incoming', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const rawContent = req.body.body;
    const parsedEmail = parseEmailContent(rawContent);

    const emailData = {
      recipient: req.body.recipient,
      sender: req.body.sender,
      subject: req.body.subject || parsedEmail.headers.subject || 'No Subject',
      htmlContent: '',
      textContent: '',
      attachments: []
    };

    // Process email parts with better content handling
    parsedEmail.parts.forEach(part => {
      const contentType = part.contentType.toLowerCase();

      if (contentType.includes('text/html')) {
        // Sanitize HTML content
        emailData.htmlContent = part.content
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
      } else if (contentType.includes('text/plain')) {
        // Preserve text formatting
        emailData.textContent = part.content
          .replace(/\n/g, '<br>')
          .replace(/\s{2,}/g, ' &nbsp;');
      } else if (contentType.includes('image/') || contentType.includes('application/')) {
        // Handle attachments
        emailData.attachments.push({
          contentType: contentType,
          content: part.content,
          filename: part.filename || `attachment-${Date.now()}`
        });
      }
    });

    // If no HTML content, convert text to HTML
    if (!emailData.htmlContent && emailData.textContent) {
      emailData.htmlContent = `<div style="white-space: pre-wrap;">${emailData.textContent}</div>`;
    }

    // Store in database
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert email
      const emailInsertQuery = `
        INSERT INTO emails (recipient, sender, subject, html_content, text_content)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id;
      `;
      const emailInsertValues = [
        emailData.recipient,
        emailData.sender,
        emailData.subject,
        emailData.htmlContent,
        emailData.textContent
      ];
      const emailResult = await client.query(emailInsertQuery, emailInsertValues);
      const emailId = emailResult.rows[0].id;

      // Insert attachments
      if (emailData.attachments.length > 0) {
        const attachmentInsertQuery = `
          INSERT INTO email_attachments (email_id, filename, content_type, content)
          VALUES ($1, $2, $3, $4);
        `;
        for (const attachment of emailData.attachments) {
          await client.query(attachmentInsertQuery, [
            emailId,
            attachment.filename,
            attachment.contentType,
            attachment.content
          ]);
        }
      }

      await client.query('COMMIT');
      res.status(200).json({ success: true, message: 'Email processed successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to process the incoming email'
    });
  }
});

export default router;
