import { sql } from 'drizzle-orm'

export const CHANNEL = 'sweep_events'

/** Publish an event to every process LISTENing (payload must be < 8000 bytes; ours are tiny). */
export async function publish(db, event) {
  await db.execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(event)})`)
}
