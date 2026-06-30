'use strict'

// Polls the LocalStack health endpoint until the services we need are ready.
// Run after `docker compose up -d` and before seeding.

const ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566'
const NEEDED = ['s3', 'sqs', 'cloudformation']
const TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT_MS || 120000)
const READY = new Set(['available', 'running'])

async function probe() {
  const res = await fetch(`${ENDPOINT}/_localstack/health`)
  if (!res.ok) throw new Error(`health HTTP ${res.status}`)
  const { services = {} } = await res.json()
  return NEEDED.every((s) => READY.has(services[s]))
}

async function main() {
  const deadline = Date.now() + TIMEOUT_MS
  process.stdout.write(`waiting for LocalStack at ${ENDPOINT} `)
  while (Date.now() < deadline) {
    try {
      if (await probe()) {
        process.stdout.write(' ready\n')
        return
      }
    } catch {
      // not up yet — keep polling
    }
    process.stdout.write('.')
    await new Promise((r) => setTimeout(r, 2000))
  }
  process.stdout.write('\n')
  console.error(`timed out after ${TIMEOUT_MS}ms waiting for ${NEEDED.join(', ')}`)
  process.exit(1)
}

main()
