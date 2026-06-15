import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAll, fetchSocial } from './api/client.js'
import { setSweepData } from './data.js'
import { setSocialData, setCurrentSweepId } from './social.js'
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

// Branded wordmark shown atop every bootstrap-gate state (loading / pick / error).
function GateBrand() {
  return (
    <div className="sweep-brand">
      <img className="sweep-brand-mark" src="/trophy.png" alt="" />
      <div className="sweep-brand-word"><b>THE SWEEP</b><small>WORLD CUP 2026</small></div>
    </div>
  )
}

function Gate({ children }) {
  const qc = useQueryClient()
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sweep'],
    queryFn: async () => {
      const api = await fetchAll()
      setCurrentSweepId(api.bootstrap?.sweep?.id || 'default')
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
      <div data-testid="sweep-loading" className="sweep-gate">
        <GateBrand />
        <div className="sweep-spinner" aria-hidden="true" />
        <p className="sweep-gate-msg">Loading the sweep…</p>
      </div>
    )
  }
  if (isError && is401(error)) {
    const sweeps = listSweeps()
    return (
      <div data-testid="sweep-pick" className="sweep-gate">
        <GateBrand />
        <div className="sweep-card">
          <div className="sweep-card-ic" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7.5 8.5 6 8.5-6" />
            </svg>
          </div>
          <h2 className="sweep-card-h">Pick a sweep</h2>
          {sweeps.length > 0 ? (
            <>
              <p className="sweep-card-sub">Jump back into one of your sweeps.</p>
              <ul className="sweep-pick-list">
                {sweeps.map((s) => (
                  <li key={s.sweepId}>
                    <button className="sweep-pick-row" onClick={() => switchTo(s, qc)}>
                      <span className="sweep-pick-name">{s.name || s.sweepId}</span>
                      <svg className="sweep-pick-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="sweep-card-sub">You need an invite link to join a sweep. Ask whoever runs your sweep for the link.</p>
          )}
        </div>
      </div>
    )
  }
  if (isError) {
    return (
      <div data-testid="sweep-error" className="sweep-gate">
        <GateBrand />
        <div className="sweep-card">
          <h2 className="sweep-card-h">Couldn’t load the sweep</h2>
          <p className="sweep-card-sub">Something went wrong reaching the server. Check your connection and try again.</p>
          <button className="sweep-retry" onClick={() => refetch()}>Retry</button>
        </div>
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
