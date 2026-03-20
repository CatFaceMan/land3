import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type HarEntry = {
  request: { method: string; url: string };
  response: { status: number; content?: { mimeType?: string } };
  _resourceType?: string;
};

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length).trim() : null;
}

function isLikelyStatic(url: string): boolean {
  return /\.(?:js|css|png|jpe?g|gif|svg|woff2?|ttf|ico)(?:\?|$)/i.test(url);
}

function isCaptchaUrl(url: string): boolean {
  return /alicdn\.com|aliyuncs\.com|captcha/i.test(url);
}

function main(): void {
  const harPathArg = parseArg("har");
  if (!harPathArg) {
    throw new Error("Missing --har=<path>");
  }
  const harPath = resolve(harPathArg);
  const har = JSON.parse(readFileSync(harPath, "utf8")) as { log?: { entries?: HarEntry[] } };
  const entries = har.log?.entries ?? [];

  const rows = entries.map((entry) => {
    const url = entry.request.url;
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return "";
      }
    })();
    return {
      method: entry.request.method,
      url,
      host,
      status: entry.response.status,
      mime: entry.response.content?.mimeType ?? "",
      type: entry._resourceType ?? ""
    };
  });

  const firstParty = rows.filter((r) => /zjzrzyjy\.com$/i.test(r.host));
  const firstPartyApiCandidates = firstParty.filter(
    (r) =>
      !isLikelyStatic(r.url) &&
      !isCaptchaUrl(r.url) &&
      (r.method !== "GET" || /api|json|query|list|search|resource|land|bidding/i.test(r.url))
  );

  const summary = {
    harPath,
    totalRequests: rows.length,
    firstPartyRequests: firstParty.length,
    firstPartyApiCandidates: firstPartyApiCandidates.length
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (firstPartyApiCandidates.length > 0) {
    process.stdout.write(`${JSON.stringify(firstPartyApiCandidates, null, 2)}\n`);
  }
}

main();

