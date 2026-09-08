import { operatorAction } from '../db/schema.js'
import { newToken } from '../sweeps/tokens.js'

export async function recordOperatorAction(db, { actorId, action, target = null, sweepIds = [] }) {
  await db.insert(operatorAction).values({ id: `oa_${newToken(12)}`, actorId, action, target, sweepIds })
}
