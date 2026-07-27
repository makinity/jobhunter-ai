import puppeteer from 'puppeteer';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

    // Override navigator properties that giveaway headless Chrome
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    // Load cookies
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
    console.log(`  ℹ Page title: "${pageTitle.substring(0, 80)}"`);

    // Check if we hit a login wall
    const isLoginPage = postLoginUrl.includes('login') || postLoginUrl.includes('checkpoint')
      || pageTitle.toLowerCase().includes('log in') || pageTitle.toLowerCase().includes('confirm')
      || (await page.$('input[name="email"], input[name="pass"], #email, #pass').catch(() => null));

    if (isLoginPage) {
      console.log(`  ❌ Facebook login wall detected — cookies expired or blocked from this IP.`);
      console.log(`  ⚠ Try re-exporting cookies from your browser (see MAINTENANCE.md).`);
      await browser.close();
      return [];
    }

    console.log(`  ✅ Session valid!`);

    // ── Step 2: Navigate to group ──
    console.log(`  🌐 Navigating to group...`);
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Wait briefly for any checkpoint or redirect to settle
    await new Promise(r => setTimeout(r, 3000));

    const groupPageUrl = page.url();
    const groupPageTitle = await page.title().catch(() => '');

    console.log(`  ℹ Group page: "${groupPageTitle.substring(0, 80)}" (URL: ${groupPageUrl.substring(0, 80)})`);

    // Check if we got redirected away from the group
    const isCheckpoint = groupPageUrl.includes('checkpoint')
      || groupPageUrl.includes('login')
      || groupPageUrl.includes('two_step')
      || groupPageUrl === 'https://www.facebook.com/'
      || groupPageUrl === 'https://facebook.com/';

    if (isCheckpoint) {
      console.log(`  ❌ Facebook blocked group access — redirect to: ${groupPageUrl}`);
      console.log(`  ⚠ This usually means Facebook detected the headless browser.`);
      console.log(`  ⚠ Try: 1) Re-export cookies from browser, 2) Use a different UA, or 3) Run locally instead of cloud.`);

      // Try one more thing: navigate back and wait longer
      console.log(`  🔄 Retrying with longer wait...`);
      await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000));

      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise(r => setTimeout(r, 5000));

      const retryUrl = page.url();
      const retryTitle = await page.title().catch(() => '');
      console.log(`  ℹ Retry: "${retryTitle.substring(0, 80)}" (${retryUrl.substring(0, 80)})`);

      if (retryUrl.includes('checkpoint') || retryUrl.includes('login') || retryUrl === 'https://www.facebook.com/') {
        console.log(`  ❌ Still blocked after retry. Skipping group.`);
        await browser.close();
        return [];
      }

      console.log(`  ✅ Retry succeeded!`);
    }

    // Wait for feed content to load
    await page.waitForSelector('[role="feed"], [role="article"], [data-pagelet*="FeedUnit"]', { timeout: 20000 }).catch(() => {});

    // ── Step 3: Scroll to load more posts ──
    await autoScroll(page, 5);

    // ── Step 4: Extract posts ──
    const posts = await page.evaluate((max) => {
      const results = [];
      const seen = new Set();

      const selectors = [
        '[role="article"]',
        '[data-pagelet*="FeedUnit"]',
        'div[class*="userContent"]',
        'div[data-testid*="story"]',
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

async function autoScroll(page, times) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await new Promise(r => setTimeout(r, 2000));
  }
}
