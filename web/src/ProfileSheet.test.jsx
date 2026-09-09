import { expect, test, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { makeApi } from '../test/factories.js'

vi.mock('./api/client.js', () => ({
  postMe: vi.fn(async () => ({ id: 'p1', name: 'Ada Lovelace', short: 'Ada' })),
  uploadPhoto: vi.fn(async () => ({ id: 'ph_1', status: 'approved' })),
}))
vi.mock('./lib/accountClient.js', async (orig) => ({
  ...(await orig()),
  getAccount: vi.fn(async () => ({ id: 'ac_1', email: 'ada@x.test' })),
}))
import { postMe, uploadPhoto } from './api/client.js'
import { ProfileSheet } from './ProfileSheet.jsx'

const person = { id: 'p1', name: 'Ada Lovelace', short: 'Ada', initials: 'AD', av: '#c9472f', avatarPath: null }
const noop = () => {}

beforeEach(() => {
  vi.clearAllMocks()
  setSweepData(assembleSweep(makeApi()))
  global.URL.createObjectURL ??= () => 'blob:preview'
  global.URL.revokeObjectURL ??= () => {}
})

test('it opens on your own details, name split into first and last', () => {
  render(<ProfileSheet person={person} onClose={noop} onToast={noop} />)
  expect(screen.getByLabelText('First name')).toHaveValue('Ada')
  expect(screen.getByLabelText('Last name')).toHaveValue('Lovelace')
})

// The address is what you sign in with, so it is shown but not editable here.
test('the email is read-only and says why', async () => {
  render(<ProfileSheet person={person} onClose={noop} onToast={noop} />)
  const email = await screen.findByDisplayValue('ada@x.test')
  expect(email).toHaveAttribute('readonly')
  expect(screen.getByText(/how you sign in/i)).toBeInTheDocument()
})

// The server takes a centred square; a round frame with object-fit:cover is that exact
// crop, which is the only reason the sheet can promise what it shows.
test('choosing a photo previews the crop that will actually be taken', async () => {
  render(<ProfileSheet person={person} onClose={noop} onToast={noop} />)
  const file = new File(['x'], 'me.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Choose a photo'), { target: { files: [file] } })
  const img = await screen.findByRole('presentation', { hidden: true }).catch(() => null)
  const preview = document.querySelector('img.join-face-av')
  expect(preview).toBeTruthy()
  expect(preview.style.objectFit).toBe('cover')
  expect(screen.getByText(/how it will be cut/i)).toBeInTheDocument()
})

test('saving sends the new name and the photo, then closes', async () => {
  const onClose = vi.fn()
  const qc = { invalidateQueries: vi.fn() }
  render(<ProfileSheet person={person} onClose={onClose} onToast={noop} queryClient={qc} />)
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Augusta' } })
  fireEvent.change(screen.getByLabelText('Choose a photo'), {
    target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] },
  })
  fireEvent.click(screen.getByRole('button', { name: /save/i }))
  await waitFor(() => expect(postMe).toHaveBeenCalledWith('Augusta Lovelace'))
  await waitFor(() => expect(uploadPhoto).toHaveBeenCalled())
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] })
})

test('with nothing changed there is nothing to save', () => {
  render(<ProfileSheet person={person} onClose={noop} onToast={noop} />)
  expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
})

test('a name-only change does not upload anything', async () => {
  render(<ProfileSheet person={person} onClose={noop} onToast={noop} />)
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Byron' } })
  fireEvent.click(screen.getByRole('button', { name: /save/i }))
  await waitFor(() => expect(postMe).toHaveBeenCalledWith('Ada Byron'))
  expect(uploadPhoto).not.toHaveBeenCalled()
})
