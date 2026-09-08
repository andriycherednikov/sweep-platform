import { useEffect, useRef } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAll, fetchSocial, fetchWallet, setActiveSweep, postSession } from './api/client.js'
import { setSweepData } from './data.js'
import { setSocialData, setCurrentSweepId, useSocial } from './social.js'
import { setWalletData } from './coins.js'
import { assembleSweep } from './lib/assemble.js'
import { useEventStream } from './hooks/useEventStream.js'
import { listSweeps, addSweep } from './sweeps.js'
import { parseSweepPath } from './lib/joinLink.js'
import { getAccountToken, getAccountSweeps } from './lib/accountClient.js'
import { Landing } from './screens-landing.jsx'

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
      <div className="sweep-brand-word"><b>The Sweep</b></div>
    </div>
  )
}

function Gate({ children }) {
  const qc = useQueryClient()
  // One stored-token re-exchange per mount. Without the guard a sweep that 401s for
  // any other reason (archived, rotated) would re-post and refetch forever.
  const rejoinRef = useRef(false)
  // One account-ownership check per mount, same shape as rejoinRef above.
  const accountRejoinRef = useRef(false)
  // Re-render + re-key the wallet on identity switch so balance/bets/statement
  // follow whoever you're viewing as.
  const { me } = useSocial()
  const { data, isLoading, isError, error, refetch, isSuccess } = useQuery({
    queryKey: ['sweep'],
    // Safety-net refresh: SSE pushes live score/standings updates within ~1s while
    // connected, but if the stream drops (backgrounded PWA, flaky mobile network)
    // the table can go stale. Re-pull every 5 min (background refetch — no loading
    // flash) and on reconnect so results never lag for long.
    refetchInterval: 5 * 60_000,
    refetchOnReconnect: true,
    queryFn: async () => {
      const api = await fetchAll()
      setCurrentSweepId(api.bootstrap?.sweep?.id || 'default')
      setActiveSweep(api.bootstrap?.sweep?.id || null)
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

  const { data: walletData } = useQuery({
    // Keyed on identity so switching who you're viewing as refetches the wallet.
    queryKey: ['coins', me?.id],
    // wait for the sweep query: getMe() resolves against S.people (populated by setSweepData),
    // so running earlier would fetch an empty wallet that never refetches.
    enabled: isSuccess,
    queryFn: () => fetchWallet(me ? me.id : ''),
  })
  // Bridge the query result into the coins store via an effect (not inside the
  // queryFn): on identity switch-back a cache-served result skips the queryFn,
  // so syncing here is what keeps the global wallet tracking the active viewer.
  useEffect(() => { if (walletData) setWalletData(walletData) }, [walletData])

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
    const wanted = parseSweepPath(window.location.pathname)

    // The URL names a sweep this session cannot open. If the device still holds that
    // sweep's link token, the cookie has merely expired — spend the token once and
    // carry on, which is what makes a bookmark survive the 8h session.
    if (wanted) {
      // The sweep cookie is 8h; the account session behind it is 90d. An owner opening
      // their own bookmark on a new phone (or after the cookie expired) has no stored
      // link token for it at all — without this they'd be told to go find their invite
      // link, for a sweep they own. Checked first: it applies even when this browser
      // has never held that sweep's token.
      if (getAccountToken() && !accountRejoinRef.current) {
        accountRejoinRef.current = true
        getAccountSweeps()
          .then((rows) => {
            const owned = rows.find((s) => s.id === wanted)
            if (owned) window.location.assign(owned.memberLink)
            // Not this account's sweep: refetch() re-runs the sweep query, which 401s
            // again and falls through to the stored-token / needs-invite path below.
            else refetch()
          })
          .catch(() => refetch())
        return (
          <div data-testid="sweep-loading" className="sweep-gate">
            <GateBrand />
            <div className="sweep-spinner" aria-hidden="true" />
            <p className="sweep-gate-msg">Loading the sweep…</p>
          </div>
        )
      }

      const stored = sweeps.find((s) => s.sweepId === wanted && s.token)
      if (stored && !rejoinRef.current) {
        rejoinRef.current = true
        postSession(stored.token).then(() => refetch()).catch(() => { /* fall through to the card below */ })
        return (
          <div data-testid="sweep-loading" className="sweep-gate">
            <GateBrand />
            <div className="sweep-spinner" aria-hidden="true" />
            <p className="sweep-gate-msg">Loading the sweep…</p>
          </div>
        )
      }
      // Someone else's sweep, or ours with the token gone: one card either way, so the
      // id never becomes an oracle for which sweeps exist.
      return (
        <div data-testid="sweep-needs-invite" className="sweep-gate">
          <GateBrand />
          <div className="sweep-card">
            <h2 className="sweep-card-h">This sweep needs its invite link</h2>
            <p className="sweep-card-sub">
              Sweeps are private to the group. Open the link whoever runs it sent you, and you'll land straight back here.
            </p>
            <a className="sweep-retry" href="/">Or start your own</a>
          </div>
        </div>
      )
    }
    // The URL names no sweep, so this is the front door — the same page a stranger
    // sees, whether or not this browser has joined anything. Their sweeps live at
    // /switch and are linked from the nav; the root sells the product. The exception
    // is a dead invite link (rotated, archived, mistyped): they were sent here on
    // purpose, so say the link is dead rather than pitch at them.
    if (!new URLSearchParams(window.location.search).has('join')) return <Landing />
    return (
      <div data-testid="sweep-join-failed" className="sweep-gate">
        <GateBrand />
        <div className="sweep-card">
          <h2 className="sweep-card-h">That invite link didn't work</h2>
          <p className="sweep-card-sub">
            It may have been replaced or the sweep closed. Ask whoever runs your sweep for a fresh link.
          </p>
          <a className="sweep-retry" href="/">Start your own sweep</a>
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
