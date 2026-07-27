# JobHunter AI — Maintenance Guide

## 🔄 Re-export Facebook Cookies (Every 2 Weeks)

Facebook cookies expire after about 30 days. To keep the scanner working, you need to re-export them **every 2 weeks**.

### When to re-export
The scanner will send you a Telegram reminder when it's time.

### How to re-export
1. Go to **facebook.com** in your browser (make sure you're logged in)
2. Open the **Cookie Editor** extension
3. Click **Export** → copies JSON to clipboard
4. Come back here and paste the new cookies → I'll save them

### Where to update (3 places)

| Platform | Where | How |
|----------|-------|-----|
| **Local** (`windows task scheduler`) | `cookies/facebook.json` | Replace file with new export |
| **GitHub Actions** | Repo → Settings → Secrets → `FB_COOKIES` | Update the base64 value |
| **Vercel** (if deployed) | Environment Variables → `FB_COOKIES` | Update the base64 value |

### How to encode for cloud:
```bash
# After exporting cookies to cookies/facebook.json
node -e "const fs=require('fs'); console.log(Buffer.from(fs.readFileSync('cookies/facebook.json')).toString('base64'))"
# Copy output → paste into GitHub/Vercel secret
```

### Check current expiry:
```bash
node -e "const c=JSON.parse(require('fs').readFileSync('cookies/facebook.json')); c.sort((a,b)=>(a.expires||0)-(b.expires||0)); console.log('Earliest:',new Date(c[0].expires*1000).toLocaleDateString())"
```

## ✅ Telegram notifications
Notifications come via **@MakiSyncBot** — matches found AND cookie expiry reminders.
