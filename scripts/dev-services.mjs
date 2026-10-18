import { spawn } from 'node:child_process'
import { writeFile, rm } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'

const pidFile = process.env.OI_DEV_SERVICES_PID_FILE
if (pidFile) await writeFile(pidFile, String(process.pid))

const options = { stdio: 'inherit', detached: process.platform !== 'win32' }
const children = []
function start(command, args) {
  const child = spawn(command, args, options)
  children.push(child)
  return child
}
const r2 = start('pnpm', ['--filter', '@oi-manufacture/server', 'r2:dev'])
for (let attempt = 0; attempt < 60; attempt++) {
  if (r2.exitCode !== null) throw new Error('Wrangler R2 emulator stopped before it was ready.')
  try {
    const response = await fetch('http://127.0.0.1:8788/_r2/?key=health', { method: 'HEAD', headers: { 'x-local-r2-token': 'oi-local-r2-only-token' } })
    if (response.status === 404) break
  } catch {}
  if (attempt === 59) throw new Error('Timed out waiting for the Wrangler R2 emulator.')
  await setTimeout(500)
}
start('pnpm', ['--filter', '@oi-manufacture/server', 'dev'])
start('node', ['scripts/slicing-worker.mjs'])
start('pnpm', ['dev:web'])
let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  for (const child of children) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM')
      else if (child.pid) process.kill(-child.pid, 'SIGTERM')
    } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop)
await Promise.all(children.map((child) => new Promise((resolve) => {
  child.on('exit', (code) => { if (code) process.exitCode = code; stop(); resolve() })
  child.on('error', (error) => { console.error(error.message); process.exitCode = 1; stop(); resolve() })
})))
if (pidFile) await rm(pidFile, { force: true })
