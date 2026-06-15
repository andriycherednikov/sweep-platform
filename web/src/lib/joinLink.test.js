import { expect, test } from 'vitest'
import { parseJoinLink } from './joinLink.js'

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
