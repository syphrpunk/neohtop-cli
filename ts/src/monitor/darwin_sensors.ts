// macOS temperature and thermal state from public APIs.
// Temperature uses IOHIDManager matched to the sensor and power-device usage
// pages, then the cached element value. The consumer page is not opened:
// its fan-speed usage is a linear control, not a tachometer.
// Thermal state is NSProcessInfo.thermalState. A failure omits the reading.

import { dlopen, ptr, type Pointer } from 'bun:ffi'
import {
  acceptsTemperatureElement,
  celsiusReading,
  HID_PAGE_POWER_DEVICE,
  HID_PAGE_SENSOR,
  thermalStateFromInt,
} from './sensors.ts'
import type { TemperatureReading, ThermalState } from './types.ts'

const UTF8 = 0x0800_0100
const SINT32 = 3
const SCALE_PHYSICAL = 1
const GET_WITHOUT_UPDATE = 0x0004_0000
const MAX_DEVICES = 64
const MAX_ELEMENTS = 64

type Libs = {
  objc: ReturnType<typeof openObjc>
  cf: ReturnType<typeof openCf>
  io: ReturnType<typeof openIo>
}

let libs: Libs | null | undefined
let hidUnavailable = false
let thermalUnavailable = false
const selectors = new Map<string, Pointer>()

function openObjc() {
  return dlopen('/usr/lib/libobjc.A.dylib', {
    objc_getClass: { args: ['ptr'], returns: 'ptr' },
    sel_registerName: { args: ['ptr'], returns: 'ptr' },
    objc_msgSend: { args: ['ptr', 'ptr', 'ptr', 'ptr'], returns: 'u64' },
  })
}

function openCf() {
  return dlopen('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation', {
    CFStringCreateWithCString: { args: ['ptr', 'ptr', 'u32'], returns: 'ptr' },
    CFStringGetCString: { args: ['ptr', 'ptr', 'i64', 'u32'], returns: 'u8' },
    CFStringGetTypeID: { args: [], returns: 'u64' },
    CFGetTypeID: { args: ['ptr'], returns: 'u64' },
    CFNumberCreate: { args: ['ptr', 'i32', 'ptr'], returns: 'ptr' },
    CFRelease: { args: ['ptr'], returns: 'void' },
    CFSetGetCount: { args: ['ptr'], returns: 'i64' },
    CFSetGetValues: { args: ['ptr', 'ptr'], returns: 'void' },
    CFArrayGetCount: { args: ['ptr'], returns: 'i64' },
    CFArrayGetValueAtIndex: { args: ['ptr', 'i64'], returns: 'ptr' },
  })
}

function openIo() {
  return dlopen('/System/Library/Frameworks/IOKit.framework/IOKit', {
    IOHIDManagerCreate: { args: ['ptr', 'u32'], returns: 'ptr' },
    IOHIDManagerSetDeviceMatching: { args: ['ptr', 'ptr'], returns: 'void' },
    IOHIDManagerOpen: { args: ['ptr', 'u32'], returns: 'i32' },
    IOHIDManagerClose: { args: ['ptr', 'u32'], returns: 'i32' },
    IOHIDManagerCopyDevices: { args: ['ptr'], returns: 'ptr' },
    IOHIDDeviceCopyMatchingElements: { args: ['ptr', 'ptr', 'u32'], returns: 'ptr' },
    IOHIDDeviceGetProperty: { args: ['ptr', 'ptr'], returns: 'ptr' },
    IOHIDDeviceGetValueWithOptions: { args: ['ptr', 'ptr', 'ptr', 'u32'], returns: 'i32' },
    IOHIDElementGetUsagePage: { args: ['ptr'], returns: 'u32' },
    IOHIDElementGetUsage: { args: ['ptr'], returns: 'u32' },
    IOHIDValueGetScaledValue: { args: ['ptr', 'u32'], returns: 'f64' },
    IOHIDValueGetIntegerValue: { args: ['ptr'], returns: 'i64' },
  })
}

