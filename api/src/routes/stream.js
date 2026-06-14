/** Events with a sweepId are scoped to that sweep; events without one (match events) broadcast to all. */
export function filterEventForSweep(event, sweepId) {
  if (event.sweepId == null) return true
  return event.sweepId === sweepId
}

export async function streamRoutes(app) {
  app.get('/api/stream', (req, reply) => {
    const sweepId = req.sweep?.id ?? null
    reply.hijack() // Fastify hands us the raw socket; we own the response
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering (Caddy/nginx) so frames flush
    })
    reply.raw.write('retry: 3000\n\n') // client reconnect backoff hint

    const send = (event) => {
      if (!filterEventForSweep(event, sweepId)) return
      const { sweepId: _omit, ...payload } = event // never leak the routing key to the client
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
    }
    const unsub = app.bus.subscribe(send)
    const hb = setInterval(() => reply.raw.write(': hb\n\n'), 25_000) // keep-alive comment

    req.raw.on('close', () => { clearInterval(hb); unsub() })
  })
}
