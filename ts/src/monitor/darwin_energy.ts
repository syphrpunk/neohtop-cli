// Apple Silicon package power from IOReport's Energy Model.
// Counters are cumulative. The unit label (nJ or mJ) is what the channel
// says; libIOReport is not on disk, dyld opens it from the shared cache.
// A failure omits power for the rest of the process rather than failing collect().

import { dlopen, JSCallback, ptr, type Pointer } from 'bun:ffi'
import { toNanojoules, type EnergyNj, type PowerKey } from './energy.ts'

const UTF8 = 0x0800_0100

const CHANNELS: Record<string, PowerKey> = {
  'CPU Energy': 'cpu',
  'GPU Energy': 'gpu',
  ANE: 'ane',
  DRAM: 'dram',
}

type IoLib = ReturnType<typeof openIo>
type CfLib = ReturnType<typeof openCf>

let io: IoLib | null | undefined
let cf: CfLib | null | undefined
let subscription: Pointer | null = null
let subscribed: Pointer | null = null
let group: Pointer | null = null
let unavailable = false

function openCf() {
  return dlopen('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation', {
    CFStringCreateWithCString: { args: ['ptr', 'ptr', 'u32'], returns: 'ptr' },
    CFStringGetCString: { args: ['ptr', 'ptr', 'i64', 'u32'], returns: 'u8' },
    CFRelease: { args: ['ptr'], returns: 'void' },
  })
}

function openIo() {
  return dlopen('/usr/lib/libIOReport.dylib', {
    IOReportCopyChannelsInGroup: { args: ['ptr', 'ptr', 'u64', 'u64', 'u64'], returns: 'ptr' },
    IOReportCreateSubscription: { args: ['ptr', 'ptr', 'ptr', 'u64', 'ptr'], returns: 'ptr' },
    IOReportCreateSamples: { args: ['ptr', 'ptr', 'ptr'], returns: 'ptr' },
    IOReportIterate: { args: ['ptr', 'ptr'], returns: 'void' },
    IOReportChannelGetChannelName: { args: ['ptr'], returns: 'ptr' },
    IOReportChannelGetUnitLabel: { args: ['ptr'], returns: 'ptr' },
    IOReportSimpleGetIntegerValue: { args: ['ptr', 'i32'], returns: 'i64' },
  })
}

function cstr(lib: CfLib, p: Pointer | null): string {
  if (!p) return ''
  const buf = Buffer.alloc(128)
  if (!lib.symbols.CFStringGetCString(p, ptr(buf), buf.length, UTF8)) return ''
  const end = buf.indexOf(0)
  return buf.toString('utf8', 0, end < 0 ? buf.length : end)
}

function ensure(): boolean {
  if (unavailable) return false
  if (process.arch !== 'arm64') {
    unavailable = true
    return false
  }
  if (subscription && subscribed && io && cf) return true
  try {
    cf ??= openCf()
    io ??= openIo()
    const buf = Buffer.from('Energy Model\0')
    group = cf.symbols.CFStringCreateWithCString(null, ptr(buf), UTF8)
    const channels = io.symbols.IOReportCopyChannelsInGroup(group, null, 0n, 0n, 0n)
    if (!channels) throw new Error('no Energy Model channels')
    const subOut = new BigUint64Array(1)
    const sub = io.symbols.IOReportCreateSubscription(null, channels, ptr(subOut), 0n, null)
    if (!sub || !subOut[0]) throw new Error('IOReport subscription failed')
    subscription = sub
    // The out-parameter is a raw address. bun accepts it as a pointer at runtime.
    subscribed = subOut[0] as unknown as Pointer
    return true
  } catch {
    unavailable = true
    return false
  }
}

/** Cumulative nanojoules for the four package rails, or null if unavailable. */
export function readEnergy(): EnergyNj | null {
  if (!ensure() || !io || !cf || !subscription || !subscribed) return null
  const found: EnergyNj = {}
  const lib = io
  const core = cf
  const cb = new JSCallback(
    (_block: Pointer, channel: Pointer) => {
      const name = cstr(core, lib.symbols.IOReportChannelGetChannelName(channel))
      const key = CHANNELS[name]
      if (!key) return 0
      const unit = cstr(core, lib.symbols.IOReportChannelGetUnitLabel(channel))
      const raw = lib.symbols.IOReportSimpleGetIntegerValue(channel, 0)
      const nj = toNanojoules(raw, unit)
      if (nj !== null) found[key] = nj
      return 0
    },
    { args: ['ptr', 'ptr'], returns: 'i32' },
  )
  const block = new ArrayBuffer(32)
  const view = new DataView(block)
  const desc = new ArrayBuffer(16)
  new DataView(desc).setBigUint64(8, 32n, true)
  view.setBigUint64(16, BigInt(cb.ptr as number), true)
  view.setBigUint64(24, BigInt(ptr(desc) as number), true)
  try {
    const samples = lib.symbols.IOReportCreateSamples(subscription, subscribed, null)
    if (!samples) return null
    lib.symbols.IOReportIterate(samples, ptr(block))
    core.symbols.CFRelease(samples)
    return Object.keys(found).length > 0 ? found : null
  } catch {
    return null
  } finally {
    cb.close()
  }
}
