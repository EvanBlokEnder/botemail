const express = require('express');
const http = require('http');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const stockURL = 'https://corsproxy.io/?https://api.joshlei.com/v2/growagarden/stock';
const weatherURL = 'https://corsproxy.io/?https://api.joshlei.com/v2/growagarden/weather';

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

if (!EMAIL_USER || !EMAIL_PASS) {
  console.error('ERROR: Set EMAIL_USER and EMAIL_PASS env vars.');
  process.exit(1);
}


const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
});

let latestStockDataJSON = null;
let latestStockDataObj = null;
let latestWeatherDataJSON = null;
let latestWeatherDataObj = null;

// i hope this shit works 🙏
const subscribedEmails = new Set();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

//middlesomthing forgot what its called
app.use(express.urlencoded({ extended: true }));

// log thing
function broadcastLog(msg) {
  const timestamp = new Date().toISOString();
  const fullMsg = `[${timestamp}] ${msg}`;
  console.log(fullMsg);
  io.emit('log', fullMsg);
}

function hasDataChanged(oldJSON, newJSON) {
  return oldJSON !== newJSON;
}

function buildStockHtmlEmail(data, recipientEmail) {
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
  html += `<p style="font-size: 12px; color: #666;"><a href="http://botemail-wrdo.onrender.com/unsub?email=${encodeURIComponent(recipientEmail)}">Unsubscribe</a></p>`;
  return html;
}

function buildWeatherHtmlEmail(weatherEvent, discordInvite, recipientEmail) {
  const duration = weatherEvent.duration ? `${Math.floor(weatherEvent.duration / 60)} minutes` : 'Unknown';
  let html = `<h2>Grow A Garden Weather Event</h2>`;
  html += `<p><strong>Weather Event:</strong> ${weatherEvent.weather_name || weatherEvent.weather_id || 'Unknown'}</p>`;
  html += `<p><strong>Duration:</strong> ${duration}</p>`;
  if (discordInvite) {
    html += `<p><strong>Join the Community:</strong> <a href="${discordInvite}">Discord Invite</a></p>`;
  }
  html += `<p>New weather event detected in Grow A Garden!</p>`;
  html += `<p style="font-size: 12px; color: #666;"><a href="http://yourappdomain.com/unsub?email=${encodeURIComponent(recipientEmail)}">Unsubscribe</a></p>`;
  return html;
}

function sendEmail(subject, htmlBody, recipientEmail) {
  const mailOptions = {
    from: `"Grow A Garden Bot" <${EMAIL_USER}>`,
    to: recipientEmail,
    subject: subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      broadcastLog(`Error sending email to ${recipientEmail}: ${error.toString()}`);
    } else {
      broadcastLog(`Email sent to ${recipientEmail}: ${info.response}`);
    }
  });
}

async function pollStockAPI() {
  try {
    const response = await fetch(stockURL);
    const data = await response.json();
    const newDataJSON = JSON.stringify(data);

    if (hasDataChanged(latestStockDataJSON, newDataJSON)) {
      broadcastLog('Stock data changed — sending emails to subscribers...');
      latestStockDataJSON = newDataJSON;
      latestStockDataObj = data;
      subscribedEmails.forEach(email => {
        sendEmail('🌱 Grow A Garden Stock Updated!', buildStockHtmlEmail(data, email), email);
      });
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
        subscribedEmails.forEach(email => {
          sendEmail(`🌦️ Grow A Garden Weather Event: ${activeEvent.weather_name}`, 
                   buildWeatherHtmlEmail(activeEvent, data.discord_invite, email), email);
        });
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

// check server for stokS
setInterval(pollStockAPI, 30000);
setInterval(pollWeatherAPI, 30000);
pollStockAPI();
pollWeatherAPI();

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
      height: 70vh;
      overflow-y: auto;
      white-space: pre-wrap;
      background: #121212;
      border: 1px solid #333;
      box-sizing: border-box;
    }
    .subscribe-form {
      text-align: center;
      padding: 1rem;
      background: #1e1e1e;
    }
    .subscribe-form input[type="email"] {
      padding: 0.5rem;
      font-size: 1rem;
      background: #333;
      color: #d4d4d4;
      border: 1px solid #6a9955;
      margin-right: 0.5rem;
    }
    .subscribe-form button {
      padding: 0.5rem 1rem;
      font-size: 1rem;
      background: #6a9955;
      color: #fff;
      border: none;
      cursor: pointer;
    }
    .subscribe-form button:hover {
      background: #4a7a3a;
    }
    .subscribe-form p {
      color: #ff5555;
      margin: 0.5rem 0 0;
    }
  </style>
</head>
<body>
  <h1 style="text-align:center; color:#6a9955;">Grow A Garden Live Terminal Logs</h1>
  <div class="subscribe-form">
    <form action="/subscribe" method="POST">
      <input type="email" name="email" placeholder="Enter your email" required>
      <button type="submit">Subscribe</button>
    </form>
    <p id="subscribe-message"></p>
  </div>
  <div id="terminal"></div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const terminal = document.getElementById('terminal');
    const socket = io();

    socket.on('log', msg => {
      terminal.textContent += msg + '\\n';
      terminal.scrollTop = terminal.scrollHeight;
    });

    // Display subscription feedback
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('subscribed')) {
      document.getElementById('subscribe-message').textContent = 'Successfully subscribed!';
    } else if (urlParams.get('unsubscribed')) {
      document.getElementById('subscribe-message').textContent = 'Successfully unsubscribed!';
    } else if (urlParams.get('error')) {
      document.getElementById('subscribe-message').textContent = decodeURIComponent(urlParams.get('error'));
    }
  </script>
</body>
</html>
  `);
});

//sub thing i think.
app.post('/subscribe', (req, res) => {
  const email = req.body.email;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.redirect('/?error=' + encodeURIComponent('Invalid email address.'));
  }
  if (subscribedEmails.has(email)) {
    return res.redirect('/?error=' + encodeURIComponent('Email already subscribed.'));
  }
  subscribedEmails.add(email);
  broadcastLog(`New subscriber: ${email}`);
  res.redirect('/?subscribed=true');
});

// Unsub
app.get('/unsub', (req, res) => {
  const email = req.query.email;
  if (!email || !subscribedEmails.has(email)) {
    return res.redirect('/?error=' + encodeURIComponent('Email not found in subscription list.'));
  }
  subscribedEmails.delete(email);
  broadcastLog(`Unsubscribed: ${email}`);
  res.redirect('/?unsubscribed=true');
});

// this code ia messy but atleast it works.
app.get('/test', (req, res) => {
  if (!latestStockDataObj && !latestWeatherDataObj) {
    return res.status(404).send('No data available to send.');
  }
  if (latestStockDataObj) {
    subscribedEmails.forEach(email => {
      sendEmail('🌱 Grow A Garden Stock Updated!', buildStockHtmlEmail(latestStockDataObj, email), email);
    });
  }
  if (latestWeatherDataObj && latestWeatherDataObj.weather) {
    const activeEvent = latestWeatherDataObj.weather.find(w => w.active);
    if (activeEvent) {
      subscribedEmails.forEach(email => {
        sendEmail(`🌦️ Grow A Garden Weather Event: ${activeEvent.weather_name}`, 
                 buildWeatherHtmlEmail(activeEvent, latestWeatherDataObj.discord_invite, email), email);
      });
    }
  }
  res.send('Test emails were sent i think. if you dont see anything then api might be down i dont know.');
});

// server start for offline deploy i think i hope no one reads this
server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});
//my hands hurt :(
