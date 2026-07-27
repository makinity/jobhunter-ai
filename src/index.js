import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { CronJob } from 'cron';
import { readFile, writeFile } from 'fs/promises';
import { getConfig, getActiveGroups, getSkills, updateGroupScan, saveMatch, markNotified } from './db.js';
import { scrapeGroup } from './scraper.js';
import { matchJob } from './matcher.js';
import { sendNotification } from './notifier.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Interval map ──────────────────────────────────────────
const INTERVAL_MAP = {
  '15m': '*/15 * * * *',
  '30m': '*/30 * * * *',
  '1h':  '0 * * * *',
  '2h':  '0 */2 * * *',
  '6h':  '0 */6 * * *',
  '12h': '0 */12 * * *',
};

// ── Cookie expiry reminder ────────────────────────────────
async function checkCookieExpiry() {
  try {
    const metaPath = join(__dirname, '..', 'cookies', 'facebook-meta.json');
    const raw = await readFile(metaPath, 'utf-8');
    const meta = JSON.parse(raw);
    const now = Date.now() / 1000;
    const daysLeft = Math.floor((meta.earliest_expiry - now) / 86400);

    // Check if cookies are expiring soon (within 3 days)
    if (daysLeft <= 3 && daysLeft >= 0) {
      // Only remind once per day
      const lastReminded = meta.last_reminded ? new Date(meta.last_reminded).toDateString() : null;
      const today = new Date().toDateString();

      if (lastReminded !== today && meta.reminded_count < 3) {
        const chatId = process.env.TELEGRAM_CHAT_ID;
        const token = process.env.TELEGRAM_BOT_TOKEN;

        if (chatId && token) {
          const msg = daysLeft === 0
            ? `⚠️ <b>Facebook Cookies Expiring TODAY!</b>\n\nYour Facebook session cookies are expiring <b>today</b>. The scanner will stop working soon.\n\n📋 Re-export cookies from facebook.com using Cookie Editor and update your secrets.`
            : `⚠️ <b>Facebook Cookies Expiring in ${daysLeft} Day${daysLeft > 1 ? 's' : ''}</b>\n\nYour Facebook session cookies used by JobHunter AI will expire soon.\n\n⏰ Expiry: ${new Date(meta.earliest_expiry * 1000).toLocaleDateString()}\n📋 Re-export cookies from facebook.com using the Cookie Editor extension.`;

          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
          });
          console.log(`  📱 Cookie expiry reminder sent (${daysLeft} day(s) remaining)`);
        }

        // Update meta
        meta.last_reminded = new Date().toISOString();
        meta.reminded_count = (meta.reminded_count || 0) + 1;
        await writeFile(metaPath, JSON.stringify(meta, null, 2));
      }
    }

    return daysLeft;
  } catch {
    return 999; // No meta file = can't check
  }
}

// ── Main scan function ────────────────────────────────────
async function runScan() {
  const startTime = Date.now();
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🔍 JobHunter AI Scan — ${new Date().toLocaleString()}`);
  console.log(`${'='.repeat(50)}`);

  // 0. Check cookie expiry
  const daysLeft = await checkCookieExpiry();
  console.log(`🍪 Cookies: ${daysLeft >= 999 ? 'unknown' : daysLeft + ' days remaining'}`);

  // 1. Check if enabled
  const config = await getConfig();
  if (!config?.enabled) {
    console.log('⏸️  Monitoring is disabled. Skipping scan.');
    return;
  }

  // 2. Get active groups and skills
  const groups = await getActiveGroups();
  const skills = await getSkills();

  if (groups.length === 0) {
    console.log('⚠️  No active groups to scan.');
    return;
  }
  if (skills.length === 0) {
    console.log('⚠️  No skills configured for matching.');
    return;
  }

  console.log(`📋 Config: interval=${config.scan_interval}, min_score=${config.min_match_score}, auto_notify=${config.auto_notify}`);
  console.log(`📚 Groups: ${groups.length} active`);
  console.log(`🧠 Skills: ${skills.length} (${skills.join(', ')})`);

  let totalMatches = 0;
  let totalNotifications = 0;

  // 3. Scan each group
  for (const group of groups) {
    console.log(`\n── Scanning: ${group.name} ──`);
    console.log(`   URL: ${group.url}`);

    try {
      const posts = await scrapeGroup(group.url, { headless: true, maxPosts: 10 });

      if (posts.length === 0) {
        console.log('   No posts found.');
        await updateGroupScan(group.id);
        continue;
      }

      for (const post of posts) {
        const result = await matchJob(post, skills);
        console.log(`   ${result.score >= config.min_match_score ? '✅' : '⏭️'} MATCH (${result.score}%): ${post.title.substring(0, 50)}...`);

        if (result.score >= config.min_match_score) {
          // Save to DB
          const match = await saveMatch(
            group.id,
            post.title,
            post.content,
            post.author,
            post.url,
            result.score
          );

          if (match) {
            totalMatches++;

            // Send notification
            if (config.auto_notify) {
              const notified = await sendNotification(match, group.name);
              if (notified) {
                totalNotifications++;
                await markNotified(match.id);
              }
            }
          }
        }
      }

      await updateGroupScan(group.id);
    } catch (err) {
      console.error(`   ❌ Error scanning ${group.name}: ${err.message}`);
    }
  }

  // 4. Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Scan complete in ${elapsed}s`);
  console.log(`   Matches: ${totalMatches}`);
  console.log(`   Notifications: ${totalNotifications}`);
  console.log(`${'='.repeat(50)}\n`);
}

// ── CLI mode ──────────────────────────────────────────────
const isOnce = process.argv.includes('--once');

if (isOnce) {
  // Single scan mode
  runScan()
    .then(() => process.exit(0))
    .catch(err => { console.error('Fatal:', err); process.exit(1); });
} else {
  // Cron scheduler mode
  console.log('🚀 JobHunter AI — Scheduler started');
  console.log('   Use --once for a single scan');
  console.log('');

  // Initial scan on startup
  runScan().catch(console.error);

  // Set up cron based on config (default: 30m)
  let cronExpression = INTERVAL_MAP['30m'];
  let lastInterval = '30m';

  // Check config periodically and update cron if interval changes
  async function updateCronSchedule() {
    try {
      const config = await getConfig();
      if (config?.scan_interval && config.scan_interval !== lastInterval) {
        cronExpression = INTERVAL_MAP[config.scan_interval] || INTERVAL_MAP['30m'];
        lastInterval = config.scan_interval;
        console.log(`⏰ Schedule updated to: ${config.scan_interval} (${cronExpression})`);
      }
    } catch {}
  }

  // Check config every 5 minutes
  setInterval(updateCronSchedule, 5 * 60 * 1000);

  // Run scan on cron
  const job = new CronJob(cronExpression, () => {
    runScan().catch(console.error);
  });
  job.start();

  console.log(`⏰ Scanning every ${lastInterval}`);
  console.log('   Press Ctrl+C to stop\n');

  // Keep alive
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    job.stop();
    process.exit(0);
  });
}
