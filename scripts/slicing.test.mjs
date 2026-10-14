import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { calculateEstimate, defaultPricing, validatePricing } from '../apps/web/lib/pricing.ts'
import { parseSlicingSummary, sliceModel } from './slicing.mjs'

test('reads real PrusaSlicer summary units and rejects missing or invalid results', () => {
  assert.deepEqual(parseSlicingSummary('; filament used [g] = 12.76\n; estimated printing time (normal mode) = 1h 21m 25s\n'), { gramsPerUnit: 12.76, secondsPerUnit: 4885 })
  assert.equal(parseSlicingSummary('; filament used [g] = 1\n; estimated printing time (normal mode) = 1d 2h 3m 4s').secondsPerUnit, 93784)
  for (const input of ['', '; filament used [g] = NaN', '; filament used [g] = 1\n; estimated printing time (normal mode) = unknown']) assert.throws(() => parseSlicingSummary(input))
})

test('pricing uses quantity once, setup once, markup on cost, minimum, and IDR rounding', () => {
  assert.equal(calculateEstimate(12.76, 4885, 1, defaultPricing).total, 42_000)
  const estimate = calculateEstimate(100, 3600, 3, defaultPricing)
  assert.deepEqual(estimate, { materialCost: 45_000, machineCost: 45_000, setupCost: 10_000, markup: 30_000, total: 130_000 })
  assert.equal(calculateEstimate(1, 1, 1, defaultPricing).total, 25_000)
  assert.equal(calculateEstimate(100, 3600, 1, { ...defaultPricing, machinePerHour: 30_000 }).total, 72_000)
  for (const quantity of [0, -1, 1.5, Infinity, 100_001]) assert.throws(() => calculateEstimate(1, 1, quantity, defaultPricing))
  assert.throws(() => calculateEstimate(NaN, 1, 1, defaultPricing))
  assert.throws(() => validatePricing({ ...defaultPricing, layerHeight: 0 }))
  assert.throws(() => validatePricing({ ...defaultPricing, materialPerKg: -1 }))
  assert.throws(() => validatePricing({ ...defaultPricing, infillPercent: 101 }))
})

test('stops a stuck slicer instead of leaving a request running indefinitely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oi-timeout-test-'))
  try {
    const fake = join(directory, 'slicer')
    await writeFile(fake, '#!/usr/bin/env node\nsetTimeout(() => {}, 10000)\n', { mode: 0o755 })
    await assert.rejects(sliceModel('unused.stl', join(directory, 'out.gcode'), 'mm', defaultPricing, { binary: fake, timeout: 100 }), /five-minute limit/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('real Benchy slicing and inch conversion', { skip: process.env.RUN_SLICER_INTEGRATION !== '1' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oi-slice-test-'))
  try {
    const result = await sliceModel('apps/web/public/assets/3DBenchy.stl', join(directory, 'benchy.gcode'), 'mm', defaultPricing)
    assert.ok(result.gramsPerUnit > 5 && result.gramsPerUnit < 50)
    assert.ok(result.secondsPerUnit > 600)
    const { STLLoader } = await import('../apps/web/node_modules/three/examples/jsm/loaders/STLLoader.js')
    const { STLExporter } = await import('../apps/web/node_modules/three/examples/jsm/exporters/STLExporter.js')
    const { readFile } = await import('node:fs/promises')
    const THREE = await import('../apps/web/node_modules/three/build/three.module.js')
    const data = await readFile('apps/web/public/assets/3DBenchy.stl')
    const geometry = new STLLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    geometry.scale(1 / 25.4, 1 / 25.4, 1 / 25.4)
    const inch = join(directory, 'inch.stl')
    await writeFile(inch, new STLExporter().parse(new THREE.Mesh(geometry)))
    const converted = await sliceModel(inch, join(directory, 'inch.gcode'), 'inch', defaultPricing)
    assert.ok(Math.abs(converted.gramsPerUnit - result.gramsPerUnit) < 0.1)
    assert.ok(Math.abs(converted.secondsPerUnit - result.secondsPerUnit) < 60)
    const invalid = join(directory, 'invalid.stl')
    await writeFile(invalid, 'not an STL')
    await assert.rejects(sliceModel(invalid, join(directory, 'invalid.gcode'), 'mm', defaultPricing), /Could not slice/)
    geometry.dispose()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
