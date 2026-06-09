import { expect, test } from 'vitest'
import { computeFlags } from '../src/worker/flags.js'

const ownership = [
  { personId: 'p1', teamCode: 'hr' }, { personId: 'p1', teamCode: 'be' }, // p1 owns both hr & be
  { personId: 'p2', teamCode: 'gh' },
]

test('derby when both sides owned; doubleOwner when one person owns both', () => {
  const flags = computeFlags(
    [{ id: '1', t1Code: 'hr', t2Code: 'be' }, { id: '2', t1Code: 'hr', t2Code: 'gh' }, { id: '3', t1Code: 'fr', t2Code: 'gh' }],
    ownership,
  )
  expect(flags.get('1')).toEqual({ derby: true, doubleOwner: true })   // hr&be both owned, p1 owns both
  expect(flags.get('2')).toEqual({ derby: true, doubleOwner: false })  // hr & gh owned by different people
  expect(flags.get('3')).toEqual({ derby: false, doubleOwner: false }) // fr unowned
})
