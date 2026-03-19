import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactPaths, BizType, SiteCode } from "../domain/types.js";

function fileSlug(value: string): string {
  return value.replace(/[^\w.-]+/g, "_").slice(0, 80);
}

export async function saveArtifactBundle(params: {
  artifactRoot: string;
  siteCode: SiteCode;
  bizType: BizType;
  key: string;
  screenshot?: Buffer | null;
  html?: string | null;
}): Promise<ArtifactPaths> {
  const baseDir = join(params.artifactRoot, params.siteCode, params.bizType, new Date().toISOString().slice(0, 10));
  await mkdir(baseDir, { recursive: true });
  const slug = fileSlug(params.key);
  const screenshotPath = params.screenshot ? join(baseDir, `${slug}.png`) : null;
  const htmlPath = params.html ? join(baseDir, `${slug}.html`) : null;
  if (screenshotPath) {
    await writeFile(screenshotPath, params.screenshot as Buffer);
  }
  if (htmlPath) {
    await writeFile(htmlPath, params.html as string, "utf8");
  }
  return { screenshotPath, htmlPath };
}
