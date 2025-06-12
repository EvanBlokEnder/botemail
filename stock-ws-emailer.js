const express = require('express');
const http = require('http');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const stockURL = 'https://corsproxy.io/?https://api.joshlei.com/v2/growagarden/stock';

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;

if (!EMAIL_USER || !EMAIL_PASS || !RECIPIENT_EMAIL) {
  console.error('ERROR: Set EMAIL_USER, EMAIL_PASS, and RECIPIENT_EMAIL env vars.');
  process.exit(1);
}

// Setup nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
});

let latestDataJSON = null;
let latestDataObj = null;

// Setup Express and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Broadcast logs to all connected clients
function broadcastLog(msg) {
  const timestamp = new Date().toISOString();
  const fullMsg = `[${timestamp}] ${msg}`;
  console.log(fullMsg);
  io.emit('log', fullMsg);
}

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
  html += `<p>Received update from Grow A Garden API feed.</p>`;
  return html;
}

function sendEmail(data) {
  if (!data) {
    broadcastLog('No data to send email with.');
    return;
  }
  const htmlBody = buildHtmlEmail(data);
  const mailOptions = {
    from: `"Grow A Garden Bot" <${EMAIL_USER}>`,
    to: RECIPIENT_EMAIL,
    subject: '🌱 Grow A Garden Stock Updated!',
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      broadcastLog('Error sending email: ' + error.toString());
    } else {
      broadcastLog('Email sent: ' + info.response);
    }
  });
}

async function pollAPI() {
  try {
    const response = await fetch(stockURL);
    const data = await response.json();
    const newDataJSON = JSON.stringify(data);

    if (hasDataChanged(latestDataJSON, newDataJSON)) {
      broadcastLog('Data changed — sending email...');
      latestDataJSON = newDataJSON;
      latestDataObj = data;
      sendEmail(data);
    } else {
      broadcastLog('Polled API — no changes detected.');
    }
  } catch (err) {
    broadcastLog('Error polling API: ' + err.toString());
  }
}

// Poll every 30 seconds
setInterval(pollAPI, 30000);
pollAPI();

// Serve the live log page on /
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Grow A Garden - Live Logs</title>
  <style>
    body { background: #1e1e1e; color: #d4d4d4; font-family: monospace; margin: 0; padding: 0; }
    #terminal {
      padding: 1rem;
      height: 90vh;
      overflow-y: auto;
      white-space: pre-wrap;
      background: #121212;
      border: 1px solid #333;
      box-sizing: border-box;
    }
  </style>
</head>
<body>
  <h1 style="text-align:center; color:#6a9955;">Grow A Garden Live Terminal Logs</h1>
  <div id="terminal"></div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const terminal = document.getElementById('terminal');
    const socket = io();

    socket.on('log', msg => {
      terminal.textContent += msg + '\\n';
      terminal.scrollTop = terminal.scrollHeight;
    });
  </script>
</body>
</html>
  `);
});

// /test endpoint to send the current latest data via email
app.get('/test', (req, res) => {
  if (!latestDataObj) {
    return res.status(404).send('No data available to send.');
  }
  sendEmail(latestDataObj);
  res.send('Test email sent if data was available. Check logs for status.');
});

// Start server
server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});
