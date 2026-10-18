function validKey(key) {
  return typeof key === "string" && key.length > 0 && key.length <= 1024 && !key.split("/").includes("..")
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.headers.get("x-local-r2-token") !== env.LOCAL_R2_TOKEN) {
      return new Response("Unauthorized", { status: 401 })
    }
    if (!url.pathname.startsWith("/_r2/") || !validKey(url.searchParams.get("key"))) {
      return new Response("Not found", { status: 404 })
    }
    const key = url.searchParams.get("key")

    if (request.method === "PUT") {
      const size = Number(request.headers.get("content-length"))
      if (!Number.isSafeInteger(size) || size < 1) return new Response("Content length is required", { status: 400 })
      if (size > 50 * 1024 * 1024) return new Response("Object is too large", { status: 413 })
      const fixed = new FixedLengthStream(size)
      const input = request.body.pipeTo(fixed.writable)
      try {
        const [object] = await Promise.all([
          env.BUCKET.put(key, fixed.readable, {
            httpMetadata: { contentType: request.headers.get("content-type") || "application/octet-stream" },
          }),
          input,
        ])
        return Response.json({ size: object.size })
      } catch {
        return new Response("Object upload failed", { status: 400 })
      }
    }
    if (request.method === "HEAD") {
      const object = await env.BUCKET.head(key)
      return object ? new Response(null, { headers: { "content-length": String(object.size), "content-type": object.httpMetadata?.contentType || "application/octet-stream" } }) : new Response(null, { status: 404 })
    }
    if (request.method === "GET") {
      const object = await env.BUCKET.get(key)
      if (!object) return new Response("Not found", { status: 404 })
      return new Response(object.body, {
        headers: {
          "content-length": String(object.size),
          "content-type": object.httpMetadata?.contentType || "application/octet-stream",
        },
      })
    }
    if (request.method === "DELETE") {
      await env.BUCKET.delete(key)
      return new Response(null, { status: 204 })
    }
    return new Response("Method not allowed", { status: 405 })
  },
}
