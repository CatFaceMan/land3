import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { AppConfig, ProxyProfile, SiteCode } from "../domain/types.js";

export class BrowserKernel {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private consecutiveFailures = 0;
  private ownsBrowser = true;

  public constructor(
    private readonly config: AppConfig,
    private readonly siteCode: SiteCode,
    private readonly proxyProfile: ProxyProfile | null
  ) {}

  public async start(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }
    const siteRuntime = this.config.sites[this.siteCode];
    const storageStatePath = siteRuntime?.storageStatePath;
    const cdpEndpoint = this.config.browser.cdpEndpoint;
    if (cdpEndpoint) {
      this.ownsBrowser = false;
      this.browser = await this.connectOverCDPWithRetry(cdpEndpoint);
      this.context = this.browser.contexts()[0] ?? await this.browser.newContext({
        userAgent: this.config.browser.userAgent,
        ignoreHTTPSErrors: true
      });
      this.page = await this.context.newPage();
    } else {
      this.ownsBrowser = true;
      this.browser = await chromium.launch({
        headless: this.config.browser.headless,
        proxy: this.proxyProfile?.enabled && this.proxyProfile.server
          ? {
              server: this.proxyProfile.server,
              username: this.proxyProfile.username,
              password: this.proxyProfile.password
            }
          : undefined
      });
      let storageState: string | undefined;
      if (storageStatePath) {
        try {
          await access(storageStatePath);
          storageState = storageStatePath;
        } catch {
          storageState = undefined;
        }
      }
      this.context = await this.browser.newContext({
        userAgent: this.config.browser.userAgent,
        ignoreHTTPSErrors: true,
        storageState
      });
      this.page = await this.context.newPage();
    }
    this.page.setDefaultTimeout(this.config.browser.timeoutMs);
    return this.page;
  }

  private async connectOverCDPWithRetry(endpoint: string): Promise<Browser> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await chromium.connectOverCDP(endpoint);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < 3) {
          await this.sleep(1000 * attempt);
        }
      }
    }
    const proxyHints = [
      process.env.HTTP_PROXY ? `HTTP_PROXY=${process.env.HTTP_PROXY}` : null,
      process.env.HTTPS_PROXY ? `HTTPS_PROXY=${process.env.HTTPS_PROXY}` : null,
      process.env.NO_PROXY ? `NO_PROXY=${process.env.NO_PROXY}` : null
    ].filter(Boolean).join(", ");
    throw new Error(
      `connectOverCDP failed after retries endpoint=${endpoint}; ${proxyHints || "no proxy env"}; ` +
      `ensure Chrome is running with --remote-debugging-port and localhost is excluded from proxy. ` +
      `lastError=${lastError?.message ?? "unknown"}`
    );
  }

  public async getPage(): Promise<Page> {
    return this.start();
  }

  public async newPage(): Promise<Page> {
    if (!this.context) {
      await this.start();
    }
    if (!this.context) {
      throw new Error("Failed to initialize browser context");
    }
    const page = await this.context.newPage();
    page.setDefaultTimeout(this.config.browser.timeoutMs);
    return page;
  }

  public bindPage(page: Page): void {
    this.page = page;
    this.page.setDefaultTimeout(this.config.browser.timeoutMs);
  }

  public async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  public resetFailureCounter(): void {
    this.consecutiveFailures = 0;
  }

  public async recoverAfterFailure(): Promise<Page> {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.config.browser.retry.contextResetThreshold) {
      await this.restartContext();
      this.consecutiveFailures = 0;
    } else if (this.page?.isClosed()) {
      this.page = await this.context?.newPage() ?? null;
    }
    return this.getPage();
  }

  public async restartContext(): Promise<void> {
    await this.page?.close().catch(() => undefined);
    if (this.ownsBrowser) {
      await this.context?.close().catch(() => undefined);
      await this.browser?.close().catch(() => undefined);
    } else {
      await this.browser?.close().catch(() => undefined);
    }
    this.page = null;
    this.context = null;
    this.browser = null;
    await this.start();
  }

  public async close(): Promise<void> {
    const storageStatePath = this.config.sites[this.siteCode]?.storageStatePath;
    if (this.context && storageStatePath) {
      try {
        await mkdir(dirname(storageStatePath), { recursive: true });
        await this.context.storageState({ path: storageStatePath });
      } catch {
        // Ignore storage persistence failures
      }
    }
    await this.page?.close().catch(() => undefined);
    if (this.ownsBrowser) {
      await this.context?.close().catch(() => undefined);
      await this.browser?.close().catch(() => undefined);
    } else {
      // In CDP mode, keep the user-owned Chrome context/browser alive.
      await this.browser?.close().catch(() => undefined);
    }
    this.page = null;
    this.context = null;
    this.browser = null;
    this.ownsBrowser = true;
  }
}
