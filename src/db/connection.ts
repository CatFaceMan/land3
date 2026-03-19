import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import type { AppConfig } from "../domain/types.js";

export function createPool(config: AppConfig): Pool {
  return mysql.createPool({
    uri: config.databaseUrl,
    charset: "utf8mb4",
    dateStrings: true,
    connectionLimit: 5
  });
}

export type DbRow = RowDataPacket & Record<string, unknown>;
