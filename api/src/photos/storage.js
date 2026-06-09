import { mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Resolve the photos root into pending/ + approved/ subdirs (created if missing). */
export async function createStorage(rootDir) {
  const pendingDir = join(rootDir, 'pending')
  const approvedDir = join(rootDir, 'approved')
  await mkdir(pendingDir, { recursive: true })
  await mkdir(approvedDir, { recursive: true })
  return {
    approvedDir,
    pendingPath: (name) => join(pendingDir, name),
    approvedPath: (name) => join(approvedDir, name),
    writePending: (name, buf) => writeFile(join(pendingDir, name), buf),
    moveToApproved: (name) => rename(join(pendingDir, name), join(approvedDir, name)),
    removePending: (name) => rm(join(pendingDir, name), { force: true }),
    removeApproved: (name) => rm(join(approvedDir, name), { force: true }),
  }
}

/** Synchronous variant of createStorage — keeps buildApp synchronous. */
export function createStorageSync(rootDir) {
  const pendingDir = join(rootDir, 'pending')
  const approvedDir = join(rootDir, 'approved')
  mkdirSync(pendingDir, { recursive: true })
  mkdirSync(approvedDir, { recursive: true })
  return {
    approvedDir,
    pendingPath: (name) => join(pendingDir, name),
    approvedPath: (name) => join(approvedDir, name),
    writePending: (name, buf) => writeFile(join(pendingDir, name), buf),
    moveToApproved: (name) => rename(join(pendingDir, name), join(approvedDir, name)),
    removePending: (name) => rm(join(pendingDir, name), { force: true }),
    removeApproved: (name) => rm(join(approvedDir, name), { force: true }),
  }
}
