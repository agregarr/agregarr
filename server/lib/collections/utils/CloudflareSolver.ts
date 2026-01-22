import logger from '@server/logger';
import { chromium, type BrowserContext } from 'playwright';

/**
 * Cloudflare Challenge Solver
 *
 * Uses Playwright headless browser to bypass Cloudflare protection.
 * Since Cloudflare uses TLS fingerprinting, we can't just get cookies -
 * we need to use the browser to fetch the actual content.
 */
export class CloudflareSolver {
  private static fetchInProgress: Map<string, Promise<string>> = new Map();

  /**
   * Fetch page content using Playwright, bypassing Cloudflare
   */
  static async fetchPage(url: string): Promise<string> {
    // Check if fetch is already in progress for this URL
    const inProgress = this.fetchInProgress.get(url);
    if (inProgress) {
      logger.debug('Page fetch already in progress, waiting...', {
        label: 'Cloudflare Solver',
        url,
      });
      return await inProgress;
    }

    // Start fetching
    const fetchPromise = this.fetchWithBrowser(url);
    this.fetchInProgress.set(url, fetchPromise);

    try {
      const content = await fetchPromise;
      return content;
    } finally {
      this.fetchInProgress.delete(url);
    }
  }

  /**
   * Fetch page content using Playwright browser
   */
  private static async fetchWithBrowser(url: string): Promise<string> {
    const domain = new URL(url).hostname;

    logger.info('Fetching page with Playwright (Cloudflare bypass)', {
      label: 'Cloudflare Solver',
      domain,
      url,
    });

    let context: BrowserContext | null = null;

    try {
      // Use system Chromium if configured (Docker/Alpine), otherwise use Playwright's
      const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

      const browser = await chromium.launch({
        headless: true,
        executablePath: executablePath || undefined,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
        ],
      });

      context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        },
      });

      const page = await context.newPage();

      // Add stealth measures to avoid detection
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });

        (window as Window & { chrome?: object }).chrome = {
          runtime: {},
        };

        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });

        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
      });

      logger.debug('Navigating to URL', {
        label: 'Cloudflare Solver',
        url,
      });

      // Navigate and wait for content to load
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      const status = response?.status();
      logger.debug('Response received', {
        label: 'Cloudflare Solver',
        status,
      });

      // If we got a challenge page, wait for it to resolve
      const maxWaitTime = 30000;
      const pollInterval = 500;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        const pageTitle = await page.title();
        const isChallengePage =
          pageTitle.includes('Just a moment') ||
          pageTitle.includes('Checking your browser') ||
          pageTitle === '';

        if (!isChallengePage) {
          logger.debug('Page loaded successfully', {
            label: 'Cloudflare Solver',
            pageTitle,
            elapsedMs: Date.now() - startTime,
          });
          break;
        }

        logger.debug('Waiting for challenge to complete...', {
          label: 'Cloudflare Solver',
          pageTitle,
          elapsedMs: Date.now() - startTime,
        });

        await page.waitForTimeout(pollInterval);
      }

      // Get the page content
      const content = await page.content();

      logger.info('Successfully fetched page content', {
        label: 'Cloudflare Solver',
        domain,
        contentLength: content.length,
      });

      await browser.close();

      return content;
    } catch (error) {
      logger.error('Failed to fetch page with Playwright', {
        label: 'Cloudflare Solver',
        domain,
        error: error instanceof Error ? error.message : String(error),
      });

      if (context) {
        await context.browser()?.close();
      }

      throw new Error(
        `Failed to fetch ${domain} page: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
