import { useState, useEffect } from 'react'
import { postSession } from './api/client.js'

const KEY = 'sweep.sweeps.v1'

// Subscribers re-render when the joined-sweeps list changes (mirrors social.js).
const listeners = new Set()
function notify() { listeners.forEach((fn) => fn()) }

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
  notify()
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
      // never clobber a captured name/token with null (e.g. the join call passes name:null)
      name: name != null ? name : list[i].name,
      role: role != null ? role : list[i].role,
      token: token != null ? token : list[i].token,
    }
  }
  write(list)
}

/** Rename a joined sweep's local label. */
export function renameSweep(sweepId, name) {
  const list = read()
  const i = list.findIndex((s) => s.sweepId === sweepId)
  if (i !== -1) { list[i] = { ...list[i], name }; write(list) }
}

/** Remove a joined sweep by id. */
export function removeSweep(sweepId) {
  write(read().filter((s) => s.sweepId !== sweepId))
}

/**
 * Does this error mean the stored token itself is dead? Only the server saying so
 * counts — a 404 (no link matches) or a 401. A network failure carries no status and
 * must never cost a member their only credential.
 */
export const isDeadToken = (err) => err?.status === 404 || err?.status === 401

/**
 * Forget a stored token the server has rejected. Devices that joined by an admin link
 * before this branch hold an ADMIN token here, and POST /api/session now matches the
 * member token only; a rotated link kills stored member tokens the same way. Either
 * way it will never work again, so keeping it means every switch and every rejoin
 * retries a dead credential. The entry stays — the sweep keeps its name in the list —
 * and only a fresh invite link puts a working token back. addSweep can't do this: it
 * deliberately never clobbers a token with null.
 */
export function dropToken(sweepId) {
  const list = read()
  const i = list.findIndex((s) => s.sweepId === sweepId)
  if (i !== -1) { list[i] = { ...list[i], token: null }; write(list) }
}

/**
 * Switch the active sweep: re-exchange its stored token (which refreshes the cookie
 * and moves this sweep to the front), then NAVIGATE to its address. A real navigation
 * rather than a cache invalidation, because the URL now names the sweep: Back works
 * across a switch, and no query cache carries one sweep's data into another's screen.
 * @param {{sweepId:string, token:string}} sweep
 * @param {{invalidateQueries: Function}} [queryClient] unused; kept for callers mid-refactor
 */
export async function switchTo(sweep, queryClient) {
  try {
    await postSession(sweep.token)
  } catch (err) {
    if (isDeadToken(err)) dropToken(sweep.sweepId)
    throw err
  }
  window.location.assign(`/s/${sweep.sweepId}`)
}

/** Reactive joined-sweeps list — re-renders the caller when sweeps change. */
export function useSweeps() {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((x) => x + 1)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])
  return listSweeps()
}
