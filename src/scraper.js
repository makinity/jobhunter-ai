import puppeteer from 'puppeteer';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIES_PATH = join(__dirname, '..', 'cookies', 'facebook.json');

/**
 * Scrapes recent posts from a Facebook group using authenticated session.
 *
 * Returns: [{ title, content, author, url, timestamp }]
 */
export async function scrapeGroup(groupUrl, options = {}) {
  const { headless = true, maxPosts = 10 } = options;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: headless === true || headless === 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    // Set a realistic viewport and user agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    // Load Facebook cookies
    try {
      const cookieData = await readFile(COOKIES_PATH, 'utf-8');
      const cookies = JSON.parse(cookieData);
      await page.setCookie(...cookies);
      console.log(`  🔑 Loaded ${cookies.length} cookies`);
    } catch (err) {
      console.warn(`  ⚠️ No cookies found at ${COOKIES_PATH}. Scraping as guest.`);
    }

    // Navigate to the group
    console.log(`  🌐 Navigating to group...`);
    await page.goto(groupUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for content to load
    await page.waitForSelector('[role="feed"], [role="article"], [data-pagelet*="FeedUnit"]', { timeout: 15000 }).catch(() => {});

    // Scroll down to load more posts
    await autoScroll(page, 5);

    // Extract posts
    const posts = await page.evaluate((max) => {
      const results = [];
      const seen = new Set();

      // Try multiple selectors for Facebook post containers
      const selectors = [
        '[role="article"]',
        '[data-pagelet*="FeedUnit"]',
        'div[class*="userContent"]',
      ];

      let postElements = [];
      for (const sel of selectors) {
        postElements = document.querySelectorAll(sel);
        if (postElements.length > 0) break;
      }

      for (const el of postElements) {
        if (results.length >= max) break;

        // Extract text content
        const textEl = el.querySelector('[data-ad-preview="message"], [data-testid="post_message"], div[dir="auto"]');
        const text = textEl?.innerText?.trim() || '';
        if (!text || text.length < 20) continue;

        // Deduplicate by first 50 chars
        const key = text.substring(0, 50).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        // Extract author
        const authorEl = el.querySelector('strong, span[class*="profileName"], a[role="link"]');
        const author = authorEl?.innerText?.trim() || 'Unknown';

        // Extract link
        const linkEl = el.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/story.php"]');
        const url = linkEl?.href || '';

        // Title = first meaningful line
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

// Auto-scroll helper
async function autoScroll(page, times) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await new Promise(r => setTimeout(r, 2000));
  }
}
