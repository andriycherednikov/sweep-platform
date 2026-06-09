import { PostgreSqlContainer } from '@testcontainers/postgresql'

let container

export async function setup() {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()

  const { createPool, createDb } = await import('../../src/db/client.js')
  const { runMigrations } = await import('../../src/db/migrate.js')
  const pool = createPool(process.env.DATABASE_URL)
  await runMigrations(createDb(pool))
  const { seed } = await import('../../src/seed/seed.js')
  await seed(createDb(pool))
  await pool.end()
}

export async function teardown() {
  await container?.stop()
}
