import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

await mkdir('.local', { recursive: true })
const servicesPidFile = resolve(`.local/dev-services-${process.pid}.pid`)

const args = ['emulators:exec', '--project', 'demo-oi-manufacture', '--only', 'auth,firestore,storage,functions',
  '--export-on-exit=.local/firebase-data']
if (existsSync('.local/firebase-data/firebase-export-metadata.json')) args.push('--import=.local/firebase-data')
args.push('node scripts/dev-services.mjs')
const child = spawn(fileURLToPath(new URL('../node_modules/.bin/firebase', import.meta.url)), args, {
  stdio: 'inherit', detached: process.platform !== 'win32', env: { ...process.env, OI_DEV_SERVICES_PID_FILE: servicesPidFile },
})
let stopping = false
async function stop(signal) {
  if (stopping) return
  stopping = true
  try {
    // Stop the apps first; emulators:exec then exports while the emulators are still alive.
    process.kill(Number(await readFile(servicesPidFile, 'utf8')), 'SIGTERM')
  } catch (error) {
    if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error
    child.kill(signal)
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(signal) })
child.on('exit', async (code) => { await rm(servicesPidFile, { force: true }); process.exit(code ?? 1) })
child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
