import { chromium } from "playwright";

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length).trim() : null;
}

async function main(): Promise<void> {
  const endpoint = parseArg("endpoint") ?? "http://127.0.0.1:9222";
  const site = parseArg("site") ?? "hangzhou";
  const targetUrl = "https://www.zjzrzyjy.com/landView/land-bidding";
  const waitMsRaw = Number(parseArg("wait-ms") ?? "120000");
  const waitMs = Number.isFinite(waitMsRaw) && waitMsRaw > 0 ? waitMsRaw : 120000;

  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(60_000);

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const started = Date.now();
    let hasList = false;
    while (Date.now() - started < waitMs) {
      hasList = await page
        .locator("section .source-info-item > a:visible, .source-info-item > a:visible, a.expand-card-wrapper.d-block:visible")
        .first()
        .isVisible()
        .catch(() => false);
      if (hasList) {
        break;
      }
      await page.waitForTimeout(1500);
    }

    const title = await page.title().catch(() => "");
    const url = page.url();
    const text = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 300)).catch(() => "");
    process.stdout.write(
      `${JSON.stringify({ mode: "cdp", endpoint, site, waitMs, url, title, hasList, text }, null, 2)}\n`
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

