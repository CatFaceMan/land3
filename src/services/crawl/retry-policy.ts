export class RetryPolicy {
  public constructor(private readonly maxRetries: number) {}

  public canRetry(attempt: number): boolean {
    return attempt < this.maxRetries;
  }
}
