import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { fetchAll, fetchSocial } from './api/client.js'
import { setSweepData } from './data.js'
import { setSocialData } from './social.js'
import { assembleSweep } from './lib/assemble.js'
import { useEventStream } from './hooks/useEventStream.js'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60_000, refetchOnWindowFocus: false } } })

function Gate({ children }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sweep'],
    queryFn: async () => {
      const api = await fetchAll()
      setSweepData(assembleSweep(api))
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
