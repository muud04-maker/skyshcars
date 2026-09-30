import mysql from 'mysql2/promise';

let pool: any;

/** True only when all database settings exist (set in Hostinger environment variables). */
export function dbConfigured() {
  return ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'].every(k => !!process.env[k]);
}

export function db() {
  if (!pool) pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    socketPath: process.env.DB_SOCKET || undefined,
    waitForConnections: true,
    connectionLimit: 8,
    queueLimit: 0,
    charset: 'utf8mb4',
  });
  return pool;
}

export async function rows<T = any>(sql: string, args: any[] = []): Promise<T[]> {
  const [r] = await db().execute(sql, args);
  return r as T[];
}

export async function one<T = any>(sql: string, args: any[] = []): Promise<T | null> {
  const r = await rows<T>(sql, args);
  return r[0] || null;
}

export async function ping() {
  await db().query('SELECT 1');
  return true;
}

/** Safe integer for LIMIT clauses (MySQL 8 rejects LIMIT ? in prepared statements). */
export function lim(n: any, max = 1000) {
  const x = Math.floor(Number(n));
  return Number.isFinite(x) && x > 0 ? Math.min(x, max) : 50;
}
