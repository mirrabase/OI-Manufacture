import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { summarize, businessEndpoint, requireFreePorts, load, analyzeReport, reportMarkdown } from './bench-backend.mjs'

test('summary includes failures, timeout, auth errors and low-sample p99', () => {
  const summary = summarize([
    { ms: 1, status: '200', valid: true },
    { ms: 2, status: '200', valid: false },
    { ms: 3, status: '401', valid: false },
    { ms: 10_000, status: 'timeout', valid: false },
  ], 2)
  assert.equal(summary.p50Ms, 2)
  assert.equal(summary.p95Ms, 10_000)
  assert.equal(summary.errors, 3)
  assert.equal(summary.invalidResponses, 1)
  assert.equal(summary.authErrors, 1)
  assert.equal(summary.timeouts, 1)
  assert.equal(summary.requestsPerSecond, 2)
  assert.equal(summary.successfulRequestsPerSecond, 0.5)
  assert.equal(summary.p99LowSample, true)
  assert.equal(summarize([], 1).p50Ms, null)
  assert.equal(summarize(Array.from({ length: 1000 }, () => ({ ms: 1, status: '200', valid: true })), 1).p99LowSample, false)
})

test('business cycle is exactly 80/20 and clients keep separate quotation state', async () => {
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => businessEndpoint(i)), ['leadTime', 'leadTime', 'leadTime', 'leadTime', 'quote'])
  const active = new Set()
  const sequences = new Map()
  const expectedQuotes = new Map()
  await load({ concurrency: 5, durationMs: 100, health: false, token: '', expectedQuotes, signal: new AbortController().signal,
    requester: async (endpoint, _token, client, sequence) => {
      assert.ok(!active.has(client), 'one sequential request per client')
      active.add(client)
      assert.equal(sequence, (sequences.get(client) ?? -1) + 1)
      sequences.set(client, sequence)
      await delay(1)
      active.delete(client)
      return { ms: 1, status: '200', valid: true, quoteTotal: client * 10000 + sequence }
    },
  })
  assert.equal(expectedQuotes.size, 5)
  for (const [client, total] of expectedQuotes) {
    assert.equal((total - client * 10000) % 5, 4)
    assert.ok(total - client * 10000 <= sequences.get(client))
  }
})

test('occupied ports are rejected without touching their service', async () => {
  const server = createServer()
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const port = server.address().port
  try { await assert.rejects(requireFreePorts(undefined, [port]), /unavailable/) }
  finally { await new Promise((ok) => server.close(ok)) }
  await requireFreePorts('127.0.0.1', [port])
})

test('interruption stops load and propagates failure', async () => {
  const controller = new AbortController()
  controller.abort(new Error('interrupted'))
  await assert.rejects(load({ concurrency: 1, durationMs: 100, health: true, expectedQuotes: new Map(), signal: controller.signal }), /interrupted/)
})


test('report compares both repeats and separates CPU saturation from an unknown ceiling', () => {
  const profiles = [{ cpus: 1, memoryMiB: 512 }, { cpus: 2, memoryMiB: 1024 }]
  const report = { runId: 'test', status: 'complete', machine: {},
    runs: profiles.flatMap((profile) => [1, 2].flatMap((repeat) => [1, 5, 10].map((concurrency) => ({ profile, repeat, concurrency,
      endpoints: { leadTime: summarize(Array.from({ length: concurrency * 4 }, () => ({ ms: 1, status: '200', valid: true })), 1), quote: summarize(Array.from({ length: concurrency }, () => ({ ms: 2, status: '200', valid: true })), 1) },
    })))),
    containers: profiles.map((profile) => ({ profile, stats: [{ stage: { workload: 'business', concurrency: 10 }, CPUPerc: '95%' }] })),
  }
  analyzeReport(report)
  assert.equal(report.comparisons.length, 6)
  assert.equal(report.profileRatio, 1)
  assert.match(report.conclusion, /batas belum ditemukan/)
  assert.equal(report.comparisons[0].spreadPercent, 0)
  for (const run of report.runs.filter((run) => run.concurrency === 10)) {
    run.endpoints.leadTime.requestsPerSecond = 20
    run.endpoints.quote.requestsPerSecond = 5
  }
  analyzeReport(report)
  assert.equal(report.saturation[0].possibleCpuSaturation, true)
  assert.equal(report.saturation[1].possibleCpuSaturation, false)
  assert.equal(report.saturation[1].conclusion, 'batas belum ditemukan')
  assert.match(report.conclusion, /indikasi jenuh CPU lokal/)
  assert.match(reportMarkdown(report), /p99/)
  assert.match(reportMarkdown(report), /Cloud Run/)
})
