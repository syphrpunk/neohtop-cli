// GET /metrics for a Prometheus or Grafana scrape. The listener is started
// only when metrics.enabled is true.

import type { SystemStats } from '../monitor/types.ts'
import { renderSystemMetrics } from './openmetrics.ts'

const CONTENT_TYPE = 'application/openmetrics-text; version=1.0.0; charset=utf-8'

export async function metricsResponse(
  request: Request,
  load: () => Promise<Partial<SystemStats>>,
): Promise<Response> {
  const path = new URL(request.url).pathname
  if (path !== '/metrics') return new Response('not found\n', { status: 404 })
  if (request.method !== 'GET') return new Response('method not allowed\n', { status: 405 })
  const system = await load()
  return new Response(renderSystemMetrics(system), {
    status: 200,
    headers: { 'content-type': CONTENT_TYPE },
  })
}
