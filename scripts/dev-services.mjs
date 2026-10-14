import { spawn } from 'node:child_process'
import { writeFile, rm } from 'node:fs/promises'

const pidFile = process.env.OI_DEV_SERVICES_PID_FILE
if (pidFile) await writeFile(pidFile, String(process.pid))

const options = { stdio: 'inherit', detached: process.platform !== 'win32' }
const children = [spawn('node', ['scripts/slicing-worker.mjs'], options), spawn('pnpm', ['dev:web'], options)]
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
