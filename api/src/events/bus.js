import { EventEmitter } from 'node:events'

/** A tiny fan-out bus. SSE connections subscribe; routes/listener publish. */
export function createBus() {
  const ee = new EventEmitter()
  ee.setMaxListeners(0) // one listener per open SSE connection; no artificial cap
  return {
    publish: (event) => ee.emit('event', event),
    subscribe: (fn) => { ee.on('event', fn); return () => ee.off('event', fn) },
  }
}
