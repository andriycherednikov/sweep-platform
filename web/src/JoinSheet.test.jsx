import { expect, test, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { makeApi } from '../test/factories.js'

vi.mock('./api/client.js', () => ({
  postJoinCode: vi.fn(async () => ({ ok: true })),
  postJoinSession: vi.fn(async () => ({ accountToken: 't', account: { id: 'ac_1' } })),
  postMe: vi.fn(async () => ({ id: 'pn_new', name: 'Ada Lovelace', short: 'Ada', initials: 'AD', av: '#c9472f' })),
  uploadPhoto: vi.fn(async () => ({ id: 'ph_1', status: 'pending' })),
}))
import { postJoinCode, postJoinSession, postMe, uploadPhoto } from './api/client.js'
import { JoinSheet } from './JoinSheet.jsx'
import { getMe, setMe } from './social.js'
import { clearAccountToken, setAccountToken } from './lib/accountClient.js'

beforeEach(() => {
  vi.clearAllMocks()
  clearAccountToken()
  setMe(null)
  setSweepData(assembleSweep(makeApi()))
})

const typeIn = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

test('email → code → setup, and joining sets the identity', async () => {
  const onClose = vi.fn()
  const qc = { invalidateQueries: vi.fn() }
  render(<JoinSheet onClose={onClose} queryClient={qc} />)

  typeIn('Your email', 'ada@x.test')
  fireEvent.click(screen.getByRole('button', { name: /send my code/i }))
  await waitFor(() => expect(postJoinCode).toHaveBeenCalledWith('ada@x.test'))

  typeIn('Your code', '481920')
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
  await waitFor(() => expect(postJoinSession).toHaveBeenCalledWith('ada@x.test', '481920'))

  typeIn('First name', 'Ada')
  typeIn('Last name', 'Lovelace')
  fireEvent.click(screen.getByRole('button', { name: /join the sweep/i }))
  await waitFor(() => expect(postMe).toHaveBeenCalledWith('Ada Lovelace'))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] })
})

// "if this email is already registered, log in with that user" — a stored token IS
// that, and it is also how the owner takes a seat in their own sweep.
test('an account already signed in skips straight to setup', () => {
  setAccountToken('tok')
  render(<JoinSheet onClose={() => {}} />)
  expect(screen.getByLabelText('First name')).toBeInTheDocument()
  expect(screen.queryByLabelText('Your email')).toBeNull()
})

test('a bad code keeps the sheet open and says so', async () => {
  postJoinSession.mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))
  render(<JoinSheet onClose={() => {}} />)
  typeIn('Your email', 'ada@x.test')
  fireEvent.click(screen.getByRole('button', { name: /send my code/i }))
  await screen.findByLabelText('Your code')
  typeIn('Your code', '000000')
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/doesn't match|expired/i)
  expect(screen.getByLabelText('Your code')).toBeInTheDocument()
})

test('the code step can send another one', async () => {
  render(<JoinSheet onClose={() => {}} />)
  typeIn('Your email', 'ada@x.test')
  fireEvent.click(screen.getByRole('button', { name: /send my code/i }))
  await screen.findByLabelText('Your code')
  fireEvent.click(screen.getByRole('button', { name: /send it again/i }))
  await waitFor(() => expect(postJoinCode).toHaveBeenCalledTimes(2))
})

test('a photo is optional — you can join without one', async () => {
  setAccountToken('tok')
  const onClose = vi.fn()
  render(<JoinSheet onClose={onClose} />)
  typeIn('First name', 'Ada')
  fireEvent.click(screen.getByRole('button', { name: /join the sweep/i }))
  await waitFor(() => expect(postMe).toHaveBeenCalledWith('Ada'))
  expect(uploadPhoto).not.toHaveBeenCalled()
  await waitFor(() => expect(onClose).toHaveBeenCalled())
})

// Profile photos go to the moderation queue by default, so the seat must not wait on it.
test('a queued photo does not hold up the seat', async () => {
  setAccountToken('tok')
  const onClose = vi.fn()
  render(<JoinSheet onClose={onClose} />)
  typeIn('First name', 'Ada')
  const file = new File(['x'], 'me.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Add a photo'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: /join the sweep/i }))
  await waitFor(() => expect(uploadPhoto).toHaveBeenCalled())
  await waitFor(() => expect(onClose).toHaveBeenCalled())
})

test('a failed upload still leaves you in the sweep', async () => {
  setAccountToken('tok')
  uploadPhoto.mockRejectedValueOnce(new Error('HTTP 409'))
  const onClose = vi.fn()
  render(<JoinSheet onClose={onClose} />)
  typeIn('First name', 'Ada')
  fireEvent.change(screen.getByLabelText('Add a photo'), {
    target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] },
  })
  fireEvent.click(screen.getByRole('button', { name: /join the sweep/i }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
})
