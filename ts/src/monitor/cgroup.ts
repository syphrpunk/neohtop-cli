// Linux cgroup2 path from `/proc/<pid>/cgroup`. A v2 line is `0::/path`.
// cgroup1 lines (`12:cpuacct:/path`) are ignored. below refuses cgroup1; so do we.

/** The cgroup2 path, or undefined when the file has no `0::` line. `/` is the root cgroup. */
export function parseCgroupPath(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const m = line.match(/^0::(.*)$/)
    if (!m) continue
    const path = (m[1] ?? '').trim()
    if (path === '' || path === '/') return '/'
    return path.startsWith('/') ? path : `/${path}`
  }
  return
}
