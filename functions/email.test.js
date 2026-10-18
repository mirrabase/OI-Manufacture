const test = require("node:test")
const assert = require("node:assert/strict")
const { sendRfqEmailForChange } = require("./workflow")

const emailSettings = {
  apiKey: "test_key",
  from: "OI Manufacture <quotes@notify.mirrabase.com>",
  rfqId: "RFQ-email-test",
  appOrigin: "http://localhost:3001",
}

test("sends quotation and payment emails only after their RFQ state changes", async () => {
  const originalFetch = global.fetch
  const requests = []
  global.fetch = async (url, options) => {
    requests.push({ url, options, payload: JSON.parse(options.body) })
    return new Response(JSON.stringify({ id: `email-${requests.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  const submitted = { status: "Submitted", paymentStatus: "Unpaid" }
  const quoted = {
    ...submitted,
    status: "Quoted",
    quoteTotal: 42_000,
    quotedAt: 123,
    customer: { name: "Customer", email: "alanersia@gmail.com" },
    product: "Bracket",
    requirements: { quantity: 2, material: "PLA", color: "Black", infillPercent: 20 },
  }

  try {
    assert.equal(
      await sendRfqEmailForChange({ ...emailSettings, before: submitted, after: quoted }),
      "email-1"
    )
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, "https://api.resend.com/emails")
    assert.equal(requests[0].payload.from, emailSettings.from)
    assert.deepEqual(requests[0].payload.to, ["alanersia@gmail.com"])
    assert.match(requests[0].payload.subject, /Quotation siap/)
    assert.match(requests[0].payload.html, /Rp\s+42\.000/)
    assert.match(requests[0].payload.html, /Black/)
    assert.match(requests[0].payload.html, /20%/)
    assert.equal(
      new Headers(requests[0].options.headers).get("Idempotency-Key"),
      "quote_RFQ-email-test_123_42000"
    )

    await sendRfqEmailForChange({ ...emailSettings, before: quoted, after: quoted })
    assert.equal(requests.length, 1)

    const paid = {
      ...quoted,
      status: "Preparing Production",
      paymentStatus: "Paid",
      paidAt: 456,
      kaseraPaymentRequestId: "pay_123",
      shipping: { selection: { courierName: "JNE", service: "REG", cost: 12_000 } },
    }
    await sendRfqEmailForChange({ ...emailSettings, before: quoted, after: paid })
    assert.equal(requests.length, 2)
    assert.equal(requests[1].payload.from, emailSettings.from)
    assert.deepEqual(requests[1].payload.to, ["alanersia@gmail.com"])
    assert.match(requests[1].payload.subject, /Pembayaran dikonfirmasi/)
    assert.match(requests[1].payload.html, /Rp\s+54\.000/)
    assert.match(requests[1].payload.html, /JNE · REG/)
    assert.match(requests[1].payload.html, /Rp\s+12\.000/)
    assert.match(requests[1].payload.html, /Black/)
  } finally {
    global.fetch = originalFetch
  }
})

test("does not treat a rejected Resend request as a successful email", async () => {
  const originalFetch = global.fetch
  global.fetch = async () =>
    new Response(JSON.stringify({ message: "Invalid sender" }), {
      status: 422,
      headers: { "content-type": "application/json" },
    })
  try {
    await assert.rejects(
      sendRfqEmailForChange({
        ...emailSettings,
        before: { status: "Submitted", paymentStatus: "Unpaid" },
        after: {
          status: "Quoted",
          paymentStatus: "Unpaid",
          quoteTotal: 1_000,
          customer: { email: "alanersia@gmail.com" },
        },
      }),
      /Resend rejected the email \(HTTP 422\)/
    )
  } finally {
    global.fetch = originalFetch
  }
})
