import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAll, fetchSocial } from './api/client.js'
import { setSweepData } from './data.js'
import { setSocialData } from './social.js'
import { assembleSweep } from './lib/assemble.js'
import { useEventStream } from './hooks/useEventStream.js'
import { listSweeps, addSweep, switchTo } from './sweeps.js'

const is401 = (err) => /HTTP 401/.test(err?.message || '')

// Don't retry auth failures (401): a missing/expired session won't fix itself on
// retry, and retrying would keep the Gate in its loading state during the backoff
// instead of promptly showing the "pick a sweep" landing (D5).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => !is401(error) && failureCount < 1,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
})

function Gate({ children }) {
  const qc = useQueryClient()
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sweep'],
    queryFn: async () => {
      const api = await fetchAll()
      setSweepData(assembleSweep(api))
      // D7a→D4: backfill the active sweep's display name into the switcher store.
      const sweep = api.bootstrap?.sweep
      if (sweep?.id) {
        const stored = listSweeps().find((s) => s.sweepId === sweep.id)
        addSweep({ sweepId: sweep.id, name: sweep.name, role: stored?.role || 'member', token: null })
      }
      return api.syncStatus
    },
  })

  useQuery({
    queryKey: ['social'],
    queryFn: async () => {
      const social = await fetchSocial()
      setSocialData(social)
      return social
    },
  })

  useEventStream()

  if (isLoading) {
    return (
      <div data-testid="sweep-loading" className="sweep-loading">
        <div className="spinner" /> Loading the sweep…
      </div>
    )
  }
  if (isError && is401(error)) {
    const sweeps = listSweeps()
    return (
      <div data-testid="sweep-pick" className="sweep-pick">
        <h2>Pick a sweep</h2>
        {sweeps.length > 0 ? (
          <ul className="sweep-pick-list">
            {sweeps.map((s) => (
              <li key={s.sweepId}>
                <button onClick={() => switchTo(s, qc)}>{s.name || s.sweepId}</button>
              </li>
            ))}
          </ul>
        ) : (
          <p>You need an invite link to join a sweep.</p>
        )}
      </div>
    )
  }
  if (isError) {
    return (
      <div data-testid="sweep-error" className="sweep-error">
        <p>Couldn’t load the sweep.</p>
        <button onClick={() => refetch()}>Retry</button>
      </div>
    )
  }
  return <>{children}</>
}

export function SweepProvider({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Gate>{children}</Gate>
    </QueryClientProvider>
  )
}
