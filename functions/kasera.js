const { createHmac, timingSafeEqual } = require("node:crypto")

function verifyKaseraSignature(rawBody, signature, secret, now = Date.now()) {
  if (!signature || !secret) return false
  const parts = signature.split(",")
  const timestamp = parts[0]?.startsWith("t=") ? Number(parts[0].slice(2)) : NaN
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(now / 1000 - timestamp) > 300
  )
    return false
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest()
  return parts.slice(1).some((part) => {
    if (!part.startsWith("v1=") || !/^[\da-f]{64}$/i.test(part.slice(3)))
      return false
    const supplied = Buffer.from(part.slice(3), "hex")
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    )
  })
}

function isKaseraCheckoutUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === "pay.kasera.id"
  } catch {
    return false
  }
}

module.exports = { verifyKaseraSignature, isKaseraCheckoutUrl }
