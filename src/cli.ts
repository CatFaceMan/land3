import "dotenv/config";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { assertSiteEnabled, loadConfig, SUPPORTED_SITE_CODES, validateConfig } from "./config.js";
import { createPool } from "./db/connection.js";
import { LandRepository } from "./db/repository.js";
import { ensureSchema } from "./db/schema.js";
import type { SiteCode } from "./domain/types.js";
import { runRefresh } from "./services/refresh-service.js";
import { runCollectAll } from "./services/collect-all-service.js";

function assertSiteCode(value: string): SiteCode {
  if (SUPPORTED_SITE_CODES.includes(value as SiteCode)) {
    return value as SiteCode;
  }
  throw new Error(`Invalid site code: ${value}. Supported: ${SUPPORTED_SITE_CODES.join(", ")}`);
}

export function buildProgram(): Command {
  const program = new Command();
  program.name("land3");

  program
    .command("refresh")
    .requiredOption("--site <site>")
    .option("--from <date>")
    .option("--to <date>")
    .option("--headless <boolean>")
    .option("--max-items <count>")
    .action(async (options) => {
      const config = loadConfig();
      const siteCode = assertSiteCode(options.site);
      assertSiteEnabled(config, siteCode);
      const warnings = validateConfig(config);
      if (warnings.length > 0) {
        process.stderr.write(`${warnings.map((item) => `[config-warning] ${item}`).join("\n")}\n`);
      }
      if (options.headless !== undefined) {
        config.browser.headless = options.headless !== "false";
      }

      const pool = createPool(config);
      try {
        await ensureSchema(pool);
        const repository = new LandRepository(pool);
        const result = await runRefresh({
          config,
          repository,
          siteCode,
          from: options.from,
          to: options.to,
          maxItems: options.maxItems ? Number(options.maxItems) : undefined
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } finally {
        await pool.end();
      }
    });

  program
    .command("collect-all")
    .option("--from <date>")
    .option("--to <date>")
    .option("--headless <boolean>")
    .option("--max-items <count>")
    .action(async (options) => {
      const config = loadConfig();
      const warnings = validateConfig(config);
      if (warnings.length > 0) {
        process.stderr.write(`${warnings.map((item) => `[config-warning] ${item}`).join("\n")}\n`);
      }
      if (options.headless !== undefined) {
        config.browser.headless = options.headless !== "false";
      }

      const pool = createPool(config);
      try {
        await ensureSchema(pool);
        const repository = new LandRepository(pool);
        const result = await runCollectAll({
          config,
          repository,
          from: options.from,
          to: options.to,
          maxItems: options.maxItems ? Number(options.maxItems) : undefined
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } finally {
        await pool.end();
      }
    });

  return program;
}

async function main(): Promise<void> {
  await buildProgram().parseAsync(process.argv);
}

const isDirectExecution = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (isDirectExecution) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
