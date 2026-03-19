
import type { Page } from "playwright";

export interface WaitForAnyOptions {
  timeoutMs: number;
  stage?: string;
  url?: string;
}

export async function waitForAny(page: Page, selectors: string[], options: WaitForAnyOptions): Promise<void> {
  const url = options.url ?? page.url();
  try {
    await Promise.any(selectors.map((selector) => page.locator(selector).first().waitFor({ state: "visible", timeout: options.timeoutMs })));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `waitForAny timeout stage=${options.stage ?? "unknown"} url=${url} selectors=${selectors.join(" | ")} timeoutMs=${options.timeoutMs} cause=${reason}`
    );
  }
}

export async function clickFirstVisible(page: Page, selectors: string[]): Promise<void> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await locator.click().catch(() => undefined);
      return;
    }
  }
}
