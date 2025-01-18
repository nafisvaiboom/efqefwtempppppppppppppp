import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

async function testWebhook() {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const token = 'test-token';
  
  // Create test signature using the webhook signing key
  const signature = crypto
    .createHmac('sha256', process.env.MAILGUN_WEBHOOK_SIGNING_KEY)
    .update(timestamp.concat(token))
    .digest('hex');

  const testData = {
    signature: {
      timestamp,
      token,
      signature
    },
    recipient: 'test@sasnations.com',
    sender: 'sender@example.com',
    subject: 'Test Email',
    'body-html': '<p>This is a test email</p>',
    'body-plain': 'This is a test email'
  };

  try {
    const response = await axios.post(
      'https://temp-email-backend.onrender.com/webhook/email/incoming',
      testData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Webhook test response:', response.data);
  } catch (error) {
    console.error('Webhook test failed:', error.response?.data || error.message);
  }
}

testWebhook();