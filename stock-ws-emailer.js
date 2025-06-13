const express = require('express');
const http = require('http');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const stockURL = 'https://corsproxy.io/?https://api.joshlei.com/v2/growagarden/stock';
const weatherURL = 'https://corsproxy.io/?https://api.joshlei.com/v2/growagarden/weather';

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

let latestStockDataJSON = null;
let latestStockDataObj = null;
let latestWeatherDataJSON = null;
let latestWeatherDataObj = null;

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

function buildStockHtmlEmail(data) {
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

function buildWeatherHtmlEmail(weatherEvent, discordInvite) {
  const duration = weatherEvent.duration ? `${Math.floor(weatherEvent.duration / 60)} minutes` : 'Unknown';
  let html = `<h2>Grow A Garden Weather Event</h2>`;
  html += `<p><strong>Weather Event:</strong> ${weatherEvent.weather_name || weatherEvent.weather_id || 'Unknown'}</p>`;
  html += `<p><strong>Duration:</strong> ${duration}</p>`;
  if (discordInvite) {
    html += `<p><strong>Join the Community:</strong> <a href="${discordInvite}">Discord Invite</a></p>`;
  }
  html += `<p>New weather event detected in Grow A Garden!</p>`;
  return html;
}

function sendEmail(subject, htmlBody) {
  const mailOptions = {
    from: `"Grow A Garden Bot" <${EMAIL_USER}>`,
    to: RECIPIENT_EMAIL,
    subject: subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      broadcastLog(`Error sending email: ${error.toString()}`);
    } else {
      broadcastLog(`Email sent: ${info.response}`);
    }
  });
}

async function pollStockAPI() {
  try {
    const response = await fetch(stockURL);
    const data = await response.json();
    const newDataJSON = JSON.stringify(data);

    if (hasDataChanged(latestStockDataJSON, newDataJSON)) {
      broadcastLog('Stock data changed — sending email...');
      latestStockDataJSON = newDataJSON;
      latestStockDataObj = data;
      sendEmail('🌱 Grow A Garden Stock Updated!', buildStockHtmlEmail(data));
    } else {
      broadcastLog('Polled Stock API — no changes detected.');
    }
  } catch (err) {
    broadcastLog(`Error polling Stock API: ${err.toString()}`);
  }
}

async function pollWeatherAPI() {
  try {
    const response = await fetch(weatherURL);
    const data = await response.json();
    const newDataJSON = JSON.stringify(data);

    if (hasDataChanged(latestWeatherDataJSON, newDataJSON)) {
      broadcastLog('Weather data changed — checking for active events...');
      const activeEvent = data.weather.find(w => w.active);
      const prevActiveEvent = latestWeatherDataObj ? latestWeatherDataObj.weather.find(w => w.active) : null;

      if (activeEvent && (!prevActiveEvent || activeEvent.weather_id !== prevActiveEvent.weather_id)) {
        broadcastLog(`New active weather event: ${activeEvent.weather_name}`);
        sendEmail(`🌦️ Grow A Garden Weather Event: ${activeEvent.weather_name}`, 
                 buildWeatherHtmlEmail(activeEvent, data.discord_invite));
      } else if (!activeEvent && prevActiveEvent) {
        broadcastLog(`Weather event ended: ${prevActiveEvent.weather_name}`);
      } else {
        broadcastLog('No new active weather event detected.');
      }

      latestWeatherDataJSON = newDataJSON;
      latestWeatherDataObj = data;
    } else {
      broadcastLog('Polled Weather API — no changes detected.');
    }
  } catch (err) {
    broadcastLog(`Error polling Weather API: ${err.toString()}`);
  }
}

// Poll APIs every 30 seconds
setInterval(pollStockAPI, 30000);
setInterval(pollWeatherAPI, 30000);
pollStockAPI();
pollWeatherAPI();

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
  if (!latestStockDataObj && !latestWeatherDataObj) {
    return res.status(404).send('No data available to send.');
  }
  if (latestStockDataObj) {
    sendEmail('🌱 Grow A Garden Stock Updated!', buildStockHtmlEmail(latestStockDataObj));
  }
  if (latestWeatherDataObj && latestWeatherDataObj.weather) {
    const activeEvent = latestWeatherDataObj.weather.find(w => w.active);
    if (activeEvent) {
      sendEmail(`🌦️ Grow A Garden Weather Event: ${activeEvent.weather_name}`, 
               buildWeatherHtmlEmail(activeEvent, latestWeatherDataObj.discord_invite));
    }
  }
  res.send('Test email(s) sent if data was available. Check logs for status.');
});

// Start server
server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});
