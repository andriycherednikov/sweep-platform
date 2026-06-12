// web/src/InstallPrompt.test.jsx
import { expect, test, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { InstallPrompt, InstallButton } from './InstallPrompt.jsx'

const hook = vi.hoisted(() => ({ value: {} }))
vi.mock('./hooks/useInstallPrompt.js', () => ({ useInstallPrompt: () => hook.value }))
const desktop = vi.hoisted(() => ({ value: false }))
vi.mock('./components.jsx', async (orig) => ({ ...(await orig()), useIsDesktop: () => desktop.value }))

function setHook(over) {
  hook.value = {
    canPrompt: false, installed: false, dismissed: false, isIOS: false,
    hasNativePrompt: false, promptInstall: vi.fn(), dismiss: vi.fn(), ...over,
  }
}

beforeEach(() => { setHook(); desktop.value = false })
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

test('InstallButton: shown when installable (even after the banner was dismissed)', () => {
  const promptInstall = vi.fn().mockResolvedValue('accepted')
  setHook({ canInstall: true, hasNativePrompt: true, promptInstall })
  render(<InstallButton />)
  fireEvent.click(screen.getByRole('button', { name: /install as an app/i }))
  expect(promptInstall).toHaveBeenCalled()
})

test('InstallButton: hidden when not installable', () => {
  setHook({ canInstall: false })
  const { container } = render(<InstallButton />)
  expect(container).toBeEmptyDOMElement()
})

test('InstallButton: hidden on desktop', () => {
  desktop.value = true
  setHook({ canInstall: true, hasNativePrompt: true })
  const { container } = render(<InstallButton />)
  expect(container).toBeEmptyDOMElement()
})

test('InstallButton on iOS shows the Add to Home Screen sheet', () => {
  setHook({ canInstall: true, isIOS: true, hasNativePrompt: false, promptInstall: vi.fn() })
  render(<InstallButton />)
  fireEvent.click(screen.getByRole('button', { name: /install as an app/i }))
  expect(screen.getByRole('heading', { name: /add to home screen/i })).toBeInTheDocument()
})
