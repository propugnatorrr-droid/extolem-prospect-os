// Extolem Prospect OS — thin wrapper around the Apify actor API.
// We call actors directly by id (apify.actor(id).call(input)) rather than
// pre-created Apify "Tasks" — one less manual setup step in the Apify console.
import { ApifyClient } from "apify-client"

let cached: ApifyClient | null = null

function getClient(): ApifyClient {
  if (!process.env.APIFY_TOKEN) {
    throw new Error("APIFY_TOKEN is not configured — add it to .env")
  }
  if (!cached) {
    cached = new ApifyClient({ token: process.env.APIFY_TOKEN })
  }
  return cached
}

export interface ApifyRunResult {
  runId: string
  actorId: string
  datasetId: string
  status: string
}

/** Runs an actor to completion and returns its dataset id. Blocks until the run finishes. */
export async function runApifyActor(
  actorId: string,
  input: Record<string, unknown>,
  { timeoutSecs = 300 }: { timeoutSecs?: number } = {},
): Promise<ApifyRunResult> {
  const client = getClient()
  const run = await client.actor(actorId).call(input, { timeout: timeoutSecs })
  return {
    runId: run.id,
    actorId: run.actId,
    datasetId: run.defaultDatasetId,
    status: run.status,
  }
}

export async function readApifyDataset(datasetId: string): Promise<Record<string, unknown>[]> {
  const client = getClient()
  const result = await client.dataset(datasetId).listItems({ clean: true, limit: 250_000 })
  return result.items as Record<string, unknown>[]
}

export function isApifyConfigured(): boolean {
  return Boolean(process.env.APIFY_TOKEN)
}
