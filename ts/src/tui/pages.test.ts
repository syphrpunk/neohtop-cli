import { describe, expect, test } from 'bun:test'
import { defaultProbes, type ProbeSet } from '../monitor/probes.ts'
import type { ProcessInfo } from '../monitor/types.ts'
import { fulfillPage, type PageLoaders } from './pages.ts'
import type { HardwareView } from './state.ts'

const CWD = '/tmp/sloppytop-secret-cwd'
const ENV = 'SLOPPY_SECRET=hunter2'
const ADDRESS = '203.0.113.10:9999'

function proc(pid: number, ppid: number, name: string): ProcessInfo {
  return {
    pid,
    ppid,
    name,
    cpu_usage: 0,
    memory_bytes: 0,
    status: 'Sleeping',
    user: 'me',
    command: name,
    runtime_secs: 1,
    disk_read_bytes: 0,
    disk_write_bytes: 0,
  }
}

function calls() {
  const seen = { detail: 0, files: 0, net: 0, listen: 0, hardware: 0, refresh: [] as boolean[] }
  const loaders: PageLoaders = {
    processDetail: async () => {
      seen.detail++
      return { cwd: CWD, environ: [ENV] }
    },
    openFiles: () => {
      seen.files++
      return []
    },
    sampleNet: async () => {
      seen.net++
      return [
        {
          proto: 'tcp',
          local: ADDRESS,
          remote: '127.0.0.1:1',
          pid: 7,
          name: 'app',
          rx_bytes_per_s: 0,
          tx_bytes_per_s: 0,
        },
      ]
    },
    listeningSockets: () => {
      seen.listen++
      return [{ protocol: 'tcp', port: 443, pid: 7, name: 'app' }]
    },
    hardwareInventory: (opts) => {
      seen.hardware++
      seen.refresh.push(opts.refresh === true)
      const report: HardwareView = {
        collected_at: '2026-01-01T00:00:00.000Z',
        chip: 'Test',
        logical_cores: 2,
        memory_bytes: 1024,
        displays: [],
        from_cache: opts.refresh !== true,
      }
      return report
    },
  }
  return { seen, loaders }
}

function ctx(probes: ProbeSet = defaultProbes()) {
  return {
    probes,
    sampleMs: 500,
    processes: [proc(1, 0, 'init'), proc(7, 1, 'app'), proc(8, 7, 'child')],
  }
}

describe('on-demand pages', () => {
  test('a table tick effect calls none of the page loaders', async () => {
    const { seen, loaders } = calls()
    const patch = await fulfillPage({}, ctx(), loaders)
    expect(patch.log).toEqual([])
    expect(seen).toMatchObject({ detail: 0, files: 0, net: 0, listen: 0, hardware: 0 })
  })

  test('opening detail loads cwd for the screen and leaves the path and the environment out of the log', async () => {
    const { seen, loaders } = calls()
    const patch = await fulfillPage({ detailPid: 7 }, ctx(), loaders)
    expect(seen.detail).toBe(1)
    expect(seen.files).toBe(0)
    expect(seen.net).toBe(0)
    expect(seen.listen).toBe(0)
    expect(seen.hardware).toBe(0)
    expect(patch.detail?.cwd).toBe(CWD)
    expect(patch.detail?.env).toBeUndefined()
    expect(patch.log[0]).toMatchObject({ probe: 'proc', pid: 7, children: 1, has_cwd: true, file_count: null })
    const logged = JSON.stringify(patch.log)
    expect(logged).not.toContain(CWD)
    expect(logged).not.toContain(ENV)
    expect(logged).not.toContain('hunter2')
  })

  test('e keeps the environment on the page and still leaves it out of the log', async () => {
    const { seen, loaders } = calls()
    const patch = await fulfillPage({ loadEnv: 7 }, ctx(), loaders)
    expect(seen.files).toBe(0)
    expect(patch.detail?.env).toEqual([ENV])
    expect(JSON.stringify(patch.log)).not.toContain(ENV)
    expect(JSON.stringify(patch.log)).not.toContain(CWD)
  })

  test('o asks for open files, and an unmeasured list is not stored as zero', async () => {
    const measured = calls()
    const empty = await fulfillPage({ loadFiles: 7 }, ctx(), measured.loaders)
    expect(measured.seen.files).toBe(1)
    expect(measured.seen.net).toBe(0)
    expect(empty.detail?.files).toEqual([])
    expect(empty.detail?.filesOmitted).toBe(false)
    expect(empty.log[0]).toMatchObject({ file_count: 0, has_cwd: true })
    expect(JSON.stringify(empty.log)).not.toContain(CWD)

    const omitted = calls()
    omitted.loaders.openFiles = () => {
      omitted.seen.files++
      return undefined
    }
    const missing = await fulfillPage({ loadFiles: 7 }, ctx(), omitted.loaders)
    expect(missing.detail?.filesOmitted).toBe(true)
    expect(missing.detail?.files).toBeUndefined()
    expect(missing.log[0]).toMatchObject({ file_count: null })
  })

  test('an off probe does not call the loader', async () => {
    const { seen, loaders } = calls()
    const probes = { ...defaultProbes(), connections: false, listen: false, hardware: false, proc: false }
    const net = await fulfillPage({ openNet: true }, ctx(probes), loaders)
    const listen = await fulfillPage({ openListen: true }, ctx(probes), loaders)
    const hardware = await fulfillPage({ openHardware: true }, ctx(probes), loaders)
    const detail = await fulfillPage({ detailPid: 7, loadFiles: 7 }, ctx(probes), loaders)
    expect(seen).toMatchObject({ detail: 0, files: 0, net: 0, listen: 0, hardware: 0 })
    expect(net.page?.status).toBe('off')
    expect(net.page?.message).toContain('probe connections is off')
    expect(net.log).toEqual([])
    expect(listen.page?.message).toContain('probe listen is off')
    expect(hardware.page?.message).toContain('probe hardware is off')
    expect(detail.detail?.message).toContain('probe proc is off')
    expect(detail.log).toEqual([])
  })

  test('connections and listen log a count and not the address', async () => {
    const { seen, loaders } = calls()
    const net = await fulfillPage({ openNet: true }, ctx(), loaders)
    expect(seen.net).toBe(1)
    expect(seen.hardware).toBe(0)
    expect(net.page?.net?.[0]?.local).toBe(ADDRESS)
    expect(net.log[0]).toMatchObject({ probe: 'connections', count: 1 })
    expect(JSON.stringify(net.log)).not.toContain(ADDRESS)

    const listen = await fulfillPage({ openListen: true }, ctx(), loaders)
    expect(listen.log[0]).toMatchObject({ probe: 'listen', count: 1 })
    expect(JSON.stringify(listen.log)).not.toContain('443')
  })

  test('hardware uses the cache until refresh', async () => {
    const { seen, loaders } = calls()
    const cached = await fulfillPage({ openHardware: true }, ctx(), loaders)
    expect(seen.refresh).toEqual([false])
    expect(cached.page?.hardware?.from_cache).toBe(true)
    expect(cached.log[0]).toMatchObject({ probe: 'hardware', from_cache: true, logical_cores: 2, displays: 0 })
    expect(JSON.stringify(cached.log)).not.toContain('serial')

    const fresh = await fulfillPage({ refreshHardware: true }, ctx(), loaders)
    expect(seen.refresh).toEqual([false, true])
    expect(fresh.page?.hardware?.from_cache).toBeUndefined()
    expect(fresh.log[0]).toMatchObject({ from_cache: false })
  })
})
