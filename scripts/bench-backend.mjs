import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { cpus, totalmem, platform, release, hostname } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const projectId = 'demo-oi-benchmark'
const organizationId = 'benchmark'
const ports = { api: 18787, auth: 39099, firestore: 38080, websocket: 39150, hub: 39400, logging: 39500 }
const profiles = [{ cpus: 1, memoryMiB: 512 }, { cpus: 2, memoryMiB: 1024 }]
const estimate = { organizationId, materialName: 'PLA', process: 'FDM', dimensionsMm: [20, 20, 20], plannedHours: 4 }
let origin

export function summarize(samples, seconds) {
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b)
  const percentile = (p) => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null
  const statuses = {}
  for (const sample of samples) statuses[sample.status] = (statuses[sample.status] || 0) + 1
  const errors = samples.filter((sample) => sample.status !== '200' || !sample.valid).length
  return { requests: samples.length, errors, timeouts: statuses.timeout || 0, statuses,
    invalidResponses: samples.filter((sample) => sample.status === '200' && !sample.valid).length,
    authErrors: (statuses['401'] || 0) + (statuses['403'] || 0),
    requestsPerSecond: samples.length / seconds, successfulRequestsPerSecond: (samples.length - errors) / seconds,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), p99LowSample: samples.length < 1000 }
}

export async function requireFreePorts(host = '0.0.0.0', values = Object.values(ports)) {
  for (const port of values) {
    const server = createServer()
    await new Promise((ok, fail) => {
      server.once('error', (error) => fail(new Error(`Port ${host}:${port} unavailable: ${error.message}`)))
      server.listen({ host, port, exclusive: true }, ok)
    })
    await new Promise((ok) => server.close(ok))
  }
}

export function businessEndpoint(sequence) {
  return sequence % 5 === 4 ? 'quote' : 'leadTime'
}

async function command(binary, args, options = {}) {
  const result = await exec(binary, args, { cwd: root, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...options })
  return result.stdout.trim()
}
const docker = (...args) => command('docker', args)
const dockerLogs = async (name) => {
  const result = await exec('docker', ['logs', name], { maxBuffer: 32 * 1024 * 1024, timeout: 10_000 })
  return result.stdout + result.stderr
}

