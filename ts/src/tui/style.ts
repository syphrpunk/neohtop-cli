// Theme colors for the one text buffer. The plain frame stays the source of
// layout, so pointer rows and the tests still see the same characters.

import { bg, bold, fg, StyledText, type TextChunk } from '@opentui/core'
import type { Theme } from './theme.ts'

const LABELS = [
  'CPU',
  'MEM',
  'DSK',
  'thermal',
  'pressure',
  'battery',
  'kernel',
  'charge',
  'render',
  'cores',
  'wired',
  'cache',
  'swap',
  'vram',
  'host',
  'load',
  'chip',
  'free',
  'comp',
  'read',
  'write',
  'merge',
  'state',
  'procs',
  'dram',
  'size',
  'gpu',
  'cpu',
  'ane',
  'app',
  'rx',
  'tx',
  'in',
  'out',
  'cmp',
  'dec',
  'lat',
  'iops',
  'tiler',
  'mem',
  'io',
  'up',
  'os',
]

export function styleFrame(text: string, theme: Theme): StyledText {
  const lines = text.split('\n')
  const chunks: TextChunk[] = []
  lines.forEach((line, index) => {
    if (index > 0) chunks.push(fg(theme.text)('\n'))
    chunks.push(...styleLine(line, theme).chunks)
  })
  return new StyledText(chunks)
}

function styleLine(line: string, theme: Theme): StyledText {
  if (line.startsWith('sloppytop')) return colorTitle(line, theme)
  if (line.startsWith('╭') || line.startsWith('╰')) return colorBand(line, theme)
  if (line.startsWith('│')) return colorBoxed(line, theme)
  if (isHairline(line)) return new StyledText([fg(theme.surface2)(line)])
  if (line.startsWith('>') || line.startsWith('>*')) return new StyledText([bold(bg(theme.surface1)(fg(theme.text)(line)))])
  if (line.startsWith('* ')) return new StyledText([fg(theme.lavender)(line)])
  if (/^\s+PID/.test(line)) return new StyledText([bold(fg(theme.overlay1)(line))])
  if (line.includes('q quit')) return colorToolbar(line, theme)
  if (isFooter(line)) return colorFooter(line, theme)
  return colorLabels(line, theme)
}

function colorTitle(line: string, theme: Theme): StyledText {
  const mark = 'sloppytop'
  return new StyledText([bold(fg(theme.purple)(mark)), fg(theme.pink)(line.slice(mark.length))])
}

function colorBand(line: string, theme: Theme): StyledText {
  const chunks: TextChunk[] = []
  const titles = /╭─ (.+?) (?=─)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = titles.exec(line))) {
    const title = match[1] ?? ''
    const titleAt = match.index + 3
    if (titleAt > last) chunks.push(fg(theme.surface2)(line.slice(last, titleAt)))
    chunks.push(bold(fg(accentFor(title, theme))(title)))
    last = titleAt + title.length
  }
  if (last < line.length) chunks.push(fg(theme.surface2)(line.slice(last)))
  if (chunks.length === 0) chunks.push(fg(theme.surface2)(line))
  return new StyledText(chunks)
}

function colorBoxed(line: string, theme: Theme): StyledText {
  const chunks: TextChunk[] = []
  const parts = line.split('│')
  parts.forEach((part, index) => {
    if (index > 0) chunks.push(fg(theme.surface2)('│'))
    if (part) chunks.push(...colorLabels(part, theme).chunks)
  })
  return new StyledText(chunks)
}

function colorToolbar(line: string, theme: Theme): StyledText {
  const chunks: TextChunk[] = []
  const groups = line.split('   ')
  groups.forEach((group, index) => {
    if (index > 0) chunks.push(fg(theme.surface2)('   '))
    if (group === 'FROZEN') {
      chunks.push(bold(fg(theme.peach)(group)))
      return
    }
    const hint = /^(\S+)(\s+)(\S.*)$/.exec(group)
    if (hint?.[1] && hint[2] && hint[3] && hint[1] !== 'FROZEN') {
      chunks.push(bold(fg(theme.lavender)(hint[1])))
      chunks.push(fg(theme.surface2)(hint[2]))
      chunks.push(fg(theme.subtext0)(hint[3]))
      return
    }
    chunks.push(fg(theme.subtext0)(group))
  })
  return new StyledText(chunks)
}

