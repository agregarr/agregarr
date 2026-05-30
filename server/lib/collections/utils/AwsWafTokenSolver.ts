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
  private static readonly MAX_TOKEN_TTL = 5 * 60 * 1000; // 5 minutes
  private static readonly BACKOFF_BASE_MS = 60 * 1000; // 1 minute

  private static tokenCache: Map<
    string,
    { token: string; expiresAt: number; sessionCookies: Cookie[] }
  > = new Map();
  private static solvingInProgress: Map<string, Promise<Cookie[]>> = new Map();
  private static solveFailures: Map<
    string,
    { count: number; backoffUntil: number }
  > = new Map();

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

    // Check if we're in backoff after repeated failures
    const failure = this.solveFailures.get(domain);
    if (failure && failure.backoffUntil > Date.now()) {
      const waitSecs = Math.round((failure.backoffUntil - Date.now()) / 1000);
      logger.warn(
        `WAF solver in backoff after ${failure.count} failures, ${waitSecs}s remaining`,
        { label: 'AWS WAF Solver', domain }
      );
      throw new Error(
        `WAF solver backing off for ${domain} (${failure.count} consecutive failures)`
      );
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

    logger.info('Solving AWS WAF challenge for domain', {
      label: 'AWS WAF Solver',
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
      });

      const page = await context.newPage();

      // Navigate to the URL
      logger.debug('Navigating to URL to trigger WAF challenge', {
        label: 'AWS WAF Solver',
        url,
      });

      const response = await page.goto(url, {
        waitUntil: 'networkidle',
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
        await page.waitForLoadState('networkidle', { timeout: 30000 });

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

      // Cap cache TTL — server can invalidate tokens well before cookie expiry
      const cookieExpiry = wafToken.expires
        ? wafToken.expires * 1000
        : Date.now() + this.MAX_TOKEN_TTL;
      const expiresAt = Math.min(cookieExpiry, Date.now() + this.MAX_TOKEN_TTL);

      this.tokenCache.set(domain, {
        token: wafToken.value,
        expiresAt,
        sessionCookies: cookies,
      });

      // Reset failure counter on success
      this.solveFailures.delete(domain);

      await browser.close();

      return cookies;
    } catch (error) {
      // Track consecutive failures for backoff
      const prev = this.solveFailures.get(domain);
      const count = (prev?.count ?? 0) + 1;
      const backoffMs =
        this.BACKOFF_BASE_MS * Math.pow(2, Math.min(count - 1, 4));
      this.solveFailures.set(domain, {
        count,
        backoffUntil: Date.now() + backoffMs,
      });

      logger.error('Failed to solve AWS WAF challenge', {
        label: 'AWS WAF Solver',
        domain,
        consecutiveFailures: count,
        backoffSeconds: Math.round(backoffMs / 1000),
        error: error instanceof Error ? error.message : String(error),
      });

      if (context) {
        await context.browser()?.close();
      }

      throw new Error(
        `Failed to solve AWS WAF challenge for ${domain}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Clear cached token for a domain (preserves backoff state)
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

  /**
   * Full reset — clears tokens AND backoff state
   */
  static resetAll(domain?: string): void {
    this.clearCache(domain);
    if (domain) {
      this.solveFailures.delete(domain);
    } else {
      this.solveFailures.clear();
    }
  }
}