async function waitFor(check, label, signal, timeout = 90_000) {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    signal.throwIfAborted()
    if (await check()) return
    await delay(100, undefined, { signal })
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function request(endpoint, token, client, sequence) {
  const start = performance.now()
  let status = 'network-error'
  let valid = false
  const quoteTotal = 100_000 + sequence
  try {
    const health = endpoint === 'health'
    const response = await fetch(`${origin}${health ? '/health' : endpoint === 'leadTime' ? '/api/production/lead-time' : `/api/rfqs/rfq-${client}/quote`}`, {
      method: health ? 'GET' : endpoint === 'quote' ? 'PUT' : 'POST',
      headers: health ? {} : { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(health ? {} : { body: JSON.stringify(endpoint === 'quote' ? { quoteTotal } : estimate) }),
      signal: AbortSignal.timeout(10_000),
    })
    status = String(response.status)
    const body = await response.json()
    valid = response.ok && (endpoint === 'leadTime' ? body.leadTimeDays === 1 : body.ok === true)
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') status = 'timeout'
  }
  return { ms: performance.now() - start, status, valid, quoteTotal }
}

export async function load({ concurrency, durationMs, health, token, expectedQuotes, signal, requester = request }) {
  const samples = { health: [], leadTime: [], quote: [] }
  const start = performance.now()
  const deadline = start + durationMs
  await Promise.all(Array.from({ length: concurrency }, async (_, client) => {
    let sequence = 0
    while (performance.now() < deadline && !signal.aborted) {
      const endpoint = health ? 'health' : businessEndpoint(sequence)
      const sample = await requester(endpoint, token, client, sequence++)
      samples[endpoint].push(sample)
      if (endpoint === 'quote' && sample.valid) expectedQuotes.set(client, sample.quoteTotal)
    }
  }))
  signal.throwIfAborted()
  const seconds = (performance.now() - start) / 1000
  return { seconds, endpoints: Object.fromEntries(Object.entries(samples).filter(([, values]) => values.length).map(([key, values]) => [key, summarize(values, seconds)])) }
}

async function stopChild(child) {
  if (!child?.pid) return
  const exited = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve() : new Promise((ok) => child.once('exit', ok))
  try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
  await Promise.race([exited, delay(5000)])
  // Firebase's Java child can outlive the CLI process; clean the whole owned group.
  try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  await exited
}

export function analyzeReport(report) {
  report.comparisons = profiles.flatMap((profile) => [1, 5, 10].map((concurrency) => {
    const runs = report.runs.filter((run) => run.profile.cpus === profile.cpus && run.concurrency === concurrency)
    const rates = runs.map((run) => run.endpoints.leadTime.requestsPerSecond + run.endpoints.quote.requestsPerSecond)
    assert.equal(rates.length, 2, 'Two measured repeats required')
    const meanRps = rates.reduce((a, b) => a + b, 0) / rates.length
    return { profile, concurrency, meanRps, minRps: Math.min(...rates), maxRps: Math.max(...rates), spreadPercent: (Math.max(...rates) - Math.min(...rates)) / meanRps * 100 }
  }))
  report.profileRatio = report.comparisons.find((item) => item.profile.cpus === 2 && item.concurrency === 10).meanRps / report.comparisons.find((item) => item.profile.cpus === 1 && item.concurrency === 10).meanRps
  report.saturation = profiles.map((profile) => {
    const five = report.comparisons.find((item) => item.profile.cpus === profile.cpus && item.concurrency === 5)
    const ten = report.comparisons.find((item) => item.profile.cpus === profile.cpus && item.concurrency === 10)
    const stats = report.containers.filter((item) => item.profile.cpus === profile.cpus).flatMap((item) => item.stats).filter((item) => item.stage?.workload === 'business' && item.stage.concurrency === 10)
    const meanCpuPercent = stats.length ? stats.reduce((total, item) => total + parseFloat(item.CPUPerc), 0) / stats.length : null
    const throughputGain = ten.meanRps / five.meanRps
    const possiblePlateau = throughputGain < 1.1
    const possibleCpuSaturation = possiblePlateau && meanCpuPercent >= profile.cpus * 85
    return { profile, throughputGainFromFiveToTen: throughputGain, meanCpuPercent, possiblePlateau, possibleCpuSaturation, conclusion: possibleCpuSaturation ? 'indikasi jenuh CPU lokal' : 'batas belum ditemukan' }
  })
  // shortcut: C<=10 cannot establish a hard ceiling; use an open-loop sweep to locate it.
  report.conclusion = report.saturation.some((item) => item.possibleCpuSaturation)
    ? 'indikasi jenuh CPU lokal (kenaikan throughput C=5 ke C=10 <10% dan CPU rata-rata ≥85% kuota); batas pasti belum ditentukan'
    : report.saturation.some((item) => item.possiblePlateau)
      ? 'batas belum ditemukan untuk backend; throughput mendatar (<10% kenaikan C=5 ke C=10), bottleneck emulator/host perlu diperiksa'
      : 'batas belum ditemukan; concurrency maksimum yang diuji adalah 10, bukan batas kapasitas'
  return report
}

export function reportMarkdown(report) {
  const lines = ['# Benchmark backend lokal', '', `Run: ${report.runId}; status: ${report.status}.`, '',
    'Satu instance production; beban bisnis 80% lead time / 20% quotation per klien, tanpa jeda. Concurrency 1 → 5 → 10, dua ulangan; 5 detik pemanasan + 30 detik pengukuran. Baseline HTTP terpisah 5 detik per tahap agar putaran selesai sekitar 8–10 menit. Request yang masih berjalan ditunggu (maksimum timeout 10 detik); denominator throughput mencakup drain.', '',
    'Latency mencakup seluruh percobaan, termasuk error/timeout. p99 bertanda * memiliki <1.000 sampel. CPU Docker: 100% = satu core; memori adalah working set yang dilaporkan Docker. Sampling periodik (timestamp tersedia di JSON) dan tidak termasuk emulator.', '',
    '| CPU / MiB | Ulangan | Concurrency | Endpoint | Request | req/s | p50 ms | p95 ms | p99 ms | Error / timeout |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---:|']
  const fixed = (value) => value == null ? '—' : value.toFixed(2)
  for (const run of report.runs) for (const [endpoint, result] of Object.entries(run.endpoints)) {
    lines.push(`| ${run.profile.cpus} / ${run.profile.memoryMiB} | ${run.repeat} | ${run.concurrency} | ${endpoint} | ${result.requests} | ${fixed(result.requestsPerSecond)} | ${fixed(result.p50Ms)} | ${fixed(result.p95Ms)} | ${fixed(result.p99Ms)}${result.p99LowSample ? '*' : ''} | ${result.errors} / ${result.timeouts} |`)
  }
  const statuses = [...new Set(report.runs.flatMap((run) => Object.values(run.endpoints).flatMap((result) => Object.keys(result.statuses))))]
  lines.push('', `Status yang teramati: ${statuses.join(', ') || 'belum ada'}. Rincian jumlah status per endpoint tersedia di JSON.`, '', '## Perbandingan dan variasi', '')
  for (const comparison of report.comparisons || []) lines.push(`- ${comparison.profile.cpus} CPU / ${comparison.profile.memoryMiB} MiB, C=${comparison.concurrency}: bisnis ${fixed(comparison.meanRps)} req/s; rentang dua ulangan ${fixed(comparison.minRps)}–${fixed(comparison.maxRps)} (${fixed(comparison.spreadPercent)}%).`)
  for (const item of report.saturation || []) lines.push(`- ${item.profile.cpus} CPU: kenaikan throughput C=5 → C=10 ${fixed((item.throughputGainFromFiveToTen - 1) * 100)}%; CPU rata-rata bisnis C=10 ${fixed(item.meanCpuPercent)}%; ${item.conclusion}.`)
  if (report.profileRatio) lines.push(`- Rasio throughput rata-rata profil 2 CPU terhadap 1 CPU pada C=10: ${fixed(report.profileRatio)}×.`)
  lines.push('', '## Startup lokal dan sumber daya', '', '| CPU / MiB | Percobaan | Container → health ms | Bisnis pertama ms | CPU maksimum % | Memori maksimum | Restart | OOM |', '|---|---|---:|---:|---:|---|---:|---|')
  for (const run of report.containers) lines.push(`| ${run.profile.cpus} / ${run.profile.memoryMiB} | ${run.trial} | ${fixed(run.startupMs)} | ${fixed(run.firstBusinessMs)} | ${fixed(run.stats.length ? Math.max(...run.stats.map((s) => parseFloat(s.CPUPerc))) : null)} | ${run.peakMemory || '—'} | ${run.restartCount ?? '—'} | ${run.oomKilled ?? '—'} |`)
  lines.push('', `Kesimpulan: ${report.conclusion || 'pengukuran belum lengkap'}.`, '', `Verifikasi: ${JSON.stringify(report.verification || {})}`, '',
    'Efek internal quotation tetap dijalankan. Pada implementasi saat ini perubahan quotation tidak membuat notifikasi manufacturer; email dilewati karena kredensial kosong. Log diperiksa untuk kegagalan efek yang ditelan API.', '',
    '## Mesin dan image', '', '```json', JSON.stringify(report.machine, null, 2), '```', '',
    '## Batas interpretasi', '',
    'Beban adalah closed loop, sehingga antrean dan coordinated omission dapat membuat latency tampak lebih rendah dibanding trafik open loop. Rasio 80/20 mendekati target karena siklus terakhir setiap klien dapat terpotong. Emulator dan generator beban berbagi host; layanan lain yang berjalan dapat memengaruhi variasi. Hasil membatasi CPU/RAM backend, bukan emulator.', '',
    'Startup lokal mencakup docker run hingga health siap, kemudian request lead time pertama; bukan cold start Cloud Run. Tidak mencakup autoscaling atau jaringan antarregion. [Cloud Run lokal](https://docs.cloud.google.com/run/docs/testing/local).', '',
    'Transaksi, indeks, dan batas Firebase Emulator berbeda dari production. [Perbedaan emulator Firestore](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_emulator_differs_from_production). UI, slicer, dan latensi AI/provider dilewati. Angka bukan kapasitas Firebase production atau jumlah pengguna nyata.', '',
    ...(report.failure ? [`Kegagalan: ${report.failure}`, ''] : []))
  return lines.join('\n')
}

export async function main() {
  assert.equal(platform(), 'linux', 'Runner ini memerlukan Docker Linux (emulator terikat gateway network internal).')
  const runId = new Date().toISOString().replaceAll(/[:.]/g, '-')
  const directory = resolve(root, '.local/benchmarks/backend', runId)
  await mkdir(directory, { recursive: true })
  const network = `oi-bench-${runId.toLowerCase()}`
  const image = `oi-backend-bench:${runId.toLowerCase()}`
  const controller = new AbortController()
  const signal = controller.signal
  const interrupt = () => controller.abort(new Error('Benchmark interrupted'))
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', interrupt)
  const report = { runId, status: 'running', runs: [], containers: [], machine: {}, verification: { responsesCorrect: false, quotesPersisted: false, noAuthErrors: false, noEffectFailures: false } }
  let emulator, emulatorLog, db, adminApp, networkCreated = false, activeContainer
  const expectedQuotes = new Map()
  let token
  let failure
  const save = async () => {
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2))
    await writeFile(resolve(directory, 'report.md'), reportMarkdown(report))
  }
  async function finishContainer(record) {
    const logs = await dockerLogs(record.name)
    await writeFile(resolve(directory, `${record.name}.log`), logs)
    record.effectFailures = /RFQ follow-up effect failed|API request failed/.test(logs)
    const [inspect] = JSON.parse(await docker('inspect', record.name))
    record.restartCount = inspect.RestartCount
    record.oomKilled = inspect.State.OOMKilled
    record.state = inspect.State
    assert.equal(record.effectFailures, false, 'Backend logged internal/effect failures')
    assert.equal(record.oomKilled, false, 'Container OOM')
    assert.equal(record.restartCount, 0, 'Container restarted')
    assert.equal(inspect.State.Running, true, 'Container stopped unexpectedly')
    await docker('rm', '-f', record.name)
    activeContainer = undefined
  }
  async function startContainer(profile, trial) {
    signal.throwIfAborted()
    await requireFreePorts('0.0.0.0', [ports.api])
    const name = `oi-bench-api-${runId.toLowerCase()}-${profile.cpus}-${trial}`
    activeContainer = name
    const record = { name, profile, trial, stats: [] }
    report.containers.push(record)
    const started = performance.now()
    await docker('run', '-d', '--name', name, '--network', network,
      '--cpus', String(profile.cpus), '--memory', `${profile.memoryMiB}m`, '--memory-swap', `${profile.memoryMiB}m`,
      '-e', `PORT=${ports.api}`, '-e', `FIREBASE_PROJECT_ID=${projectId}`,
      '-e', `GCLOUD_PROJECT=${projectId}`, '-e', 'METADATA_SERVER_DETECTION=none',
      '-e', `FIRESTORE_EMULATOR_HOST=${report.gateway}:${ports.firestore}`,
      '-e', `FIREBASE_AUTH_EMULATOR_HOST=${report.gateway}:${ports.auth}`,
      '-e', 'R2_LOCAL_WORKER_URL=http://127.0.0.1:1', image)
    const [container] = JSON.parse(await docker('inspect', name))
    origin = `http://${container.NetworkSettings.Networks[network].IPAddress}:${ports.api}`
    record.apiOrigin = origin
    await waitFor(async () => {
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) })
        return response.ok && (await response.json()).ok === true
      } catch { return false }
    }, 'backend health', signal)
    record.startupMs = performance.now() - started
    const first = await request('leadTime', token, 0, 0)
    assert.equal(first.valid, true, `First business request failed: ${JSON.stringify(first)}`)
    record.firstBusinessMs = first.ms
    return record
  }
  async function verifyQuotes() {
    for (const [client, quoteTotal] of expectedQuotes) {
      const data = (await db.doc(`rfqs/rfq-${client}`).get()).data()
      assert.equal(data.quoteTotal, quoteTotal, `Last quotation mismatch for client ${client}`)
      assert.equal(data.status, 'Quoted')
      assert.equal(data.paymentStatus, 'Unpaid')
    }
  }
  try {
    await requireFreePorts()
    const info = JSON.parse(await docker('info', '--format', '{{json .}}'))
    assert.ok(info.MemoryLimit && info.CpuCfsQuota, 'Docker CPU/memory limits unavailable')
    report.machine = { hostname: hostname(), platform: platform(), kernel: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(), node: process.version, docker: info.ServerVersion, dockerCpus: info.NCPU, dockerMemoryBytes: info.MemTotal,
      gitHead: await command('git', ['rev-parse', 'HEAD']), gitStatus: await command('git', ['status', '--short']), image, dockerfile: 'apps/server/Dockerfile' }
    console.log(`[bench] ${directory}\n[bench] Building production image (setup)…`)
    await command('docker', ['build', '-f', 'apps/server/Dockerfile', '-t', image, '.'], { timeout: 600_000 }).then((out) => writeFile(resolve(directory, 'build.log'), out))
    report.machine.imageInspect = JSON.parse(await docker('image', 'inspect', image))[0]
    await docker('network', 'create', '--internal', network)
    networkCreated = true
    const [net] = JSON.parse(await docker('network', 'inspect', network))
    assert.equal(net.Internal, true, 'Network must block external routing')
    report.network = { name: network, internal: net.Internal }
    const gateway = net.IPAM.Config[0].Gateway
    report.gateway = gateway
    await requireFreePorts(gateway, Object.values(ports).filter((port) => port !== ports.api))
    const config = { emulators: { auth: { host: gateway, port: ports.auth }, firestore: { host: gateway, port: ports.firestore, websocketPort: ports.websocket }, hub: { host: gateway, port: ports.hub }, logging: { host: gateway, port: ports.logging }, ui: { enabled: false }, singleProjectMode: true } }
    const configPath = resolve(directory, 'firebase.json')
    await writeFile(configPath, JSON.stringify(config))
    const env = Object.fromEntries(['PATH', 'HOME', 'JAVA_HOME', 'XDG_CACHE_HOME'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]))
    emulatorLog = createWriteStream(resolve(directory, 'emulators.log'))
    emulator = spawn(resolve(root, 'node_modules/.bin/firebase'), ['emulators:start', '--only', 'auth,firestore', '--project', projectId, '--config', configPath], { cwd: directory, env: { ...env, CI: 'true', FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true', JAVA_TOOL_OPTIONS: '-Xmx1g' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let emulatorError
    emulator.on('error', (error) => { emulatorError = error })
    emulator.stdout.pipe(emulatorLog, { end: false })
    emulator.stderr.pipe(emulatorLog, { end: false })
    await waitFor(async () => {
      if (emulatorError) throw emulatorError
      if (emulator.exitCode !== null) throw new Error('Firebase emulator stopped; see emulators.log')
      try {
        const results = await Promise.all([fetch(`http://${gateway}:${ports.auth}/`, { signal: AbortSignal.timeout(500) }), fetch(`http://${gateway}:${ports.firestore}/`, { signal: AbortSignal.timeout(500) })])
        await Promise.all(results.map((response) => response.text()))
        return true
      } catch { return false }
    }, 'isolated Firebase emulators', signal)
    Object.assign(process.env, { FIRESTORE_EMULATOR_HOST: `${gateway}:${ports.firestore}`, FIREBASE_AUTH_EMULATOR_HOST: `${gateway}:${ports.auth}`, GCLOUD_PROJECT: projectId, GOOGLE_CLOUD_PROJECT: projectId, METADATA_SERVER_DETECTION: 'none' })
    const { initializeApp } = await import('firebase-admin/app')
    const { getFirestore } = await import('firebase-admin/firestore')
    adminApp = initializeApp({ projectId }, `bench-${runId}`)
    db = getFirestore(adminApp)
    // No application env files or cloud credentials are loaded by this runner.
    const response = await fetch(`http://${gateway}:${ports.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'benchmark@example.test', password: 'benchmark-only-password', returnSecureToken: true }), signal: AbortSignal.timeout(10_000) })
    assert.equal(response.ok, true, 'Emulator signup failed')
    const user = await response.json()
    token = user.idToken
    assert.ok(token && user.localId, 'Emulator signup missing token/uid')
    const batch = db.batch()
    batch.set(db.doc(`organizations/${organizationId}`), { active: true, acceptingRequests: true, name: 'Synthetic benchmark' })
    batch.set(db.doc(`manufacturers/${user.localId}`), { active: true, organizationId, role: 'owner' })
    for (let i = 0; i < 20; i++) batch.set(db.doc(`materials/material-${i}`), { organizationId, name: i === 0 ? 'PLA' : `Synthetic ${i}`, stock: 100, reserved: 0 })
    for (let i = 0; i < 10; i++) batch.set(db.doc(`equipment/machine-${i}`), { organizationId, name: `Machine ${i}`, technology: 'FDM', status: 'Available', workingHours: 8, scheduledHours: i * 8, buildVolumeMm: [250, 250, 250], compatibleMaterialIds: ['material-0'] })
    for (let i = 0; i < 100; i++) batch.set(db.doc(`rfqs/rfq-${i}`), { organizationId, ownerUid: user.localId, product: `Synthetic ${i}`, customer: { name: 'Benchmark', email: 'benchmark@example.test' }, requirements: { quantity: 1, material: 'PLA' }, status: 'Submitted', paymentStatus: 'Unpaid', createdAt: Date.now() })
    await batch.commit()
    for (const [collection, count] of [['materials', 20], ['equipment', 10], ['rfqs', 100]]) assert.equal((await db.collection(collection).get()).size, count)
    report.seed = { organizations: 1, materials: 20, equipment: 10, rfqs: 100 }
    console.log('[bench] Setup ready. Measuring both profiles (~8–10 minutes)…')
    for (const profile of profiles) {
      for (let trial = 1; trial <= 3; trial++) {
        const record = await startContainer(profile, trial)
        console.log(`[bench] ${profile.cpus} CPU / ${profile.memoryMiB} MiB startup ${trial}: ${record.startupMs.toFixed(0)} ms, first business ${record.firstBusinessMs.toFixed(0)} ms`)
        if (trial === 3) {
          let sampling = true
          const sampler = (async () => {
            while (sampling && !signal.aborted) {
              try {
                const sample = JSON.parse(await docker('stats', '--no-stream', '--format', '{{json .}}', record.name))
                record.stats.push({ at: new Date().toISOString(), stage: record.currentStage, ...sample })
              } catch (error) { record.statsError = error.message }
              if (sampling) await delay(1000)
            }
          })()
          try {
            for (let repeat = 1; repeat <= 2; repeat++) for (const concurrency of [1, 5, 10]) {
              console.log(`[bench] ${profile.cpus} CPU, repeat ${repeat}, concurrency ${concurrency}`)
              record.currentStage = { repeat, concurrency, workload: 'health' }
              const health = await load({ concurrency, durationMs: 5000, health: true, token, expectedQuotes, signal })
              record.currentStage = { repeat, concurrency, workload: 'warmup' }
              await load({ concurrency, durationMs: 5000, health: false, token, expectedQuotes, signal }).then((warm) => {
                for (const result of Object.values(warm.endpoints)) assert.equal(result.errors, 0, 'Warmup failed')
              })
              record.currentStage = { repeat, concurrency, workload: 'business' }
              const measured = await load({ concurrency, durationMs: 30_000, health: false, token, expectedQuotes, signal })
              await verifyQuotes()
              report.runs.push({ profile, repeat, concurrency, healthSeconds: health.seconds, businessSeconds: measured.seconds, endpoints: { ...health.endpoints, ...measured.endpoints } })
              await save()
            }
          } finally { sampling = false; await sampler }
          assert.ok(record.stats.length, 'No Docker resource samples')
          assert.ok(!record.statsError, record.statsError)
          const memoryBytes = (value) => {
            const [, number, unit] = value.match(/^([\d.]+)(\w+)/) || []
            return Number(number) * ({ B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[unit] || 1)
          }
          record.peakMemory = record.stats.map((s) => s.MemUsage.split(' / ')[0]).sort((a, b) => memoryBytes(b) - memoryBytes(a))[0]
        }
        await finishContainer(record)
      }
    }
    await verifyQuotes()
    const results = report.runs.flatMap((run) => Object.values(run.endpoints))
    report.verification = { responsesCorrect: results.every((result) => result.errors === 0), quotesPersisted: true, noAuthErrors: results.every((result) => result.authErrors === 0), noEffectFailures: report.containers.every((record) => !record.effectFailures) }
    assert.ok(Object.values(report.verification).every(Boolean), 'Response/auth verification failed; results invalid')
    analyzeReport(report)
    report.status = 'complete'
  } catch (error) {
    failure = error
    report.status = 'failed'
    report.failure = error.stack || String(error)
    report.conclusion = 'hasil tidak lengkap/valid; kapasitas tidak dapat disimpulkan'
  } finally {
    const cleanupErrors = []
    if (activeContainer) {
      try {
        const logs = await dockerLogs(activeContainer)
        await writeFile(resolve(directory, `${activeContainer}.log`), logs)
      } catch (error) { cleanupErrors.push(error.message) }
      try {
        const [container] = JSON.parse(await docker('inspect', activeContainer))
        const record = report.containers.find((item) => item.name === activeContainer)
        if (record) Object.assign(record, { state: container.State, restartCount: container.RestartCount, oomKilled: container.State.OOMKilled })
      } catch (error) { cleanupErrors.push(error.message) }
      try { await docker('rm', '-f', activeContainer) } catch (error) { cleanupErrors.push(error.message) }
    }
    if (adminApp) {
      try { const { deleteApp } = await import('firebase-admin/app'); await deleteApp(adminApp) } catch (error) { cleanupErrors.push(error.message) }
    }
    try { await stopChild(emulator) } catch (error) { cleanupErrors.push(error.message) }
    emulatorLog?.end()
    if (networkCreated) {
      try { await docker('network', 'rm', network) } catch (error) { cleanupErrors.push(error.message) }
    }
    report.cleanupErrors = cleanupErrors
    if (cleanupErrors.length) { report.status = 'failed'; failure ||= new Error(cleanupErrors.join('\n')) }
    report.finishedAt = new Date().toISOString()
    await save()
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
    console.log(`[bench] ${report.status}: ${resolve(directory, 'report.md')}`)
  }
  if (failure) throw failure
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.stack || error); process.exitCode = 1 })
}
