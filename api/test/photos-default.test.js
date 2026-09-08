import { test, expect } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { db } = openTestDb()

// Photos go live when they are uploaded. The approval queue was a kid-safe default that
// cost every new member their face until an admin got round to it.
test('photos are approved on upload unless explicitly turned off', () => {
  expect(buildApp(db, { sessionSecret: 's', env: {} }).autoApprovePhotos).toBe(true)
})

test('a deployment can still put them behind moderation', () => {
  expect(buildApp(db, { sessionSecret: 's', autoApprovePhotos: false }).autoApprovePhotos).toBe(false)
})
