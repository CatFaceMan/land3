export interface CrawlLogPayload {
  event: string;
  runId: number;
  site: string;
  biz: string;
  page?: number;
  item?: number;
  stage?: string;
  attempt?: number;
  durationMs?: number;
  result?: string;
  errorType?: string;
  message?: string;
}

export class CrawlLogger {
  public info(payload: CrawlLogPayload): void {
    this.write("info", payload);
  }

  public error(payload: CrawlLogPayload): void {
    this.write("error", payload);
  }

  private write(level: "info" | "error", payload: CrawlLogPayload): void {
    const record = {
      ts: new Date().toISOString(),
      level,
      ...payload
    };
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }
}
