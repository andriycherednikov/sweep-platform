import { createPool, createDb } from '../../src/db/client.js'

export function openTestDb() {
  const pool = createPool(process.env.DATABASE_URL)
  return { pool, db: createDb(pool) }
}
