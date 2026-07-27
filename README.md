# JobHunter AI

AI-powered SMM/VA job monitoring assistant. Part of the MakiSync ecosystem.

## What it does

1. Monitors Facebook groups for hiring posts
2. Uses AI to match posts against your SMM/VA skills
3. Sends matched jobs to Telegram instantly

## Setup

```bash
npm install
cp .env.example .env.local
# Fill in your credentials
npm start
```

## Commands

- `npm start` — Run with cron scheduler
- `npm run scan` — Run a single scan
- `npm run test-notify` — Test Telegram notification

## Architecture

Reads config from MakiSync PostgreSQL database.
Scrapes Facebook groups with Puppeteer.
Matches jobs with Groq AI (llama-3.1-8b-instant).
Notifies via Telegram Bot API.

---

Part of the MakiSync ecosystem.
