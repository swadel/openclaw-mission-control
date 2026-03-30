import { describe, it, expect } from 'vitest'
import { normalizeRelativePath, isPathAllowed, MEMORY_ALLOWED_PREFIXES } from '../memory-path'

describe('normalizeRelativePath', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeRelativePath('')).toBe('')
  })

  it('converts backslashes to forward slashes', () => {
    expect(normalizeRelativePath('subdir\\file.txt')).toBe('subdir/file.txt')
  })

  it('strips leading slashes', () => {
    expect(normalizeRelativePath('/notes/today.md')).toBe('notes/today.md')
    expect(normalizeRelativePath('///triple/lead')).toBe('triple/lead')
  })

  it('leaves relative paths unchanged', () => {
    expect(normalizeRelativePath('notes/today.md')).toBe('notes/today.md')
  })

  it('handles null/undefined-like falsy values', () => {
    // @ts-expect-error testing non-string
    expect(normalizeRelativePath(null)).toBe('')
    // @ts-expect-error testing non-string
    expect(normalizeRelativePath(undefined)).toBe('')
  })

  it('normalizes mixed separators', () => {
    expect(normalizeRelativePath('/dir\\subdir/file.txt')).toBe('dir/subdir/file.txt')
  })
})

describe('isPathAllowed', () => {
  it('allows all paths when no prefix allowlist is configured', () => {
    if (MEMORY_ALLOWED_PREFIXES.length === 0) {
      expect(isPathAllowed('anything/goes')).toBe(true)
      expect(isPathAllowed('../escape')).toBe(true)
    }
  })

  it('allows paths that match a configured prefix', () => {
    if (MEMORY_ALLOWED_PREFIXES.length > 0) {
      // A file directly under the first allowed prefix should be permitted
      const prefix = MEMORY_ALLOWED_PREFIXES[0] // e.g. 'memory/'
      expect(isPathAllowed(`${prefix}notes.md`)).toBe(true)
    }
  })

  it('allows the prefix directory itself (minus trailing slash)', () => {
    if (MEMORY_ALLOWED_PREFIXES.length > 0) {
      const prefix = MEMORY_ALLOWED_PREFIXES[0].replace(/\/$/, '') // 'memory'
      expect(isPathAllowed(prefix)).toBe(true)
    }
  })

  it('blocks paths that do not match any configured prefix', () => {
    if (MEMORY_ALLOWED_PREFIXES.length > 0) {
      // A path that cannot match any prefix should be blocked
      expect(isPathAllowed('__VERY_UNLIKELY_TO_MATCH__/file.md')).toBe(false)
    }
  })
})
