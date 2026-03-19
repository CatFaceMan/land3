import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { AppConfig, ArtifactPaths, BizType, FailureRecord, ProxyProfile, SiteCode } from "../domain/types.js";
import { saveArtifactBundle } from "./artifacts.js";

export class BrowserKernel {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private consecutiveFailures = 0;

  public constructor(
    private readonly config: AppConfig,
    private readonly siteCode: SiteCode,
    private readonly proxyProfile: ProxyProfile | null
  ) {}

  public async start(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }
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
    this.context = await this.browser.newContext({
      userAgent: this.config.browser.userAgent,
      ignoreHTTPSErrors: true
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.config.browser.timeoutMs);
    return this.page;
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
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null;
    this.context = null;
    this.browser = null;
    await this.start();
  }

  public async captureFailureArtifacts(bizType: BizType, key: string): Promise<ArtifactPaths> {
    const page = await this.getPage();
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
    const html = await page.content().catch(() => null);
    return saveArtifactBundle({
      artifactRoot: this.config.artifactRoot,
      siteCode: this.siteCode,
      bizType,
      key,
      screenshot,
      html
    });
  }

  public async createFailureRecord(input: Omit<FailureRecord, "currentUrl" | "screenshotPath" | "htmlPath">): Promise<FailureRecord> {
    const page = await this.getPage();
    const artifacts = await this.captureFailureArtifacts(input.bizType, `${input.pageNo}-${input.itemIndex}-${input.stage}`);
    return {
      ...input,
      currentUrl: page.url(),
      screenshotPath: artifacts.screenshotPath,
      htmlPath: artifacts.htmlPath
    };
  }

  public async close(): Promise<void> {
    await this.page?.close().catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}
