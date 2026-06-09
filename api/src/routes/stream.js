export async function streamRoutes(app) {
  app.get('/api/stream', (req, reply) => {
    reply.hijack() // Fastify hands us the raw socket; we own the response
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering (Caddy/nginx) so frames flush
    })
    reply.raw.write('retry: 3000\n\n') // client reconnect backoff hint

    const send = (event) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    const unsub = app.bus.subscribe(send)
    const hb = setInterval(() => reply.raw.write(': hb\n\n'), 25_000) // keep-alive comment

    req.raw.on('close', () => { clearInterval(hb); unsub() })
  })
}
