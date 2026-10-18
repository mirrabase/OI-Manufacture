import test from "node:test"
import assert from "node:assert/strict"
import {
  scheduleOverviewRefresh,
  OVERVIEW_TTL_MS,
  OVERVIEW_RETRY_MS,
} from "./overview-refresh.ts"

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
test("Highlights refresh at expiration, pause in hidden tabs, resume and retry failures", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 })
  const visibility = new EventTarget()
  visibility.hidden = false
  let calls = 0
  let fail = false
  const stop = scheduleOverviewRefresh({
    visibility,
    load: async () => {
      calls++
      return fail ? null : Date.now()
    },
  })
  await flush()
  assert.equal(calls, 1)
  t.mock.timers.tick(OVERVIEW_TTL_MS - 1)
  await flush()
  assert.equal(calls, 1)
  t.mock.timers.tick(1)
  await flush()
  assert.equal(calls, 2)
  visibility.hidden = true
  visibility.dispatchEvent(new Event("visibilitychange"))
  t.mock.timers.tick(2 * OVERVIEW_TTL_MS)
  await flush()
  assert.equal(calls, 2)
  fail = true
  visibility.hidden = false
  visibility.dispatchEvent(new Event("visibilitychange"))
  await flush()
  assert.equal(calls, 3)
  t.mock.timers.tick(OVERVIEW_RETRY_MS - 1)
  await flush()
  assert.equal(calls, 3)
  t.mock.timers.tick(1)
  await flush()
  assert.equal(calls, 4)
  stop()
  t.mock.timers.tick(OVERVIEW_TTL_MS)
  await flush()
  assert.equal(calls, 4)
})
test("Highlights do not load while initially hidden or overlap in-flight refreshes", async () => {
  const visibility = new EventTarget()
  visibility.hidden = true
  let calls = 0
  let resolve
  const stop = scheduleOverviewRefresh({
    visibility,
    load: () => {
      calls++
      return new Promise((done) => {
        resolve = done
      })
    },
  })
  assert.equal(calls, 0)
  visibility.hidden = false
  visibility.dispatchEvent(new Event("visibilitychange"))
  visibility.dispatchEvent(new Event("visibilitychange"))
  assert.equal(calls, 1)
  stop()
  resolve(Date.now())
  await flush()
})
