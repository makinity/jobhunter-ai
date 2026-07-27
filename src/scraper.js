import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Apply stealth plugin (many evasions to avoid headless detection)
puppeteer.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIES_PATH = join(__dirname, '..', 'cookies', 'facebook.json');

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--window-size=1366,768',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-blink-features=AutomationControlled',
  '--lang=en-US',
  '--disable-component-update',
  '--disable-background-networking',
];

/**
 * Scrapes recent posts from a Facebook group using authenticated session.
 * Returns: [{ title, content, author, url, timestamp }]
 */
export async function scrapeGroup(groupUrl, options = {}) {
  const { maxPosts = 10 } = options;
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: LAUNCH_ARGS,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    );

    // Load cookies before any navigation
    try {
      const cookieData = await readFile(COOKIES_PATH, 'utf-8');
      const cookies = JSON.parse(cookieData);
      await page.setCookie(...cookies);
      console.log(`  🔑 Loaded ${cookies.length} cookies`);
    } catch (err) {
      console.warn(`  ⚠ No cookies found. Scraping as guest.`);
    }

    // ── Step 1: Validate session on facebook.com ──
    console.log(`  🌐 Validating Facebook session...`);
    await page.goto('https://www.facebook.com/', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    }).catch(() => {});

    const postLoginUrl = page.url();
    const pageTitle = await page.title().catch(() => '');
    console.log(`  ℹ Page: "${pageTitle.substring(0, 80)}" | URL: ${postLoginUrl.substring(0, 100)}`);

    // Check for login wall
    const isLoginPage = postLoginUrl.includes('login') || postLoginUrl.includes('checkpoint')
      || pageTitle.toLowerCase().includes('log in') || pageTitle.toLowerCase().includes('confirm')
      || (await page.$('input[name="email"], input[name="pass"], #email, #pass').catch(() => null));

    if (isLoginPage) {
      console.log(`  ❌ Facebook login wall — cookies don't work from this IP.`);
      console.log(`  ⚠ Re-export cookies from your browser (see MAINTENANCE.md).`);
      await browser.close();
      return [];
    }

    console.log(`  ✅ Session valid!`);

    // ── Step 2: Small human-like delay before group navigation ──
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

    // ── Step 3: Try navigating to group ──
    console.log(`  🌐 Navigating to group...`);
    const loaded = await navigateWithRetry(page, groupUrl);

    if (!loaded) {
      // Try mobile URL as fallback
      const mobileUrl = groupUrl
        .replace('https://www.facebook.com/', 'https://m.facebook.com/')
        .replace('https://facebook.com/', 'https://m.facebook.com/');
      if (mobileUrl !== groupUrl) {
        console.log(`  📱 Trying mobile URL fallback...`);
        const mobileLoaded = await navigateWithRetry(page, mobileUrl);
        if (!mobileLoaded) {
          console.log(`  ❌ Cannot access group. Skipping.`);
          await browser.close();
          return [];
        }
      } else {
        console.log(`  ❌ Cannot access group. Skipping.`);
        await browser.close();
        return [];
      }
    }

    // ── Step 4: Wait for feed content ──
    await page.waitForSelector('[role="feed"], [role="article"], [data-pagelet*="FeedUnit"]', { timeout: 20000 }).catch(() => {});

    // ── Step 5: Scroll to load more posts ──
    await autoScroll(page, 5);

    // ── Step 6: Extract posts ──
    const posts = await page.evaluate((max) => {
      const results = [];
      const seen = new Set();

      const selectors = [
        '[role="article"]',
        '[data-pagelet*="FeedUnit"]',
        'div[class*="userContent"]',
        'div[data-testid*="story"]',
        'div[class*="story_body_container"]',
      ];

      let postElements = [];
      for (const sel of selectors) {
        postElements = document.querySelectorAll(sel);
        if (postElements.length > 0) break;
      }

      for (const el of postElements) {
        if (results.length >= max) break;

        const textEl = el.querySelector('[data-ad-preview="message"], [data-testid="post_message"], div[dir="auto"]');
        const text = textEl?.innerText?.trim() || '';
        if (!text || text.length < 20) continue;

        const key = text.substring(0, 50).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const authorEl = el.querySelector('strong, span[class*="profileName"], a[role="link"]');
        const author = authorEl?.innerText?.trim() || 'Unknown';

        const linkEl = el.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/story.php"]');
        const url = linkEl?.href || '';

        const lines = text.split('\n').filter(l => l.trim().length > 5);
        const title = lines[0]?.substring(0, 120) || 'Untitled Post';

        results.push({
          title,
          content: text.substring(0, 1500),
          author,
          url,
          timestamp: new Date().toISOString(),
        });
      }

      return results;
    }, maxPosts);

    console.log(`  📄 Scraped ${posts.length} posts from group`);
    return posts;

  } catch (err) {
    console.error(`  ❌ Scraper error: ${err.message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Navigate to a URL and retry if redirected to a checkpoint/login page.
 * Returns true if successfully loaded, false if blocked.
 */
async function navigateWithRetry(page, url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000));

    const currentUrl = page.url();
    const title = await page.title().catch(() => '');

    console.log(`  ℹ Attempt ${attempt}: "${title.substring(0, 60)}"`);

    const isBlocked = currentUrl.includes('checkpoint')
      || currentUrl.includes('login')
      || currentUrl === 'https://www.facebook.com/'
      || currentUrl === 'https://facebook.com/'
      || currentUrl === 'https://m.facebook.com/';

    if (!isBlocked) {
      return true; // Successfully loaded
    }

    console.log(`  ⚠ Attempt ${attempt} blocked (redirect to ${currentUrl.substring(0, 60)})`);

    if (attempt === 1) {
      // Before retry, go back to main Facebook and wait
      console.log(`  🔄 Retrying...`);
      await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 4000 + Math.random() * 2000));
    }
  }
  return false; // Both attempts failed
}

async function autoScroll(page, times) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await new Promise(r => setTimeout(r, 2000));
  }
}
