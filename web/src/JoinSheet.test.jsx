import { expect, test, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { makeApi } from '../test/factories.js'

vi.mock('./lib/accountClient.js', async (orig) => ({
  ...(await orig()),
  getAccount: vi.fn(async () => ({ id: 'ac_1', email: 'ada@x.test' })),
}))
vi.mock('./api/client.js', () => ({
  postJoinCode: vi.fn(async () => ({ ok: true })),
  postJoinSession: vi.fn(async () => ({ accountToken: 't', account: { id: 'ac_1' } })),
  postMe: vi.fn(async () => ({ id: 'pn_new', name: 'Ada Lovelace', short: 'Ada', initials: 'AD', av: '#c9472f' })),
  uploadPhoto: vi.fn(async () => ({ id: 'ph_1', status: 'approved' })),
}))
import { postJoinCode, postJoinSession, postMe, uploadPhoto } from './api/client.js'
import { JoinSheet } from './JoinSheet.jsx'
import { getMe, setMe } from './social.js'
import { clearAccountToken, setAccountToken, getAccount, getAccountToken } from './lib/accountClient.js'

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

test('a photo is uploaded with the seat', async () => {
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

// A token in localStorage is not proof of a session: it expires, it gets revoked, and a
// dev database gets wiped. Trusting its mere presence dropped people into a form that
// could only 401 — behind a gate with no close button, which is a dead end.
test('a stale token sends you back to the email step instead of a doomed form', async () => {
  setAccountToken('stale')
  getAccount.mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))
  render(<JoinSheet onClose={() => {}} />)
  expect(await screen.findByLabelText('Your email')).toBeInTheDocument()
  expect(screen.queryByLabelText('First name')).toBeNull()
  expect(getAccountToken()).toBeNull()
})

test('a valid token still goes straight to setup', async () => {
  setAccountToken('good')
  render(<JoinSheet onClose={() => {}} />)
  expect(await screen.findByLabelText('First name')).toBeInTheDocument()
})

// Belt and braces: a session can lapse between opening the sheet and submitting it.
test('a 401 on submit says what happened and offers a way forward', async () => {
  setAccountToken('good')
  postMe.mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))
  render(<JoinSheet onClose={() => {}} />)
  fireEvent.change(await screen.findByLabelText('First name'), { target: { value: 'Ada' } })
  fireEvent.click(screen.getByRole('button', { name: /join the sweep/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/sign(ed)? ?in|expired/i)
  expect(await screen.findByLabelText('Your email')).toBeInTheDocument()
  expect(getAccountToken()).toBeNull()
})

// Logging out and being asked to "join" again — with a form asking for a name the
// roster already knows — was the complaint. A returning member goes straight in.
test('a returning member is signed back in, not asked to set up again', async () => {
  postJoinSession.mockResolvedValueOnce({
    accountToken: 't', account: { id: 'ac_1' }, person: { id: 'p1', short: 'Ada' },
  })
  const onClose = vi.fn()
  const qc = { invalidateQueries: vi.fn() }
  render(<JoinSheet onClose={onClose} queryClient={qc} />)

  fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'ada@x.test' } })
  fireEvent.click(screen.getByRole('button', { name: /send my code/i }))
  fireEvent.change(await screen.findByLabelText('Your code'), { target: { value: '481920' } })
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(postMe).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('First name')).toBeNull()
  expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] })
})

test('a newcomer still gets the setup step', async () => {
  postJoinSession.mockResolvedValueOnce({ accountToken: 't', account: { id: 'ac_1' }, person: null })
  render(<JoinSheet onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'new@x.test' } })
  fireEvent.click(screen.getByRole('button', { name: /send my code/i }))
  fireEvent.change(await screen.findByLabelText('Your code'), { target: { value: '481920' } })
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
  expect(await screen.findByLabelText('First name')).toBeInTheDocument()
})
