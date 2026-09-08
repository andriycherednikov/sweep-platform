import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createPool, createDb } from './client.js'

export async function runMigrations(db) {
  await migrate(db, { migrationsFolder: new URL('../../migrations', import.meta.url).pathname })
}

/** The vars buildApp() refuses to boot without in production, checked here because the
 *  migrate one-shot runs to completion BEFORE api and worker (docker-compose.yml
 *  depends_on). Migrations are one-way: 0008 drops a column the previous image still
 *  selects, so a stack that migrates and only then discovers a missing var is a
 *  crash-loop with no rollback. `make deploy` never ships .env.docker — it lives on the
 *  server — so a var added on a branch is absent there until an operator adds it. */
export function missingProdEnv(env = process.env) {
  if (env.NODE_ENV !== 'production') return []
  return ['SESSION_SECRET', 'PUBLIC_ORIGIN', 'RESEND_API_KEY', 'MAIL_FROM'].filter((k) => !env[k])
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const missing = missingProdEnv()
  if (missing.length) {
    console.error(
      `refusing to migrate: ${missing.join(', ')} missing from .env.docker on the server.\n` +
      'The api would not boot after this migration and it cannot be rolled back.\n' +
      'Add them (see docker/.env.docker.example), then redeploy. Nothing has changed.',
    )
    process.exit(1)
  }
  const pool = createPool()
  const db = createDb(pool)
  await runMigrations(db)
  await pool.end()
  console.log('migrations applied')
}
