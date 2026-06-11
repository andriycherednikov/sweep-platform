// web/src/hooks/useEventStream.test.jsx
import { expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
vi.mock('../notifications.js', () => ({ pushNotification: vi.fn() }))
import { pushNotification } from '../notifications.js'
import { useEventStream } from './useEventStream.js'

let instances
class FakeES {
  constructor(url){ this.url = url; this.onmessage = null; this.onopen = null; this.closed = false; instances.push(this) }
  emit(obj){ this.onmessage && this.onmessage({ data: JSON.stringify(obj) }) }
  open(){ this.onopen && this.onopen() }
  close(){ this.closed = true }
}

beforeEach(() => { instances = []; vi.stubGlobal('EventSource', FakeES); pushNotification.mockClear() })

function setup() {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  renderHook(() => useEventStream(), { wrapper })
  return { qc, spy, es: instances[0] }
}

test('subscribes to /api/stream on mount', () => {
  const { es } = setup()
  expect(es.url).toBe('/api/stream')
})

test('watch/support events invalidate the social query', () => {
  const { spy, es } = setup()
  es.emit({ type: 'watch', fixtureId: 'm1' })
  es.emit({ type: 'support', fixtureId: 'm1' })
  expect(spy).toHaveBeenCalledWith({ queryKey: ['social'] })
  expect(spy.mock.calls.filter((c) => c[0]?.queryKey?.[0] === 'social')).toHaveLength(2)
})

test('a support pick/switch pushes a floating reaction; a remove does not', () => {
  const { es } = setup()
  es.emit({ type: 'support', fixtureId: 'm1', personId: 'p1', supporting: 'br', action: 'pick' })
  expect(pushNotification).toHaveBeenCalledWith({ personId: 'p1', teamCode: 'br', fixtureId: 'm1', action: 'pick' })
  es.emit({ type: 'support', fixtureId: 'm1', personId: 'p1', supporting: null, action: 'remove' })
  expect(pushNotification).toHaveBeenCalledTimes(1) // remove did not push
})

test('score/sync events invalidate the sweep query', () => {
  const { spy, es } = setup()
  es.emit({ type: 'score', fixtureId: 'm1', status: 'live', score: [1, 0], minute: 63 })
  es.emit({ type: 'sync' })
  expect(spy.mock.calls.filter((c) => c[0]?.queryKey?.[0] === 'sweep')).toHaveLength(2)
})

test('on (re)open it catches up by invalidating both queries', () => {
  const { spy, es } = setup()
  es.open()
  expect(spy).toHaveBeenCalledWith({ queryKey: ['sweep'] })
  expect(spy).toHaveBeenCalledWith({ queryKey: ['social'] })
})

test('photo-approved/photo-removed events invalidate the sweep query', () => {
  const { spy, es } = setup()
  es.emit({ type: 'photo-approved', id: 'p1', kind: 'fan' })
  es.emit({ type: 'photo-removed', id: 'p2', kind: 'profile' })
  expect(spy.mock.calls.filter((c) => c[0]?.queryKey?.[0] === 'sweep')).toHaveLength(2)
})

test('closes the stream on unmount', () => {
  const qc = new QueryClient()
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { unmount } = renderHook(() => useEventStream(), { wrapper })
  unmount()
  expect(instances[0].closed).toBe(true)
})
