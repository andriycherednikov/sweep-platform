import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createPool, createDb } from './client.js'

export async function runMigrations(db) {
  await migrate(db, { migrationsFolder: new URL('../../migrations', import.meta.url).pathname })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool()
  const db = createDb(pool)
  await runMigrations(db)
  await pool.end()
  console.log('migrations applied')
}
