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
  private static htmlCache: Map<string, { html: string; fetchedAt: number }> =
    new Map();
  private static readonly HTML_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Fetch page content using Playwright, bypassing Cloudflare.
   * Results are cached for 5 minutes — the same URL is often requested
   * multiple times in quick succession (validate → extractTitle → page 1 fetch).
   */
  static async fetchPage(url: string): Promise<string> {
    // Return cached content if still fresh
    const cached = this.htmlCache.get(url);
    if (cached && Date.now() - cached.fetchedAt < this.HTML_CACHE_TTL) {
      logger.debug('Returning cached page content', {
        label: 'Cloudflare Solver',
        url,
        ageMs: Date.now() - cached.fetchedAt,
      });
      return cached.html;
    }

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
      this.htmlCache.set(url, { html: content, fetchedAt: Date.now() });
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

  /**
   * Fetch multiple pages using a single shared browser context.
   * More efficient than fetchPage() for batches since browser startup only happens once.
   */
  static async fetchPagesBatch(
    urls: string[],
    concurrency = 5
  ): Promise<Map<string, string>> {
    if (urls.length === 0) return new Map();

    const results = new Map<string, string>();
    const domain = new URL(urls[0]).hostname;

    logger.info(
      `Fetching ${urls.length} pages with shared browser (${concurrency} concurrent)`,
      {
        label: 'Cloudflare Solver',
        domain,
        total: urls.length,
        concurrency,
      }
    );

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

    try {
      const context = await browser.newContext({
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

      // Apply stealth measures once for all pages from this context
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        (window as Window & { chrome?: object }).chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
      });

      for (let i = 0; i < urls.length; i += concurrency) {
        const batch = urls.slice(i, i + concurrency);

        const batchResults = await Promise.all(
          batch.map(async (url) => {
            const page = await context.newPage();
            try {
              await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
              });
              const content = await page.content();
              return { url, content };
            } catch (error) {
              logger.debug(
                `Failed to fetch ${url}: ${
                  error instanceof Error ? error.message : 'Unknown'
                }`,
                { label: 'Cloudflare Solver' }
              );
              return { url, content: null };
            } finally {
              await page.close();
            }
          })
        );

        for (const { url, content } of batchResults) {
          if (content) {
            results.set(url, content);
          }
        }

        if (i + concurrency < urls.length) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      logger.info(
        `Batch fetch complete: ${results.size}/${urls.length} pages fetched`,
        {
          label: 'Cloudflare Solver',
          domain,
          fetched: results.size,
          total: urls.length,
        }
      );
    } finally {
      await browser.close();
    }

    return results;
  }
}