function colorFooter(line: string, theme: Theme): StyledText {
  const pid = line.indexOf('PID ')
  if (pid < 0) return new StyledText([fg(theme.subtext0)(line)])
  return new StyledText([fg(theme.subtext0)(line.slice(0, pid)), bold(fg(theme.lavender)(line.slice(pid)))])
}

function colorLabels(line: string, theme: Theme): StyledText {
  const chunks: TextChunk[] = []
  const re = new RegExp(`(?:^|(?<=^ )|(?<=  ))(${LABELS.join('|')})(?=\\s{2}|$)`, 'g')
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(line))) {
    const label = match[1] ?? ''
    if (match.index > last) chunks.push(fg(theme.text)(line.slice(last, match.index)))
    chunks.push(bold(fg(labelColor(label, theme))(label)))
    last = match.index + label.length
    if (label === 'CPU' || label === 'gpu' || label === 'render' || label === 'tiler' || label === 'charge' || label === 'cpu' || label === 'io' || label === 'mem') {
      const reading = /^(\s+)(\d+(?:\.\d+)?%)/.exec(line.slice(last))
      if (reading?.[1] && reading?.[2]) {
        chunks.push(fg(theme.text)(reading[1]))
        chunks.push(bold(fg(usageColor(Number(reading[2]), theme))(reading[2])))
        last += reading[1].length + reading[2].length
      }
    }
    if (label === 'thermal') {
      const reading = /^  (nominal|fair|serious|critical)/.exec(line.slice(last))
      if (reading?.[1]) {
        chunks.push(fg(theme.text)('  '))
        chunks.push(bold(fg(thermalColor(reading[1], theme))(reading[1])))
        last += reading[0].length
      }
    }
  }
  if (last < line.length) chunks.push(fg(theme.text)(line.slice(last)))
  if (chunks.length === 0) chunks.push(fg(theme.text)(line))
  return new StyledText(chunks)
}

function isHairline(line: string): boolean {
  return line.length > 0 && [...line].every((char) => char === '─')
}

function isFooter(line: string): boolean {
  return line.includes(' · ') || line.endsWith(' processes') || line.endsWith('processes off')
}

function accentFor(title: string, theme: Theme): string {
  if (title === 'cpu' || title === 'system') return theme.green
  if (title === 'mem') return theme.blue
  if (title === 'disk') return theme.yellow
  if (title === 'net' || title === 'host') return theme.peach
  if (title === 'power' || title === 'sensors') return theme.maroon
  if (title === 'gpu') return theme.sapphire
  if (title === 'pressure') return theme.yellow
  if (title === 'battery') return theme.teal
  if (title === 'swap') return theme.lavender
  if (title === 'kill') return theme.red
  return theme.lavender
}

function labelColor(label: string, theme: Theme): string {
  switch (label) {
    case 'CPU':
    case 'cores':
      return theme.green
    case 'MEM':
    case 'mem':
    case 'pages':
      return theme.blue
    case 'DSK':
    case 'read':
    case 'write':
    case 'iops':
      return theme.yellow
    case 'rx':
    case 'tx':
    case 'host':
    case 'load':
    case 'up':
    case 'os':
    case 'kernel':
    case 'procs':
    case 'chip':
      return theme.peach
    case 'cpu':
    case 'gpu':
    case 'ane':
    case 'dram':
    case 'render':
    case 'tiler':
    case 'vram':
      return theme.maroon
    case 'thermal':
    case 'pressure':
    case 'io':
      return theme.yellow
    case 'charge':
    case 'state':
    case 'battery':
      return theme.teal
    case 'swap':
    case 'wired':
    case 'comp':
    case 'app':
    case 'cache':
    case 'free':
    case 'in':
    case 'out':
    case 'cmp':
    case 'dec':
      return theme.blue
    default:
      return theme.text
  }
}

function usageColor(percent: number, theme: Theme): string {
  if (!Number.isFinite(percent)) return theme.text
  if (percent >= 90) return theme.red
  if (percent >= 70) return theme.peach
  if (percent >= 40) return theme.yellow
  return theme.green
}

function thermalColor(state: string, theme: Theme): string {
  if (state === 'critical') return theme.red
  if (state === 'serious') return theme.peach
  if (state === 'fair') return theme.yellow
  return theme.green
}
