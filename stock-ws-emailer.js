const WebSocket = require('ws');
const nodemailer = require('nodemailer');

const WS_URL = 'wss://websocket.joshlei.com/growagarden/';

// Load config from env vars:
const EMAIL_USER = process.env.EMAIL_USER; // your Gmail or SMTP user
const EMAIL_PASS = process.env.EMAIL_PASS; // app password or SMTP pass
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL; // where to send notifications

if (!EMAIL_USER || !EMAIL_PASS || !RECIPIENT_EMAIL) {
  console.error('ERROR: Set EMAIL_USER, EMAIL_PASS, and RECIPIENT_EMAIL env vars.');
  process.exit(1);
}

// Setup Nodemailer transporter using Gmail SMTP (adjust if you use another SMTP)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

let latestDataJSON = null;
let reconnectDelay = 3000;
let ws = null;

function hasDataChanged(oldJSON, newJSON) {
  return oldJSON !== newJSON;
}

function buildHtmlEmail(data) {
  let html = `<h2>Grow A Garden Stock Update</h2>`;
  for (const category in data) {
    if (!Array.isArray(data[category])) continue;
    html += `<h3 style="color:#2f4f2f; text-transform: capitalize; border-bottom: 2px solid #6a9955;">${category.replace(/_/g, ' ')}</h3>`;
    html += `<table style="border-collapse: collapse; width: 100%; max-width: 600px;">`;
    html += `<thead><tr><th style="border: 1px solid #ddd; padding: 8px;">Item</th><th style="border: 1px solid #ddd; padding: 8px;">Quantity</th></tr></thead><tbody>`;
    data[category].forEach(item => {
      const name = item.display_name || item.item_id || 'Unknown';
      const qty = item.quantity || 0;
      html += `<tr><td style="border: 1px solid #ddd; padding: 8px;">${name}</td><td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${qty}</td></tr>`;
    });
    html += `</tbody></table><br/>`;
  }
  html += `<p>Received update from Grow A Garden live feed.</p>`;
  return html;
}

function sendEmail(data) {
  const htmlBody = buildHtmlEmail(data);
  const mailOptions = {
    from: `"Grow A Garden Bot" <${EMAIL_USER}>`,
    to: RECIPIENT_EMAIL,
    subject: '🌱 Grow A Garden Stock Updated!',
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending email:', error);
    } else {
      console.log('Email sent:', info.response);
    }
  });
}

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('WebSocket connected');
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const newDataJSON = JSON.stringify(data);
      if (hasDataChanged(latestDataJSON, newDataJSON)) {
        console.log('Data changed — sending email...');
        latestDataJSON = newDataJSON;
        sendEmail(data);
      } else {
        // console.log('No data change.');
      }
    } catch (e) {
      console.warn('Invalid JSON from websocket:', e, message);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  ws.on('close', (code) => {
    console.log(`WebSocket disconnected with code ${code}. Reconnecting in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
  });
}

connect();