function ensure(): Libs | null {
  if (libs === null) return null
  if (libs) return libs
  try {
    libs = { objc: openObjc(), cf: openCf(), io: openIo() }
    return libs
  } catch {
    libs = null
    hidUnavailable = true
    thermalUnavailable = true
    return null
  }
}

function sel(lib: Libs, name: string): Pointer {
  const cached = selectors.get(name)
  if (cached) return cached
  const buf = Buffer.from(`${name}\0`)
  const value = asPtr(lib.objc.symbols.sel_registerName(ptr(buf)))
  if (!value) throw new Error(`missing selector ${name}`)
  selectors.set(name, value)
  return value
}

function send(lib: Libs, receiver: Pointer | null, name: string, a?: Pointer | null, b?: Pointer | null): bigint {
  if (!receiver) return 0n
  const raw = lib.objc.symbols.objc_msgSend(receiver, sel(lib, name), a ?? null, b ?? null)
  return typeof raw === 'bigint' ? raw : BigInt(raw)
}

function asPtr(value: bigint | number | Pointer | null | undefined): Pointer | null {
  if (value === null || value === undefined || value === 0 || value === 0n) return null
  return value as unknown as Pointer
}

function cfString(lib: Libs, text: string): Pointer | null {
  const buf = Buffer.from(`${text}\0`)
  return asPtr(lib.cf.symbols.CFStringCreateWithCString(null, ptr(buf), UTF8))
}

function cfNumber(lib: Libs, value: number): Pointer | null {
  const buf = new Int32Array([value])
  return asPtr(lib.cf.symbols.CFNumberCreate(null, SINT32, ptr(buf)))
}

function cstr(lib: Libs, value: Pointer): string {
  const buf = Buffer.alloc(256)
  if (!lib.cf.symbols.CFStringGetCString(value, ptr(buf), buf.length, UTF8)) return ''
  const end = buf.indexOf(0)
  return buf.toString('utf8', 0, end < 0 ? buf.length : end)
}

function release(lib: Libs, value: Pointer | null) {
  if (value) lib.cf.symbols.CFRelease(value)
}

/** Cached HID element values on the sensor and power-device pages. Empty means none measured. */
export function readHidTemperatures(): TemperatureReading[] | undefined {
  if (process.platform !== 'darwin' || hidUnavailable) return
  const lib = ensure()
  if (!lib) return
  try {
    const found = scanTemperatures(lib)
    return found.length > 0 ? found : undefined
  } catch {
    hidUnavailable = true
    return
  }
}

function scanTemperatures(lib: Libs): TemperatureReading[] {
  const found: TemperatureReading[] = []
  const seen = new Map<string, number>()
  for (const page of [HID_PAGE_SENSOR, HID_PAGE_POWER_DEVICE]) {
    readPage(lib, page, found, seen)
  }
  return found
}

function readPage(lib: Libs, page: number, found: TemperatureReading[], seen: Map<string, number>) {
  const dict = matching(lib, page)
  const manager = asPtr(lib.io.symbols.IOHIDManagerCreate(null, 0))
  let devices: Pointer | null = null
  try {
    if (!dict || !manager) return
    lib.io.symbols.IOHIDManagerSetDeviceMatching(manager, dict)
    if (lib.io.symbols.IOHIDManagerOpen(manager, 0) !== 0) return
    devices = asPtr(lib.io.symbols.IOHIDManagerCopyDevices(manager))
    if (!devices) return
    const count = exactCount(lib.cf.symbols.CFSetGetCount(devices), MAX_DEVICES)
    if (count === 0) return
    const slots = new BigUint64Array(count)
    lib.cf.symbols.CFSetGetValues(devices, ptr(slots))
    for (const addr of slots) {
      const device = asPtr(addr)
      if (device) readDevice(lib, device, page, found, seen)
    }
  } finally {
    release(lib, devices)
    if (manager) {
      try {
        lib.io.symbols.IOHIDManagerClose(manager, 0)
      } catch {
        // already closed, or open never succeeded
      }
      release(lib, manager)
    }
    release(lib, dict)
  }
}

