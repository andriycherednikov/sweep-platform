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
    const title = html.match(/<title>(.*?)<\/title>/)?.[1] ?? ''
    expect(title).toMatch(/The Sweep/)
    // the point of this test, which pinning the exact string only enforced by accident:
    // the platform is multi-sport, so no one competition may be named in the title
    expect(title).not.toMatch(/world cup|premier league|nba|nfl|la liga|serie a|bundesliga/i)
  })

  test('carries the metadata a share or a crawler needs', () => {
    expect(html).toMatch(/<meta name="description" content="[^"]{50,}"/)
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/[^"]+\/og\.png"/)
    expect(html).toMatch(/<meta name="twitter:card" content="summary_large_image"/)
    expect(html).toMatch(/<link rel="canonical"/)
  })
})
