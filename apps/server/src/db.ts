import pg from "pg";

// Shared DB connection config — single pool used by all route modules
const RAW_URL = process.env.DATABASE_URL || "postgresql://localhost:5432/helpdesk_ai";
export const DB_URL = RAW_URL.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?$/, "");
export const isCloudDB = !DB_URL.includes("localhost");

export const pool = new pg.Pool({
  connectionString: DB_URL,
  max: 10,
  ...(isCloudDB ? { ssl: { rejectUnauthorized: false } } : {}),
});
