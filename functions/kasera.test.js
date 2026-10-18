const test = require("node:test")
const assert = require("node:assert/strict")
const { createHmac } = require("node:crypto")
const { verifyKaseraSignature, isKaseraCheckoutUrl } = require("./kasera")

const secret = "local-test-secret"
const now = 1_800_000_000_000
const rawBody = '{"id":"evt_test","type":"payment.paid"}'
const timestamp = Math.floor(now / 1000)
const signature = createHmac("sha256", secret)
  .update(`${timestamp}.${rawBody}`)
  .digest("hex")

test("accepts a fresh Kasera v1 signature over the unmodified body", () => {
  assert.equal(
    verifyKaseraSignature(
      rawBody,
      `t=${timestamp},v1=${signature}`,
      secret,
      now
    ),
    true
  )
})

test("rejects altered bodies, stale signatures, and malformed signatures", () => {
  assert.equal(
    verifyKaseraSignature(
      `${rawBody} `,
      `t=${timestamp},v1=${signature}`,
      secret,
      now
    ),
    false
  )
  assert.equal(
    verifyKaseraSignature(
      rawBody,
      `t=${timestamp - 301},v1=${signature}`,
      secret,
      now
    ),
    false
  )
  assert.equal(
    verifyKaseraSignature(rawBody, `t=${timestamp},v1=xyz`, secret, now),
    false
  )
})

test("accepts only the Kasera HTTPS checkout host", () => {
  assert.equal(isKaseraCheckoutUrl("https://pay.kasera.id/p/test"), true)
  assert.equal(isKaseraCheckoutUrl("http://pay.kasera.id/p/test"), false)
  assert.equal(isKaseraCheckoutUrl("https://evil.example/p/test"), false)
})