function matching(lib: Libs, page: number): Pointer | null {
  const cls = asPtr(lib.objc.symbols.objc_getClass(ptr(Buffer.from('NSMutableDictionary\0'))))
  const dict = asPtr(send(lib, asPtr(send(lib, cls, 'alloc')), 'init'))
  const key = cfString(lib, 'PrimaryUsagePage')
  const value = cfNumber(lib, page)
  let keep = false
  try {
    if (!dict || !key || !value) return null
    send(lib, dict, 'setObject:forKey:', value, key)
    keep = true
    return dict
  } finally {
    release(lib, key)
    release(lib, value)
    if (!keep) release(lib, dict)
  }
}

function readDevice(
  lib: Libs,
  device: Pointer,
  page: number,
  found: TemperatureReading[],
  seen: Map<string, number>,
) {
  const elements = asPtr(lib.io.symbols.IOHIDDeviceCopyMatchingElements(device, null, 0))
  if (!elements) return
  try {
    const count = exactCount(lib.cf.symbols.CFArrayGetCount(elements), MAX_ELEMENTS)
    const product = deviceName(lib, device, page === HID_PAGE_POWER_DEVICE ? 'power' : 'sensor')
    for (let i = 0; i < count; i++) {
      const element = asPtr(lib.cf.symbols.CFArrayGetValueAtIndex(elements, i))
      if (!element) continue
      const usagePage = lib.io.symbols.IOHIDElementGetUsagePage(element)
      const usage = lib.io.symbols.IOHIDElementGetUsage(element)
      if (!acceptsTemperatureElement(usagePage, usage)) continue
      const celsius = elementCelsius(lib, device, element)
      if (celsius === undefined) continue
      found.push({ name: uniqueName(product, seen), celsius })
    }
  } finally {
    release(lib, elements)
  }
}

function elementCelsius(lib: Libs, device: Pointer, element: Pointer): number | undefined {
  const slot = new BigUint64Array(1)
  if (lib.io.symbols.IOHIDDeviceGetValueWithOptions(device, element, ptr(slot), GET_WITHOUT_UPDATE) !== 0) {
    return
  }
  const value = asPtr(slot[0])
  if (!value) return
  try {
    const physical = lib.io.symbols.IOHIDValueGetScaledValue(value, SCALE_PHYSICAL)
    const logical = Number(lib.io.symbols.IOHIDValueGetIntegerValue(value))
    return celsiusReading(physical, Number.isSafeInteger(logical) ? logical : undefined)
  } finally {
    release(lib, value)
  }
}

function deviceName(lib: Libs, device: Pointer, fallback: string): string {
  const key = cfString(lib, 'Product')
  try {
    if (!key) return fallback
    const prop = asPtr(lib.io.symbols.IOHIDDeviceGetProperty(device, key))
    if (!prop) return fallback
    if (lib.cf.symbols.CFGetTypeID(prop) !== lib.cf.symbols.CFStringGetTypeID()) return fallback
    const name = cstr(lib, prop).trim()
    return name || fallback
  } finally {
    release(lib, key)
  }
}

function uniqueName(name: string, seen: Map<string, number>): string {
  const n = seen.get(name) ?? 0
  seen.set(name, n + 1)
  return n === 0 ? name : `${name} ${n + 1}`
}

/** 0 means empty or not a safe size. Callers skip that collection instead of truncating it. */
function exactCount(count: number | bigint, max: number): number {
  const n = typeof count === 'bigint' ? Number(count) : count
  if (!Number.isSafeInteger(n) || n < 0 || n > max) return 0
  return n
}

/** `NSProcessInfo.thermalState`. Nominal is a real API result, including on unsupported hardware. */
export function readThermalState(): ThermalState | undefined {
  if (process.platform !== 'darwin' || thermalUnavailable) return
  const lib = ensure()
  if (!lib) return
  try {
    const cls = asPtr(lib.objc.symbols.objc_getClass(ptr(Buffer.from('NSProcessInfo\0'))))
    const info = asPtr(send(lib, cls, 'processInfo'))
    if (!info) return
    const state = Number(send(lib, info, 'thermalState'))
    return thermalStateFromInt(state)
  } catch {
    thermalUnavailable = true
    return
  }
}
