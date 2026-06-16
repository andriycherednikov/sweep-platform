import { requireSweep } from '../sweeps/auth.js'
import { walletFor, leaderboard } from '../coins/ledger.js'

const member = requireSweep(['member', 'admin'])

export async function coinsRoutes(app) {
  app.get('/api/coins', { preHandler: member }, async (req) => {
    const sweepId = req.sweep.id
    const board = await leaderboard(app.db, sweepId)
    const me = req.query?.personId
    const wallet = me ? await walletFor(app.db, sweepId, me) : { balance: 0, weeklyGrant: 1000, bets: { open: [], settled: [] } }
    return { ...wallet, leaderboard: board }
  })
}
