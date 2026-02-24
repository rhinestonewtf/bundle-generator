import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import ngrok from '@ngrok/ngrok'
import type { Address } from 'viem'
import { ts } from './main.js'

export interface WebhookBridgeResult {
  deposit: { transactionHash: string; sender: string }
  source: {
    transactionHash: string
    chain: string
    amount: string
    asset: string
  }
  destination: {
    transactionHash: string
    chain: string
    amount: string
    asset: string
  }
  account: string
  timings: {
    detect: number
    route: number
    bridge: number
    total: number
  }
}

export interface WebhookListener {
  /** Record the on-chain timestamp of the funding fill tx */
  markFundingComplete(depositAddress: Address, fillTimestamp: number): void
  waitForBridge(
    depositAddress: Address,
    timeout: number,
  ): Promise<WebhookBridgeResult>
  cleanup(): Promise<void>
}

interface PendingBridge {
  resolve: (result: WebhookBridgeResult) => void
  reject: (error: Error) => void
}

interface EventTimestamps {
  fundingComplete?: number
  depositReceived?: number
  bridgeStarted?: number
  bridgeComplete?: number
}

interface WebhookPayload {
  version: string
  type: string
  time: string
  data: any
}

function verifySignature(
  rawBody: string,
  secret: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const provided = signatureHeader.replace('sha256=', '')
  if (expected.length !== provided.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
}

export async function createWebhookListener(
  serviceUrl: string,
  apiKey: string,
): Promise<WebhookListener> {
  const secret = randomBytes(32).toString('hex')
  const pending = new Map<string, PendingBridge>()
  const timestamps = new Map<string, EventTimestamps>()

  // Start local HTTP server on random port
  const server = await new Promise<Server>((resolve) => {
    const srv = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        const sig = req.headers['x-webhook-signature'] as string | undefined
        if (!verifySignature(body, secret, sig)) {
          res.writeHead(401)
          res.end()
          return
        }

        res.writeHead(200)
        res.end()

        try {
          const payload = JSON.parse(body) as WebhookPayload
          handleEvent(payload)
        } catch {
          // ignore parse errors
        }
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })

  const port = (server.address() as { port: number }).port

  // Start ngrok tunnel
  const listener = await ngrok.forward({
    addr: port,
    authtoken_from_env: true,
  })
  const webhookUrl = listener.url()!
  console.log(
    `${ts()} Deposit: Webhook listener started at ${webhookUrl} (port ${port})`,
  )

  // Register webhook URL with deposit service
  const setupResponse = await fetch(`${serviceUrl}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      params: { webhookUrl, webhookSecret: secret },
    }),
  })
  if (!setupResponse.ok) {
    const text = await setupResponse.text()
    // Clean up on failure
    await listener.close()
    server.close()
    throw new Error(
      `Failed to set webhook URL (${setupResponse.status}): ${text}`,
    )
  }

  function getTimestamps(account: string): EventTimestamps {
    let ts = timestamps.get(account)
    if (!ts) {
      ts = {}
      timestamps.set(account, ts)
    }
    return ts
  }

  function buildTimings(ts: EventTimestamps) {
    const detect =
      ts.fundingComplete && ts.depositReceived
        ? ts.depositReceived - ts.fundingComplete
        : 0
    const route =
      ts.depositReceived && ts.bridgeStarted
        ? ts.bridgeStarted - ts.depositReceived
        : 0
    // If bridge-started was never received, measure from detect to complete
    const bridge = ts.bridgeStarted && ts.bridgeComplete
      ? ts.bridgeComplete - ts.bridgeStarted
      : ts.depositReceived && ts.bridgeComplete
        ? ts.bridgeComplete - ts.depositReceived
        : 0
    const total =
      ts.fundingComplete && ts.bridgeComplete
        ? ts.bridgeComplete - ts.fundingComplete
        : 0
    return { detect, route, bridge, total }
  }

  function handleEvent(payload: WebhookPayload) {
    const { type, data } = payload
    const account = data?.account?.toLowerCase()
    const now = Date.now()

    switch (type) {
      case 'deposit-received': {
        getTimestamps(account).depositReceived = now
        console.log(`${ts()} Deposit: [webhook] Deposit detected by service (amount: ${data?.amount ?? 'unknown'})`)
        break
      }
      case 'bridge-started': {
        getTimestamps(account).bridgeStarted = now
        console.log(`${ts()} Deposit: [webhook] Bridge started`)
        break
      }
      case 'bridge-complete': {
        const evTs = getTimestamps(account)
        evTs.bridgeComplete = now
        const timings = buildTimings(evTs)
        timestamps.delete(account)
        const p = pending.get(account)
        if (p) {
          pending.delete(account)
          p.resolve({
            ...(data as Omit<WebhookBridgeResult, 'timings'>),
            timings,
          })
        }
        break
      }
      case 'bridge-failed': {
        console.log(
          `${ts()} Deposit: [webhook] Bridge failed: ${data?.errorCode ?? 'unknown'} - ${data?.message ?? ''}`,
        )
        timestamps.delete(account)
        const p = pending.get(account)
        if (p) {
          pending.delete(account)
          p.reject(
            new Error(
              `Bridge failed: ${data?.errorCode ?? 'unknown'}${data?.message ? ` - ${data.message}` : ''}`,
            ),
          )
        }
        break
      }
      case 'error':
        console.warn(
          `${ts()} Deposit: [webhook] Error event: ${data?.error?.message ?? 'unknown'}`,
        )
        break
      default:
        console.log(`${ts()} Deposit: [webhook] Unknown event: ${type}`)
    }
  }

  return {
    markFundingComplete(depositAddress: Address, fillTimestamp: number) {
      const key = depositAddress.toLowerCase()
      getTimestamps(key).fundingComplete = fillTimestamp
    },

    waitForBridge(depositAddress: Address, timeout: number) {
      return new Promise<WebhookBridgeResult>((resolve, reject) => {
        const key = depositAddress.toLowerCase()
        const timer = setTimeout(() => {
          pending.delete(key)
          timestamps.delete(key)
          reject(
            new Error(
              `Webhook timeout: bridge-complete not received within ${timeout}ms`,
            ),
          )
        }, timeout)

        pending.set(key, {
          resolve: (result) => {
            clearTimeout(timer)
            resolve(result)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
      })
    },

    async cleanup() {
      // Clear webhook URL on the deposit service
      try {
        await fetch(`${serviceUrl}/setup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({
            params: { webhookUrl: null, webhookSecret: null },
          }),
        })
      } catch {
        // best-effort cleanup
      }

      // Close tunnel and server
      try {
        await listener.close()
      } catch {
        // ignore
      }
      server.close()

      // Reject any pending waiters
      for (const [key, p] of pending) {
        p.reject(new Error('Webhook listener shut down'))
        pending.delete(key)
      }
      timestamps.clear()
    },
  }
}
