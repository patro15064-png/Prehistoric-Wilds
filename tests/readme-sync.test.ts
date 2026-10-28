import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('README.md automated synchronization', () => {
  it('is strictly synced with zero mismatch or stale keywords', () => {
    const output = execSync('node scripts/sync-readme.mjs --check', {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    })
    expect(output).toContain('README is 100% synchronized')
  })

  it('contains no remnants of stamina bars, stamina costs, or sky cores', () => {
    const readme = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf-8')
    expect(readme).not.toMatch(/refund\s+stamina/i)
    expect(readme).not.toMatch(/stamina\s+bar/i)
    expect(readme).not.toMatch(/costs\s+stamina/i)
    expect(readme).not.toMatch(/Sky\s+Cores/i)
  })

  it('accurately documents the action-driven hunger survival mechanic', () => {
    const readme = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf-8')
    expect(readme).toContain('Action-Driven Hunger')
    expect(readme).toContain('0.005/s')
  })
})
