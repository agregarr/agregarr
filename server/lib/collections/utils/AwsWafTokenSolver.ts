import logger from '@server/logger';
import { chromium, type BrowserContext, type Cookie } from 'playwright';

/**
 * AWS WAF Token Solver
 *
 * Solves AWS WAF JavaScript challenges using Playwright headless browser
 * to obtain the aws-waf-token cookie needed for IMDb requests.
 *
 * The token is cached and reused until it expires (typically 5-10 minutes).
 */
export class AwsWafTokenSolver {
  private static tokenCache: Map<
    string,
    { token: string; expiresAt: number; sessionCookies: Cookie[] }
  > = new Map();
  private static solvingInProgress: Map<string, Promise<Cookie[]>> = new Map();

  /**
   * Domain-to-simple-page map for WAF token acquisition.
   * (can obtain them from any page on the domain)
   * Using a simple, fast-loading page avoids networkidle timeouts on complex pages
   * (the IMDb user lists page should never reach networkidle in 30s).
   */
  private static readonly DOMAIN_SOLVE_URLS: Record<string, string> = {
    'www.imdb.com': 'https://www.imdb.com/chart/top/',
    'imdb.com': 'https://www.imdb.com/chart/top/',
  };

  /**
   * Get cookies for a domain, solving WAF challenge if needed
   */
  static async getCookies(url: string): Promise<Cookie[]> {
    const domain = new URL(url).hostname;

    // Check if we have a valid cached token
    const cached = this.tokenCache.get(domain);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug('Using cached AWS WAF token', {
        label: 'AWS WAF Solver',
        domain,
        expiresIn: Math.round((cached.expiresAt - Date.now()) / 1000) + 's',
      });
      return cached.sessionCookies;
    }

    // Check if solving is already in progress for this domain
    const inProgress = this.solvingInProgress.get(domain);
    if (inProgress) {
      logger.debug('WAF challenge solve already in progress, waiting...', {
        label: 'AWS WAF Solver',
        domain,
      });
      return await inProgress;
    }

    // Start solving
    const solvePromise = this.solveChallenge(url);
    this.solvingInProgress.set(domain, solvePromise);

    try {
      const cookies = await solvePromise;
      return cookies;
    } finally {
      this.solvingInProgress.delete(domain);
    }
  }

  /**
   * Solve AWS WAF challenge using Playwright
   */
  private static async solveChallenge(url: string): Promise<Cookie[]> {
    const domain = new URL(url).hostname;

    // Use a known-simpler page for this domain if available
    const solveUrl = this.DOMAIN_SOLVE_URLS[domain] ?? url;

    logger.info('Solving AWS WAF challenge for domain', {
      label: 'AWS WAF Solver',
      domain,
      url: solveUrl,
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
      });

      const page = await context.newPage();

      // Navigate to the URL
      logger.debug('Navigating to URL to trigger WAF challenge', {
        label: 'AWS WAF Solver',
        url: solveUrl,
      });

      const response = await page.goto(solveUrl, {
        waitUntil: 'load',
        timeout: 30000,
      });

      const status = response?.status();
      logger.debug('Initial response received', {
        label: 'AWS WAF Solver',
        status,
      });

      // If we got a challenge (202), wait for it to complete
      if (status === 202) {
        logger.debug('AWS WAF challenge detected, waiting for completion...', {
          label: 'AWS WAF Solver',
        });

        // Wait for the challenge to complete (page will reload with 200)
        // Use 'load' to prevent continuous background requests causing 'networkidle' to never trigger
        await page.waitForLoadState('load', { timeout: 30000 });

        // Give it a moment to ensure cookies are set
        await page.waitForTimeout(1000);

        logger.debug('WAF challenge appears to be completed', {
          label: 'AWS WAF Solver',
        });
      }

      // Extract all cookies
      const cookies = await context.cookies();

      logger.debug('Extracted cookies from browser', {
        label: 'AWS WAF Solver',
        cookieCount: cookies.length,
        cookieNames: cookies.map((c) => c.name).join(', '),
      });

      // Find the aws-waf-token
      const wafToken = cookies.find((c) => c.name === 'aws-waf-token');

      if (!wafToken) {
        logger.warn('No aws-waf-token found after challenge completion', {
          label: 'AWS WAF Solver',
          availableCookies: cookies.map((c) => c.name),
        });
        throw new Error('Failed to obtain aws-waf-token');
      }

      logger.info('Successfully obtained AWS WAF token', {
        label: 'AWS WAF Solver',
        domain,
        tokenLength: wafToken.value.length,
      });

      // Cache the token (expires in 5 minutes or based on cookie expiry)
      const expiresAt = wafToken.expires
        ? wafToken.expires * 1000
        : Date.now() + 5 * 60 * 1000; // 5 minutes default

      this.tokenCache.set(domain, {
        token: wafToken.value,
        expiresAt,
        sessionCookies: cookies,
      });

      await browser.close();

      return cookies;
    } catch (error) {
      logger.error('Failed to solve AWS WAF challenge', {
        label: 'AWS WAF Solver',
        domain,
        error: error instanceof Error ? error.message : String(error),
      });

      if (context) {
        await context.browser()?.close();
      }

      throw new Error(
        `Failed to solve AWS WAF challenge for ${domain}: ${error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Clear cached token for a domain
   */
  static clearCache(domain?: string): void {
    if (domain) {
      this.tokenCache.delete(domain);
      logger.debug('Cleared cached token for domain', {
        label: 'AWS WAF Solver',
        domain,
      });
    } else {
      this.tokenCache.clear();
      logger.debug('Cleared all cached tokens', {
        label: 'AWS WAF Solver',
      });
    }
  }
}
