import crypto from "crypto"

// Node-only (timingSafeEqual isn't in Web Crypto) — only ever called from a
// standard Node-runtime API route (the login handler), never from middleware.
export function checkPassword(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD
  if (!expected) return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
