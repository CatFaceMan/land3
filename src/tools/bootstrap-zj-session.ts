import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const ENTRY_URL = "https://www.zjzrzyjy.com/landView/land-bidding";
const DEFAULT_STATE_PATH = "output/sessions/zhejiang-storage-state.json";
const DEFAULT_WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 2_000;

function isChallengePage(title: string, text: string): boolean {
  const combined = `${title}\n${text}`.toLowerCase();
  const markers = [
    "滑动验证",
    "访问验证",
    "请按住滑块",
    "请进行验证",
    "请完成验证",
    "traceid",
    "captcha",
    "verify"
  ];
  return markers.some((marker) => combined.includes(marker));
}

async function run(): Promise<void> {
  const statePath = resolve(process.env.ZJ_STORAGE_STATE_PATH?.trim() || DEFAULT_STATE_PATH);
  const waitMs = Number(process.env.ZJ_SESSION_WAIT_MS ?? DEFAULT_WAIT_MS);
  const maxWaitMs = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : DEFAULT_WAIT_MS;

  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  try {
    await page.goto(ENTRY_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
    process.stdout.write(
      `Opened ${ENTRY_URL}\nPlease complete any slider/captcha in the browser window.\nWaiting up to ${Math.floor(maxWaitMs / 1000)}s...\n`
    );

    const deadline = Date.now() + maxWaitMs;
    let passed = false;
    while (Date.now() < deadline) {
      const title = (await page.title().catch(() => "")).trim();
      const bodyText = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim()).catch(() => "");
      const hasList = await page
        .locator("section .source-info-item > a:visible, .source-info-item > a:visible, a.expand-card-wrapper.d-block:visible")
        .first()
        .isVisible()
        .catch(() => false);
      if (!isChallengePage(title, bodyText) && hasList) {
        passed = true;
        break;
      }
      await page.waitForTimeout(POLL_MS);
    }

    if (!passed) {
      throw new Error("Verification was not completed within the waiting window.");
    }

    await mkdir(dirname(statePath), { recursive: true });
    await context.storageState({ path: statePath });
    process.stdout.write(`Saved storage state: ${statePath}\n`);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
