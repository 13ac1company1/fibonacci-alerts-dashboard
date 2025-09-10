# Fib Alerts Dashboard (US) — v2.7.6 (Full)

- Global Fib controls (affect all charts)
- XRPUSDT first by default
- Price-only right labels @ 75% opacity (lines & labels)
- Drag Fib lines (snap to Fib ratios & recent highs/lows), tooltip, keyboard nudging
- RSI alerts (standard or HA-based), posts to `/alert` for Telegram relay
- Presets: Core / Core+1.618 / All / Minimal
- Auto-center toggle
- TailwindCSS, Lightweight Charts, Binance US streams

## Run
```bash
npm install
npm start
```

## Telegram relay (optional)
```bash
cd server
npm install
cp .env.example .env   # set TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID
node index.js
```
