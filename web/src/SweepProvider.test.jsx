import { expect, test, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SweepProvider } from './SweepProvider.jsx'
import { SWEEP } from './data.js'

let esInstances = []
class FakeES { constructor(url){ this.url = url; this.onmessage = null; this.onopen = null; esInstances.push(this) } close(){} }
vi.stubGlobal('EventSource', FakeES)

const bundle = {
  '/api/bootstrap': { teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#000', strength: 80 }], people: [], ownership: {}, scoring: { rule: 'top3' } },
  '/api/fixtures': [], '/api/standings': { L: [] }, '/api/photos': [],
  '/api/sync-status': { stale: true, lastBaselineAt: null, lastLiveAt: null },
  '/api/social': { watch: {}, support: {} },
}

beforeEach(() => {
  esInstances = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    return { ok: true, status: 200, json: async () => bundle[path] }
  }))
})

test('shows a loading state, then renders children with data populated + stale banner', async () => {
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  expect(screen.getByTestId('sweep-loading')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText('app-ready')).toBeInTheDocument())
  expect(SWEEP.team('hr').name).toBe('Croatia')
  expect(screen.getByTestId('stale-banner')).toBeInTheDocument() // syncStatus.stale === true
})

test('subscribes to the SSE stream on mount', async () => {
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByText('app-ready')).toBeInTheDocument())
  expect(esInstances[0]?.url).toBe('/api/stream')
})
