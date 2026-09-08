import { expect, test } from 'vitest'
import { parseJoinLink, parseSweepPath } from './joinLink.js'

test('parses a bare member join link', () => {
  expect(parseJoinLink('/g/Abc123Def456Ghi789Jkl0')).toEqual({
    memberToken: 'Abc123Def456Ghi789Jkl0',
    adminToken: null,
  })
})

test('parses a member+admin join link', () => {
  expect(parseJoinLink('/g/MEMBERtoken0000000000/admin/ADMINtoken00000000000')).toEqual({
    memberToken: 'MEMBERtoken0000000000',
    adminToken: 'ADMINtoken00000000000',
  })
})

test('tolerates a trailing slash on a bare link', () => {
  expect(parseJoinLink('/g/Abc123Def456Ghi789Jkl0/')).toEqual({
    memberToken: 'Abc123Def456Ghi789Jkl0',
    adminToken: null,
  })
})

test('returns null for a non-join path', () => {
  expect(parseJoinLink('/')).toBeNull()
  expect(parseJoinLink('/teams/ar')).toBeNull()
  expect(parseJoinLink('/g')).toBeNull()
  expect(parseJoinLink('/g/')).toBeNull()
})

test('returns null when /admin/ is present but its token is missing', () => {
  expect(parseJoinLink('/g/MEMBERtoken0000000000/admin')).toBeNull()
  expect(parseJoinLink('/g/MEMBERtoken0000000000/admin/')).toBeNull()
})

// /g/<token> is the invite — a credential, spent once and stripped. /s/<id> is the
// address it lands on: not a secret, safe in a bookmark, a screenshot or history.
test('parseSweepPath reads the sweep id off its own path, and its sub-paths', () => {
  expect(parseSweepPath('/s/sw_abc123')).toBe('sw_abc123')
  expect(parseSweepPath('/s/sw_abc123/')).toBe('sw_abc123')
  expect(parseSweepPath('/s/sw_abc123/standings')).toBe('sw_abc123')
  expect(parseSweepPath('/s/sw_abc123/teams/hr')).toBe('sw_abc123')
})

test('parseSweepPath is null for anything that is not a sweep path', () => {
  expect(parseSweepPath('/')).toBeNull()
  expect(parseSweepPath('/s')).toBeNull()
  expect(parseSweepPath('/s/')).toBeNull()
  expect(parseSweepPath('/standings')).toBeNull()
  expect(parseSweepPath('/g/tokentokentokentoken')).toBeNull()
})
