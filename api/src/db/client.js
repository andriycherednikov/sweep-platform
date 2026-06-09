import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'

export function createPool(connectionString = process.env.DATABASE_URL) {
  return new pg.Pool({ connectionString })
}

export function createDb(pool) {
  return drizzle(pool, { schema })
}
