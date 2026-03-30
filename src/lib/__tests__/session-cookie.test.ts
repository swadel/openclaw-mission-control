import { afterEach, describe, expect, it } from 'vitest'
import {
  getMcSessionCookieName,
  MC_SESSION_COOKIE_NAME,
  LEGACY_MC_SESSION_COOKIE_NAME,
  isRequestSecure,
  parseMcSessionCookieHeader,
  getMcSessionCookieOptions,
} from '../session-cookie'

describe('getMcSessionCookieName', () => {
  it('returns __Host- prefixed name for secure requests', () => {
    expect(getMcSessionCookieName(true)).toBe(MC_SESSION_COOKIE_NAME)
  })

  it('returns legacy name for non-secure requests', () => {
    expect(getMcSessionCookieName(false)).toBe(LEGACY_MC_SESSION_COOKIE_NAME)
  })
})

describe('isRequestSecure', () => {
  it('returns true for x-forwarded-proto: https', () => {
    const req = new Request('http://localhost/path', {
      headers: { 'x-forwarded-proto': 'https' },
    })
    expect(isRequestSecure(req)).toBe(true)
  })

  it('returns false for x-forwarded-proto: http', () => {
    const req = new Request('http://localhost/path', {
      headers: { 'x-forwarded-proto': 'http' },
    })
    expect(isRequestSecure(req)).toBe(false)
  })

  it('returns true when URL uses https protocol', () => {
    const req = new Request('https://example.com/path')
    expect(isRequestSecure(req)).toBe(true)
  })

  it('returns false for plain http URL without forwarded header', () => {
    const req = new Request('http://localhost/path')
    expect(isRequestSecure(req)).toBe(false)
  })

  it('x-forwarded-proto takes precedence over URL protocol', () => {
    // Forwarded proto says https even though URL is http
    const req = new Request('http://localhost/path', {
      headers: { 'x-forwarded-proto': 'https' },
    })
    expect(isRequestSecure(req)).toBe(true)
  })
})

describe('parseMcSessionCookieHeader', () => {
  it('returns null for empty string', () => {
    expect(parseMcSessionCookieHeader('')).toBeNull()
  })

  it('parses the __Host- prefixed cookie', () => {
    const header = `${MC_SESSION_COOKIE_NAME}=abc123`
    expect(parseMcSessionCookieHeader(header)).toBe('abc123')
  })

  it('parses the legacy cookie name', () => {
    const header = `${LEGACY_MC_SESSION_COOKIE_NAME}=mytoken`
    expect(parseMcSessionCookieHeader(header)).toBe('mytoken')
  })

  it('parses cookie among multiple cookies', () => {
    const header = `other=value; ${LEGACY_MC_SESSION_COOKIE_NAME}=sess42; foo=bar`
    expect(parseMcSessionCookieHeader(header)).toBe('sess42')
  })

  it('URL-decodes cookie values', () => {
    const header = `${LEGACY_MC_SESSION_COOKIE_NAME}=hello%20world`
    expect(parseMcSessionCookieHeader(header)).toBe('hello world')
  })

  it('returns null when no session cookie present', () => {
    expect(parseMcSessionCookieHeader('other=value; foo=bar')).toBeNull()
  })

  it('prefers __Host- cookie over legacy when both present', () => {
    const header = `${MC_SESSION_COOKIE_NAME}=new; ${LEGACY_MC_SESSION_COOKIE_NAME}=old`
    expect(parseMcSessionCookieHeader(header)).toBe('new')
  })
})

describe('getMcSessionCookieOptions', () => {
  const env = process.env as Record<string, string | undefined>
  const originalNodeEnv = env.NODE_ENV
  const originalCookieSecure = env.MC_COOKIE_SECURE

  afterEach(() => {
    if (originalNodeEnv === undefined) delete env.NODE_ENV
    else env.NODE_ENV = originalNodeEnv

    if (originalCookieSecure === undefined) delete env.MC_COOKIE_SECURE
    else env.MC_COOKIE_SECURE = originalCookieSecure
  })

  it('does not force secure cookies on plain HTTP in production when MC_COOKIE_SECURE is unset', () => {
    env.NODE_ENV = 'production'
    delete env.MC_COOKIE_SECURE

    const options = getMcSessionCookieOptions({ maxAgeSeconds: 60, isSecureRequest: false })
    expect(options.secure).toBe(false)
  })

  it('sets secure cookies for HTTPS requests when MC_COOKIE_SECURE is unset', () => {
    env.NODE_ENV = 'production'
    delete env.MC_COOKIE_SECURE

    const options = getMcSessionCookieOptions({ maxAgeSeconds: 60, isSecureRequest: true })
    expect(options.secure).toBe(true)
  })

  it('respects MC_COOKIE_SECURE=1 override', () => {
    env.NODE_ENV = 'production'
    env.MC_COOKIE_SECURE = '1'

    const options = getMcSessionCookieOptions({ maxAgeSeconds: 60, isSecureRequest: false })
    expect(options.secure).toBe(true)
  })

  it('respects MC_COOKIE_SECURE=false to disable secure flag', () => {
    env.NODE_ENV = 'production'
    env.MC_COOKIE_SECURE = 'false'

    const options = getMcSessionCookieOptions({ maxAgeSeconds: 60, isSecureRequest: true })
    expect(options.secure).toBe(false)
  })

  it('sets httpOnly and sameSite=strict always', () => {
    const options = getMcSessionCookieOptions({ maxAgeSeconds: 3600 })
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe('strict')
    expect(options.path).toBe('/')
  })

  it('passes through maxAgeSeconds as maxAge', () => {
    const options = getMcSessionCookieOptions({ maxAgeSeconds: 7200 })
    expect(options.maxAge).toBe(7200)
  })
})
