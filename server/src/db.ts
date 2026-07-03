// One shared pg.Pool; raw parameterised SQL only (no ORM) — CONTRACT §1.
import pg from 'pg';
import { config } from './config.js';

// DATE columns come back as plain YYYY-MM-DD strings, not JS Dates — the whole
// calendar/overlap layer is day-granular string math (CONTRACT §4.4).
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params as never[]);
  return res.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
