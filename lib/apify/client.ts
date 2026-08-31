import { ApifyClient } from "apify-client"

let cachedClient: ApifyClient | null = null

function getClient(): ApifyClient {
  const token = process.env.APIFY_TOKEN

  if (!token) {
    throw new Error("APIFY_TOKEN is not configured")
  }

  if (!cachedClient) {
    cachedClient = new ApifyClient({ token })
  }

  return cachedClient
}

export interface ApifyRunResult {
  runId: string
  actorId: string
  datasetId: string
  status: string
}

export async function startApifyActor(
  actorId: string,
  input: Record<string, unknown>,
): Promise<ApifyRunResult> {
  const run = await getClient().actor(actorId).start(input)

  return {
    runId: run.id,
    actorId: run.actId,
    datasetId: run.defaultDatasetId,
    status: run.status,
  }
}

export async function getApifyRun(runId: string): Promise<ApifyRunResult | null> {
  const run = await getClient().run(runId).get()

  if (!run) {
    return null
  }

  return {
    runId: run.id,
    actorId: run.actId,
    datasetId: run.defaultDatasetId,
    status: run.status,
  }
}

export async function abortApifyRun(runId: string): Promise<void> {
  await getClient().run(runId).abort()
}

export async function readApifyDataset(
  datasetId: string,
): Promise<Record<string, unknown>[]> {
  const result = await getClient().dataset(datasetId).listItems({
    clean: true,
    limit: 10_000,
  })

  return result.items as Record<string, unknown>[]
}

export async function runApifyActor(
  actorId: string,
  input: Record<string, unknown>,
  { timeoutSecs = 300 }: { timeoutSecs?: number } = {},
): Promise<ApifyRunResult> {
  const run = await getClient().actor(actorId).call(input, {
    timeout: timeoutSecs,
  })

  return {
    runId: run.id,
    actorId: run.actId,
    datasetId: run.defaultDatasetId,
    status: run.status,
  }
}

export function isApifyConfigured(): boolean {
  return Boolean(process.env.APIFY_TOKEN)
}
