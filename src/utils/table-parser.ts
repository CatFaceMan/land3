
import { cleanText } from "./text.js";

export function normalizeHeader(value: string): string {
  return value.replace(/[\s（）()]/g, "");
}

export function findHeaderIndex(headers: string[], candidates: string[]): number {
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeHeader(candidate);
    const index = normalizedHeaders.findIndex((item) => item.includes(normalizedCandidate));
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}

export interface TableParserOptions {
  /**
   * Keywords to identify the header row.
   * The first row containing any of these keywords will be treated as the header.
   */
  headerMarkers: string[];
  
  /**
   * Minimum number of columns required for a row to be valid.
   * Default: 2
   */
  minColumns?: number;
  
  /**
   * Additional filter function for rows.
   */
  rowFilter?: (row: string[]) => boolean;
}

export function parseTableRows(rawRows: string[][], options: TableParserOptions): { headers: string[]; rows: string[][] } {
  // Clean and filter empty cells/rows first
  const normalizedRows = rawRows
    .map((row) => row.map((cell) => cleanText(cell)))
    .filter((row) => row.some((cell) => cell.length > 0));

  // Find header row
  const headerIndex = normalizedRows.findIndex((row) => {
    return options.headerMarkers.some(marker => 
      row.some(cell => normalizeHeader(cell).includes(normalizeHeader(marker)))
    );
  });

  if (headerIndex < 0) {
    return { headers: [], rows: [] };
  }

  // Handle multi-line headers? Usually headers are single line or we take the last one.
  // For now, take the identified row. Some implementations merged with next row, but let's stick to simple first.
  // Chengdu/Xian logic: headers = [...rows[headerIndex], ...(rows[headerIndex + 1] ?? [])].filter(Boolean);
  // Let's adopt the merge strategy if the next row looks like part of header or empty? 
  // Actually, let's keep it simple: just the found row is the header.
  // Wait, Chengdu and Xian implementation merges headerIndex and headerIndex + 1.
  // Let's support a flag or just return data rows starting from headerIndex + 1.
  
  const headers = normalizedRows[headerIndex];
  
  const dataRows = normalizedRows.slice(headerIndex + 1).filter((row) => {
    if (options.minColumns && row.length < options.minColumns) {
      return false;
    }
    
    // Default filter: filter out rows that look like headers (contain header markers)
    if (options.headerMarkers.some(marker => 
      row.some(cell => normalizeHeader(cell).includes(normalizeHeader(marker)))
    )) {
      return false;
    }

    if (options.rowFilter) {
      return options.rowFilter(row);
    }
    
    return true;
  });

  return { headers, rows: dataRows };
}
