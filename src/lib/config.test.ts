import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadConfigWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules()

  const original = {
    MISSION_CONTROL_DATA_DIR: process.env.MISSION_CONTROL_DATA_DIR,
    MISSION_CONTROL_BUILD_DATA_DIR: process.env.MISSION_CONTROL_BUILD_DATA_DIR,
    MISSION_CONTROL_BUILD_DB_PATH: process.env.MISSION_CONTROL_BUILD_DB_PATH,
    MISSION_CONTROL_BUILD_TOKENS_PATH: process.env.MISSION_CONTROL_BUILD_TOKENS_PATH,
    MISSION_CONTROL_DB_PATH: process.env.MISSION_CONTROL_DB_PATH,
    MISSION_CONTROL_TOKENS_PATH: process.env.MISSION_CONTROL_TOKENS_PATH,
    NEXT_PHASE: process.env.NEXT_PHASE,
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  const mod = await import('./config')

  if (original.MISSION_CONTROL_DATA_DIR === undefined) delete process.env.MISSION_CONTROL_DATA_DIR
  else process.env.MISSION_CONTROL_DATA_DIR = original.MISSION_CONTROL_DATA_DIR

  if (original.MISSION_CONTROL_BUILD_DATA_DIR === undefined) delete process.env.MISSION_CONTROL_BUILD_DATA_DIR
  else process.env.MISSION_CONTROL_BUILD_DATA_DIR = original.MISSION_CONTROL_BUILD_DATA_DIR

  if (original.MISSION_CONTROL_BUILD_DB_PATH === undefined) delete process.env.MISSION_CONTROL_BUILD_DB_PATH
  else process.env.MISSION_CONTROL_BUILD_DB_PATH = original.MISSION_CONTROL_BUILD_DB_PATH

  if (original.MISSION_CONTROL_BUILD_TOKENS_PATH === undefined) delete process.env.MISSION_CONTROL_BUILD_TOKENS_PATH
  else process.env.MISSION_CONTROL_BUILD_TOKENS_PATH = original.MISSION_CONTROL_BUILD_TOKENS_PATH

  if (original.MISSION_CONTROL_DB_PATH === undefined) delete process.env.MISSION_CONTROL_DB_PATH
  else process.env.MISSION_CONTROL_DB_PATH = original.MISSION_CONTROL_DB_PATH

  if (original.MISSION_CONTROL_TOKENS_PATH === undefined) delete process.env.MISSION_CONTROL_TOKENS_PATH
  else process.env.MISSION_CONTROL_TOKENS_PATH = original.MISSION_CONTROL_TOKENS_PATH

  if (original.NEXT_PHASE === undefined) delete process.env.NEXT_PHASE
  else process.env.NEXT_PHASE = original.NEXT_PHASE

  return mod.config
}

describe('config data paths', () => {
  // Use os.tmpdir() for cross-platform path compatibility (Linux, Windows, macOS)
  const dataDir = path.join(os.tmpdir(), 'mc-test-data')
  const buildScratch = path.join(os.tmpdir(), 'mc-build-scratch')
  const escapedSep = path.sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  beforeEach(() => {
    vi.resetModules()
  })

  it('derives db and token paths from MISSION_CONTROL_DATA_DIR', async () => {
    const config = await loadConfigWithEnv({
      MISSION_CONTROL_DATA_DIR: dataDir,
      MISSION_CONTROL_DB_PATH: undefined,
      MISSION_CONTROL_TOKENS_PATH: undefined,
    })

    expect(config.dataDir).toBe(dataDir)
    expect(config.dbPath).toBe(path.join(dataDir, 'mission-control.db'))
    expect(config.tokensPath).toBe(path.join(dataDir, 'mission-control-tokens.json'))
  })

  it('respects explicit db and token path overrides', async () => {
    const customDb = path.join(os.tmpdir(), 'custom.db')
    const customTokens = path.join(os.tmpdir(), 'custom-tokens.json')
    const config = await loadConfigWithEnv({
      MISSION_CONTROL_DATA_DIR: dataDir,
      MISSION_CONTROL_DB_PATH: customDb,
      MISSION_CONTROL_TOKENS_PATH: customTokens,
    })

    expect(config.dataDir).toBe(dataDir)
    expect(config.dbPath).toBe(customDb)
    expect(config.tokensPath).toBe(customTokens)
  })

  it('uses a build-scoped worker data dir during next build', async () => {
    const config = await loadConfigWithEnv({
      NEXT_PHASE: 'phase-production-build',
      MISSION_CONTROL_DATA_DIR: path.join(os.tmpdir(), 'mc-runtime-data'),
      MISSION_CONTROL_BUILD_DATA_DIR: buildScratch,
      MISSION_CONTROL_DB_PATH: undefined,
      MISSION_CONTROL_TOKENS_PATH: undefined,
    })

    const escapedScratch = buildScratch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(config.dataDir).toMatch(new RegExp(`^${escapedScratch}${escapedSep}worker-\\d+$`))
    expect(config.dbPath).toMatch(new RegExp(`^${escapedScratch}${escapedSep}worker-\\d+${escapedSep}mission-control\\.db$`))
    expect(config.tokensPath).toMatch(new RegExp(`^${escapedScratch}${escapedSep}worker-\\d+${escapedSep}mission-control-tokens\\.json$`))
  })

  it('prefers build-specific db and token overrides during next build', async () => {
    const buildDb = path.join(os.tmpdir(), 'build.db')
    const buildTokens = path.join(os.tmpdir(), 'build-tokens.json')
    const config = await loadConfigWithEnv({
      NEXT_PHASE: 'phase-production-build',
      MISSION_CONTROL_DATA_DIR: path.join(os.tmpdir(), 'mc-runtime-data'),
      MISSION_CONTROL_DB_PATH: path.join(os.tmpdir(), 'runtime.db'),
      MISSION_CONTROL_TOKENS_PATH: path.join(os.tmpdir(), 'runtime-tokens.json'),
      MISSION_CONTROL_BUILD_DB_PATH: buildDb,
      MISSION_CONTROL_BUILD_TOKENS_PATH: buildTokens,
    })

    const expectedBuildRoot = path.join(os.tmpdir(), 'mission-control-build')
    const escapedBuildRoot = expectedBuildRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(config.dataDir).toMatch(new RegExp(`^${escapedBuildRoot}${escapedSep}worker-\\d+$`))
    expect(config.dbPath).toBe(buildDb)
    expect(config.tokensPath).toBe(buildTokens)
  })
})
