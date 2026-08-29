// Uses the Web Crypto API (globalThis.crypto.subtle) rather than Node's
// `crypto` module so this file works identically in middleware (Edge
// runtime) and regular API routes (Node runtime).
const COOKIE_NAME = "extolem_session"
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET is not configured")
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return bytes
}

export async function createSessionToken(): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_MS
  const payload = `${expiresAt}`
  const key = await getKey()
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  return `${payload}.${toHex(signature)}`
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false
  const [payload, signatureHex] = token.split(".")
  if (!payload || !signatureHex) return false

  const expiresAt = Number(payload)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false

  try {
    const key = await getKey()
    const signatureBytes = fromHex(signatureHex)
    return crypto.subtle.verify("HMAC", key, signatureBytes.buffer.slice(0) as ArrayBuffer, new TextEncoder().encode(payload))
  } catch {
    return false
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000
