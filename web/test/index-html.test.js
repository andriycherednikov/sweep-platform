import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

describe('index.html iOS standalone metas', () => {
  test('declares apple-mobile-web-app-capable', () => {
    expect(html).toMatch(/<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"\s*\/?>/)
  })
  test('sets the status bar style for notch-safe standalone', () => {
    expect(html).toMatch(/<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="black-translucent"\s*\/?>/)
  })
  test('sets the home-screen app title', () => {
    expect(html).toMatch(/<meta\s+name="apple-mobile-web-app-title"\s+content="The Sweep"\s*\/?>/)
  })
  test('sets a theme-color matching the manifest', () => {
    expect(html).toMatch(/<meta\s+name="theme-color"\s+content="#0b1f3a"\s*\/?>/)
  })
  test('title is sport-neutral (no hardcoded competition name)', () => {
    expect(html).toMatch(/<title>The Sweep<\/title>/)
  })
})
