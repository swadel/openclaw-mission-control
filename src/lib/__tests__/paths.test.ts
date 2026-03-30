import { describe, it, expect } from 'vitest'
import { resolveWithin } from '../paths'
import path from 'node:path'
import os from 'node:os'

describe('resolveWithin', () => {
  // Use os.tmpdir() so paths are valid on all platforms (Windows, Linux, macOS)
  const base = path.join(os.tmpdir(), 'sandbox')

  it('resolves a simple relative path within base', () => {
    const result = resolveWithin(base, 'file.txt')
    expect(result).toBe(path.join(base, 'file.txt'))
  })

  it('resolves nested relative path', () => {
    const result = resolveWithin(base, path.join('subdir', 'file.txt'))
    expect(result).toBe(path.join(base, 'subdir', 'file.txt'))
  })

  it('throws when path escapes base with ..', () => {
    expect(() => resolveWithin(base, '../escape.txt')).toThrow('Path escapes base directory')
  })

  it('throws when path tries deep escape', () => {
    expect(() => resolveWithin(base, '../../etc/passwd')).toThrow('Path escapes base directory')
  })

  it('throws for absolute path outside base', () => {
    // Use a sibling directory — guaranteed to be outside base on all platforms
    const outsidePath = path.join(os.tmpdir(), 'other', 'passwd')
    expect(() => resolveWithin(base, outsidePath)).toThrow('Path escapes base directory')
  })

  it('allows an absolute path within the base', () => {
    const innerPath = path.join(base, 'file.txt')
    const result = resolveWithin(base, innerPath)
    expect(result).toBe(innerPath)
  })

  it('handles double slashes and normalizes', () => {
    // path.join normalizes separators; verify resolution lands in the right place
    const result = resolveWithin(base, path.join('subdir', 'file.txt'))
    expect(result).toBe(path.join(base, 'subdir', 'file.txt'))
  })

  it('does not allow sibling directory access', () => {
    expect(() => resolveWithin(base, '../other/file.txt')).toThrow()
  })

  it('handles base dir with trailing slash', () => {
    const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep
    const result = resolveWithin(baseWithSep, 'file.txt')
    expect(result).toBe(path.join(base, 'file.txt'))
  })
})
