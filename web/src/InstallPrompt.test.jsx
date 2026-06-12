// web/src/InstallPrompt.test.jsx
import { expect, test, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { InstallPrompt } from './InstallPrompt.jsx'

const hook = vi.hoisted(() => ({ value: {} }))
vi.mock('./hooks/useInstallPrompt.js', () => ({ useInstallPrompt: () => hook.value }))

function setHook(over) {
  hook.value = {
    canPrompt: false, installed: false, dismissed: false, isIOS: false,
    hasNativePrompt: false, promptInstall: vi.fn(), dismiss: vi.fn(), ...over,
  }
}

beforeEach(() => setHook())
afterEach(cleanup)

test('renders nothing when it cannot prompt', () => {
  setHook({ canPrompt: false })
  const { container } = render(<InstallPrompt />)
  expect(container).toBeEmptyDOMElement()
})

test('Android: shows an Install button that replays the deferred prompt', () => {
  const promptInstall = vi.fn().mockResolvedValue('accepted')
  setHook({ canPrompt: true, hasNativePrompt: true, promptInstall })
  render(<InstallPrompt />)
  fireEvent.click(screen.getByRole('button', { name: /install/i }))
  expect(promptInstall).toHaveBeenCalled()
})

test('dismiss button calls dismiss()', () => {
  const dismiss = vi.fn()
  setHook({ canPrompt: true, hasNativePrompt: true, dismiss })
  render(<InstallPrompt />)
  fireEvent.click(screen.getByLabelText(/dismiss/i))
  expect(dismiss).toHaveBeenCalled()
})

test('iOS: tapping it reveals Add to Home Screen instructions instead of calling a native prompt', () => {
  const promptInstall = vi.fn()
  setHook({ canPrompt: true, isIOS: true, hasNativePrompt: false, promptInstall })
  render(<InstallPrompt />)
  fireEvent.click(screen.getByRole('button', { name: /install/i }))
  expect(promptInstall).not.toHaveBeenCalled()
  expect(screen.getByRole('heading', { name: /add to home screen/i })).toBeInTheDocument()
})
