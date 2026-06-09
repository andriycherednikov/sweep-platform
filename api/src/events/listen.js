import { CHANNEL } from './notify.js'

/**
 * Hold a dedicated pg client LISTENing on the events channel and rebroadcast
 * each NOTIFY payload onto the in-process bus. Returns an async unsubscribe.
 */
export async function startListener(pool, bus) {
  const client = await pool.connect()
  client.on('notification', (msg) => {
    if (msg.channel !== CHANNEL) return
    try { bus.publish(JSON.parse(msg.payload)) } catch { /* ignore malformed */ }
  })
  await client.query(`LISTEN ${CHANNEL}`)
  return async () => { client.removeAllListeners('notification'); client.release() }
}
