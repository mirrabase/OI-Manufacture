import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
export const profilePath = fileURLToPath(new URL('./profiles/mk3s-pla.ini', import.meta.url))
const localBinary = fileURLToPath(new URL('../.local/prusa/usr/bin/prusa-slicer', import.meta.url))
const localLibraries = fileURLToPath(new URL('../.local/prusa/usr/lib/x86_64-linux-gnu', import.meta.url))

export function parseSlicingSummary(gcode) {
  const grams = Number(gcode.match(/^;\s*filament used \[g\]\s*=\s*([\d.]+)\s*$/m)?.[1])
  const duration = gcode.match(/^;\s*estimated printing time \(normal mode\)\s*=\s*(.+)$/m)?.[1]
  let seconds = 0
  const factors = { d: 86400, h: 3600, m: 60, s: 1 }
  if (duration && /^(?:\s*\d+(?:\.\d+)?[dhms])+\s*$/.test(duration)) {
    for (const match of duration.matchAll(/(\d+(?:\.\d+)?)([dhms])/g)) seconds += Number(match[1]) * factors[match[2]]
  }
  if (!Number.isFinite(grams) || grams <= 0 || !Number.isFinite(seconds) || seconds <= 0) throw new Error('Slicer did not return valid filament weight and print time.')
  return { gramsPerUnit: grams, secondsPerUnit: seconds }
}

export async function sliceModel(input, output, unit, pricing, { signal, timeout = 300_000, binary = process.env.PRUSA_SLICER_BIN || (existsSync(localBinary) ? localBinary : 'prusa-slicer') } = {}) {
  try {
    await exec(binary, ['--load', profilePath, '--export-gcode', '--output', output,
      '--layer-height', String(pricing.layerHeight), '--fill-density', `${pricing.infillPercent}%`,
      '--scale', unit === 'inch' ? '25.4' : '1', '--center', '125,105', '--threads', '2', input],
    { timeout, signal, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C.UTF-8',
      ...(binary === localBinary ? { LD_LIBRARY_PATH: `${localLibraries}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}` } : {}) } })
  } catch (error) {
    if (error.killed || error.code === 'ABORT_ERR') throw new Error('Slicing stopped or exceeded the five-minute limit.')
    if (error.code === 'ENOENT') throw new Error('PrusaSlicer is not installed. See the local setup instructions in README.')
    console.error('[slicer]', error.stderr || error.message)
    throw new Error('Could not slice this STL with the simulation profile. Manufacturer review is required.')
  }
  if ((await stat(output)).size > 50 * 1024 * 1024) throw new Error('Generated preview exceeds the 50 MB limit.')
  return parseSlicingSummary(await readFile(output, 'utf8'))
}
