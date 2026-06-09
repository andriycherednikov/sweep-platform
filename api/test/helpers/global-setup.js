import { PostgreSqlContainer } from '@testcontainers/postgresql'

let container

export async function setup() {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
}

export async function teardown() {
  await container?.stop()
}
