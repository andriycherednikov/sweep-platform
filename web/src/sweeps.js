import { postSession } from './api/client.js'

const KEY = 'sweep.sweeps.v1'

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function write(list) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

/** @returns {{sweepId:string, name:string|null, role:string, token:string|null}[]} */
export function listSweeps() {
  return read()
}

/**
 * Upsert a joined sweep by `sweepId`. Updates name/role; keeps the existing token
 * unless a non-null token is provided (merge — never overwrite a real token with null).
 * @param {{sweepId:string, name:string|null, role:string, token:string|null}} entry
 */
export function addSweep({ sweepId, name, role, token }) {
  const list = read()
  const i = list.findIndex((s) => s.sweepId === sweepId)
  if (i === -1) {
    list.push({ sweepId, name, role, token })
  } else {
    list[i] = {
      sweepId,
      name,
      role,
      token: token != null ? token : list[i].token,
    }
  }
  write(list)
}

/** Remove a joined sweep by id. */
export function removeSweep(sweepId) {
  write(read().filter((s) => s.sweepId !== sweepId))
}

/**
 * Switch the active sweep: re-exchange its stored token for a fresh session
 * cookie, then invalidate the data queries so the SPA reloads scoped data.
 * @param {{token:string}} sweep
 * @param {{invalidateQueries: Function}} queryClient
 */
export async function switchTo(sweep, queryClient) {
  await postSession(sweep.token)
  queryClient.invalidateQueries({ queryKey: ['sweep'] })
  queryClient.invalidateQueries({ queryKey: ['social'] })
}
