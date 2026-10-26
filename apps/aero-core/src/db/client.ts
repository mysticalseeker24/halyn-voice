import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

// Drizzle over the D1 binding. `db.batch([...])` is one D1 transaction: if any statement fails, none applies.

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type CoreDb = ReturnType<typeof createDb>;
