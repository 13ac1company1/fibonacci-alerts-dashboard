// server/index.js
const path = require('path');
const express = require('express');
const cors = require('cors');

// Force dotenv to load from this folder
require('dotenv').config({ path: path.join(__dirname, '.env') });

// DEBUG: see what dotenv loaded (won't print secrets)
console.log('[env] loaded .env from', path.join(__dirname, '.env'));
console.log('[env] has token?', !!process.env.TELEGRAM_BOT_TOKEN, 'has chat?', !!process.env.TELEGRAM_CHAT_ID);

const app = express();
app.use(cors());
app.use(express.json());

app.post('/alert', async (req, res) => {
  const { message } = req.body || {};
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return res.json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env" });
  }

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message || '(no message)' })
    });
    const j = await r.json();
    res.json(j);
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Alert relay listening on :${port}`));
