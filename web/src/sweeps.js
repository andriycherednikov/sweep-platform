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
