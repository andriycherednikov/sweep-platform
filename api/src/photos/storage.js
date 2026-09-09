import { mkdir, writeFile, rm } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Resolve the photos root into approved/ (created if missing).
 *  There is no pending shelf: an upload is live the moment it is written, and the
 *  only later action is taking it down. */
export async function createStorage(rootDir) {
  const approvedDir = join(rootDir, 'approved')
  await mkdir(approvedDir, { recursive: true })
  return shape(approvedDir)
}

/** Synchronous variant of createStorage — keeps buildApp synchronous. */
export function createStorageSync(rootDir) {
  const approvedDir = join(rootDir, 'approved')
  mkdirSync(approvedDir, { recursive: true })
  return shape(approvedDir)
}

function shape(approvedDir) {
  return {
    approvedDir,
    approvedPath: (name) => join(approvedDir, name),
    writeApproved: (name, buf) => writeFile(join(approvedDir, name), buf),
    removeApproved: (name) => rm(join(approvedDir, name), { force: true }),
  }
}
