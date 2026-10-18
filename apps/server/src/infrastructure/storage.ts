import { createReadStream, createWriteStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { AppError } from "../shared/errors.ts"

const MAX_MODEL_BYTES = 50 * 1024 * 1024

function createR2Store(env = process.env, fetcher = fetch) {
  if (env.R2_LOCAL_WORKER_URL) {
    const base = env.R2_LOCAL_WORKER_URL.replace(/\/$/, "")
    const token = env.R2_LOCAL_TOKEN || "oi-local-r2-only-token"
    const localRequest = async (
      method: string,
      key: string,
      body?: BodyInit,
      contentType?: string
    ) => {
      const response = await fetcher(
        `${base}/_r2/?key=${encodeURIComponent(key)}`,
        {
          method,
          headers: {
            "x-local-r2-token": token,
            ...(contentType ? { "content-type": contentType } : {}),
          },
          ...(body ? { body, duplex: "half" } : {}),
        }
      )
      if (!response.ok)
        throw new Error(`Local R2 returned HTTP ${response.status}.`)
      return response
    }
    return {
      async createUploadUrl({
        key,
        contentType,
        apiBaseUrl,
      }: {
        key: string
        contentType: string
        apiBaseUrl: string
      }) {
        return {
          url: `${apiBaseUrl}/api/storage/local-upload?key=${encodeURIComponent(key)}`,
          headers: { "Content-Type": contentType },
        }
      },
      async head(key: string) {
        const response = await localRequest("HEAD", key)
        return {
          size: Number(response.headers.get("content-length")),
          contentType:
            response.headers.get("content-type") || "application/octet-stream",
        }
      },
      async get(key: string) {
        const response = await localRequest("GET", key)
        return {
          body: response.body,
          size: Number(response.headers.get("content-length")),
          contentType:
            response.headers.get("content-type") || "application/octet-stream",
        }
      },
      async putFile(key: string, path: string, contentType: string) {
        const file = createReadStream(path)
        const options: RequestInit & { duplex: "half" } = {
          method: "PUT",
          headers: {
            "x-local-r2-token": token,
            "content-type": contentType,
            "content-length": String((await stat(path)).size),
          },
          body: Readable.toWeb(file) as ReadableStream<Uint8Array>,
          duplex: "half",
        }
        const response = await fetcher(
          `${base}/_r2/?key=${encodeURIComponent(key)}`,
          options
        )
        if (!response.ok)
          throw new Error(`Local R2 returned HTTP ${response.status}.`)
      },
      async downloadToFile(key: string, path: string) {
        const { body } = await this.get(key)
        await pipeline(
          Readable.fromWeb(
            body as import("node:stream/web").ReadableStream<Uint8Array>
          ),
          createWriteStream(path)
        )
      },
      async delete(key: string) {
        await localRequest("DELETE", key)
      },
    }
  }

  const accountId = env.R2_ACCOUNT_ID
  const bucket = env.R2_BUCKET_NAME
  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new AppError(
      "failed-precondition",
      "Configure R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY."
    )
  }
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
  return {
    async createUploadUrl({
      key,
      contentType,
    }: {
      key: string
      contentType: string
      apiBaseUrl: string
    }) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      })
      return {
        url: await getSignedUrl(client, command, { expiresIn: 300 }),
        headers: { "Content-Type": contentType },
      }
    },
    async head(key: string) {
      const value = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key })
      )
      return {
        size: Number(value.ContentLength),
        contentType: value.ContentType || "application/octet-stream",
      }
    },
    async get(key: string) {
      const value = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      )
      return {
        body: value.Body!.transformToWebStream(),
        size: Number(value.ContentLength),
        contentType: value.ContentType || "application/octet-stream",
      }
    },
    async putFile(key: string, path: string, contentType: string) {
      const fileStat = await stat(path)
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(path),
          ContentLength: fileStat.size,
          ContentType: contentType,
        })
      )
    },
    async downloadToFile(key: string, path: string) {
      const { body } = await this.get(key)
      await pipeline(
        Readable.fromWeb(
          body as import("node:stream/web").ReadableStream<Uint8Array>
        ),
        createWriteStream(path)
      )
    },
    async delete(key: string) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}

function validObjectKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    key.length <= 1024 &&
    !key.split("/").includes("..")
  )
}

export { MAX_MODEL_BYTES, createR2Store, validObjectKey }
