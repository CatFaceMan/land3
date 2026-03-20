import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

type Mode = "headed" | "headless";
type Site = "hangzhou" | "ningbo";

const URL_BY_SITE: Record<Site, string> = {
  hangzhou: "https://www.zjzrzyjy.com/landView/land-bidding",
  ningbo: "https://www.zjzrzyjy.com/landView/land-bidding"
};

const LIST_SELECTOR = "section .source-info-item > a:visible, .source-info-item > a:visible, a.expand-card-wrapper.d-block:visible";

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length).trim() : null;
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function isChallenge(title: string, bodyText: string): boolean {
  const joined = `${title}\n${bodyText}`.toLowerCase();
  return [
    "滑动验证",
    "访问验证",
    "请按住滑块",
    "请进行验证",
    "验证失败",
    "traceid",
    "captcha",
    "verify"
  ].some((marker) => joined.includes(marker));
}

async function main(): Promise<void> {
  const mode = (parseArg("mode") ?? "headless") as Mode;
  const site = (parseArg("site") ?? "hangzhou") as Site;
  const waitMsRaw = Number(parseArg("wait-ms") ?? "90000");
  const waitMs = Number.isFinite(waitMsRaw) && waitMsRaw > 0 ? waitMsRaw : 90000;
  const outRoot = resolve(parseArg("out") ?? "output/probe-zj");
  const runDir = resolve(outRoot, `${site}-${mode}-${nowStamp()}`);
  await mkdir(runDir, { recursive: true });

  const harPath = resolve(runDir, "network.har");
  const tracePath = resolve(runDir, "trace.zip");
  const networkLogPath = resolve(runDir, "responses.ndjson");
  const summaryPath = resolve(runDir, "summary.json");
  const bodyPath = resolve(runDir, "body.txt");

  const browser = await chromium.launch({ headless: mode === "headless" });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    recordHar: { path: harPath, content: "embed", mode: "full" },
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  const responseLines: string[] = [];
  page.on("response", (response) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      status: response.status(),
      method: response.request().method(),
      resourceType: response.request().resourceType(),
      url: response.url()
    });
    responseLines.push(line);
  });

  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  let listVisible = false;
  let challengeDetected = false;
  let finalUrl = "";
  let title = "";
  let bodyText = "";

  try {
    await page.goto(URL_BY_SITE[site], { waitUntil: "domcontentloaded", timeout: 90000 });
    const started = Date.now();
    while (Date.now() - started < waitMs) {
      title = await page.title().catch(() => "");
      bodyText = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim()).catch(() => "");
      finalUrl = page.url();
      challengeDetected = isChallenge(title, bodyText);
      listVisible = await page.locator(LIST_SELECTOR).first().isVisible().catch(() => false);
      if (listVisible) {
        break;
      }
      await page.waitForTimeout(1500);
    }
  } finally {
    await writeFile(networkLogPath, responseLines.join("\n"), "utf8");
    await writeFile(bodyPath, bodyText, "utf8");
    await context.tracing.stop({ path: tracePath });
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  const summary = {
    site,
    mode,
    waitMs,
    finalUrl,
    title,
    listVisible,
    challengeDetected,
    outputDir: runDir,
    files: {
      trace: tracePath,
      har: harPath,
      responses: networkLogPath,
      body: bodyPath
    }
  };

  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
