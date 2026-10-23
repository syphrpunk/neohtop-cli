// Binds GET /metrics under XDG_CONFIG_HOME. Refuses to run without that variable
// so a direct invocation cannot write the real config. Not a bun test file.

import { configPath, loadConfig, updateMetrics } from '../store/config.ts'
import { bindMetricsListener } from './store.ts'

if (import.meta.main) {
  await main()
}

async function main(): Promise<void> {
  const root = process.env.XDG_CONFIG_HOME
  if (!root) {
    console.log(JSON.stringify({ error: 'XDG_CONFIG_HOME is required' }))
    process.exit(1)
  }
  let stop: (() => void) | undefined
  try {
    let bound: ReturnType<typeof bindMetricsListener> | undefined
    for (let attempt = 0; attempt < 5; attempt++) {
      const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ok') })
      const port = probe.port
      probe.stop(true)
      updateMetrics({ enabled: true, host: '127.0.0.1', port })
      const config = loadConfig()
      bound = bindMetricsListener({
        host: config.metrics.host,
        port: config.metrics.port,
        sample: async () => ({ cpu_usage_total: 1 }),
      })
      if (bound.ok) break
    }
    if (!bound?.ok) {
      console.log(JSON.stringify({ config: configPath(), error: bound?.message ?? 'metrics bind failed' }))
      process.exitCode = 1
      return
    }
    stop = bound.stop
    const base = `http://127.0.0.1:${bound.port}`
    const res = await fetch(`${base}/metrics`)
    const other = await fetch(`${base}/nope`)
    console.log(
      JSON.stringify({
        config: configPath(),
        status: res.status,
        type: res.headers.get('content-type'),
        body: await res.text(),
        other: other.status,
      }),
    )
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'metrics check failed'
    console.log(JSON.stringify({ config: configPath(), error: message }))
    process.exitCode = 1
  } finally {
    stop?.()
  }
}
