export function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
