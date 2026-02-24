import {
  getTokenAddress,
  type RhinestoneAccount as RhinestoneAccountType,
  RhinestoneSDK,
  type Session,
} from '@rhinestone/sdk'
import { toViewOnlyAccount } from '@rhinestone/sdk/utils'
import {
  type Address,
  type Chain,
  createPublicClient,
  erc20Abi,
  type Hex,
  http,
  isAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  createRhinestoneAccount,
  processIntent,
  type RhinestoneAccount,
  ts,
} from './main.js'
import type { Intent, Token, TokenSymbol } from './types.js'
import { getChain, getChainById } from './utils/chains.js'
import { createWebhookListener, type WebhookListener } from './deposit-webhook.js'
import { getDepositServiceConfig } from './utils/environments.js'

function jsonStringify(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  )
}

const POLL_INTERVAL = 1_000
const POLL_TIMEOUT = 90_000

// --- Deposit chain validation ---

interface DepositChainEntry {
  name: string
  testnet: boolean
  deposit: boolean
  destination: boolean
  supportedTokens:
    | 'all'
    | { symbol: string; address: string; decimals: number }[]
}

function toCaip2(chainId: number): string {
  return `eip155:${chainId}`
}

async function fetchSupportedDepositChains(
  orchestratorUrl: string,
): Promise<Set<string>> {
  const response = await fetch(`${orchestratorUrl}/deposit-processor/chains`)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch deposit chains: ${response.status} ${response.statusText}`,
    )
  }
  const data = (await response.json()) as Record<string, DepositChainEntry>
  const depositEnabledChainIds = new Set<string>()
  for (const [chainId, chain] of Object.entries(data)) {
    if (chain.deposit) {
      depositEnabledChainIds.add(chainId)
    }
  }
  return depositEnabledChainIds
}

// --- Deposit account creation ---

interface DepositAccountSetup {
  account: RhinestoneAccountType
  address: Address
  factory: Address
  factoryData: Hex
  sessionDetails: {
    hashesAndChainIds: { chainId: bigint; sessionDigest: Hex }[]
    signature: Hex
  }
}

async function createDepositAccount(
  environmentString: string,
  chains: Chain[],
  signerAddress: Address,
): Promise<DepositAccountSetup> {
  const owner = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY! as Hex)
  const depositConfig = getDepositServiceConfig(environmentString)

  const rhinestone = new RhinestoneSDK({
    apiKey: depositConfig.apiKey,
    endpointUrl: depositConfig.orchestratorUrl,
    useDevContracts: false,
  })

  const account = await rhinestone.createAccount({
    account: {
      type: 'nexus' as const,
      salt: '0x0000000000000000000000000000000000000000000000000000000000000001',
    },
    owners: { type: 'ecdsa' as const, accounts: [owner] },
    experimental_sessions: { enabled: true },
  })

  const { factory, factoryData } = account.getInitData()
  const address = account.getAddress()

  const sessionSignerAccount = toViewOnlyAccount(signerAddress)
  const sessions: Session[] = chains.map((chain) => ({
    owners: { type: 'ecdsa' as const, accounts: [sessionSignerAccount] },
    chain,
  }))

  const sessionDetails = await account.experimental_getSessionDetails(sessions)
  const enableSignature =
    await account.experimental_signEnableSession(sessionDetails)

  return {
    account,
    address,
    factory,
    factoryData,
    sessionDetails: {
      hashesAndChainIds: sessionDetails.hashesAndChainIds,
      signature: enableSignature,
    },
  }
}

// --- Deposit service API calls ---

async function setupClient(
  serviceUrl: string,
  apiKey: string,
  sponsored: boolean,
  depositChainId: number,
  targetChainId: number,
): Promise<void> {
  const sponsorship = sponsored
    ? {
        [`eip155:${depositChainId}`]: {
          gas: 'all' as const,
          swap: 'all' as const,
          bridging: 'all' as const,
        },
        [`eip155:${targetChainId}`]: {
          gas: 'all' as const,
          swap: 'all' as const,
          bridging: 'all' as const,
        },
      }
    : undefined

  const response = await fetch(`${serviceUrl}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      params: {
        ...(sponsorship ? { sponsorship } : {}),
      },
    }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Setup failed (${response.status}): ${text}`)
  }
}

async function registerAccount(
  serviceUrl: string,
  apiKey: string,
  accountSetup: DepositAccountSetup,
  target: { chain: number; token: Address; recipient?: Address },
): Promise<void> {
  const response = await fetch(`${serviceUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: jsonStringify({
      account: {
        address: accountSetup.address,
        accountParams: {
          factory: accountSetup.factory,
          factoryData: accountSetup.factoryData,
          sessionDetails: accountSetup.sessionDetails,
        },
        target,
      },
    }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Register failed (${response.status}): ${text}`)
  }
}

// --- Balance polling ---

async function pollBalance(
  chain: Chain,
  token: Address,
  address: Address,
  timeout: number,
  minBalance = 0n,
): Promise<bigint> {
  const publicClient = createPublicClient({ chain, transport: http() })
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const balance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    })

    if (balance > minBalance) {
      console.log(
        `${ts()} Deposit: Balance updated on ${chain.name}: ${balance}`,
      )
      return balance
    }

    console.log(`${ts()} Deposit: Waiting for balance on ${chain.name}...`)
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
  }

  throw new Error(
    `Timeout: Balance did not increase on ${chain.name} within ${timeout}ms`,
  )
}

// --- Main orchestration ---

export async function runDepositMode(
  intent: Intent,
  environmentString: string,
  normalAccount: RhinestoneAccount,
  verbose?: boolean,
): Promise<void> {
  // 1. Validate
  if (intent.sourceChains.length !== 1) {
    throw new Error(
      `Deposit mode requires exactly 1 source chain (deposit chain), got ${intent.sourceChains.length}`,
    )
  }

  const depositConfig = getDepositServiceConfig(environmentString)
  const depositChain = getChain(intent.sourceChains[0])
  const targetChain = getChain(intent.targetChain)

  console.log(`${ts()} Deposit: ${depositChain.name} → ${targetChain.name}`)

  // 2. Validate deposit chain is supported
  console.log(`${ts()} Deposit: Checking supported deposit chains...`)
  const supportedChains = await fetchSupportedDepositChains(
    depositConfig.orchestratorUrl,
  )
  if (!supportedChains.has(toCaip2(depositChain.id))) {
    throw new Error(
      `Unsupported deposit chain: ${depositChain.name} (${depositChain.id}). Chain does not have deposit enabled.`,
    )
  }

  // 3. Resolve target token address on Z
  const targetTokenSymbol = intent.targetTokens[0].symbol
  const targetTokenAddress = isAddress(targetTokenSymbol)
    ? targetTokenSymbol
    : getTokenAddress(targetTokenSymbol as TokenSymbol, targetChain.id)

  // 4. Determine recipient on Z
  const recipient = intent.tokenRecipient
    ? (intent.tokenRecipient as Address)
    : normalAccount.getAddress()

  // 5. Create deposit account with sessions
  console.log(`${ts()} Deposit: Creating session-enabled deposit account...`)
  const depositAccountSetup = await createDepositAccount(
    environmentString,
    [depositChain, targetChain],
    depositConfig.signerAddress,
  )
  const depositAddress = depositAccountSetup.address
  console.log(`${ts()} Deposit: Deposit account address: ${depositAddress}`)

  // 5.5. Start webhook listener if ngrok is configured
  const useWebhooks = !!process.env.NGROK_AUTHTOKEN
  let webhookListener: WebhookListener | undefined
  if (useWebhooks) {
    webhookListener = await createWebhookListener(
      depositConfig.url,
      depositConfig.apiKey,
    )
  }

  try {
    // 6. Register with deposit service (always re-register to handle
    // changing deposit chains or targets between intents)
    console.log(`${ts()} Deposit: Registering with deposit service...`)
    await setupClient(
      depositConfig.url,
      depositConfig.apiKey,
      intent.sponsored,
      depositChain.id,
      targetChain.id,
    )
    await registerAccount(
      depositConfig.url,
      depositConfig.apiKey,
      depositAccountSetup,
      {
        chain: targetChain.id,
        token: targetTokenAddress,
        ...(intent.tokenRecipient
          ? { recipient: intent.tokenRecipient as Address }
          : {}),
      },
    )
    console.log(`${ts()} Deposit: Registration complete`)

    // 7. Record initial balance on Z
    const targetTokenAddressOnZ = targetTokenAddress
    const publicClient = createPublicClient({
      chain: targetChain,
      transport: http(),
    })
    const initialBalance = await publicClient.readContract({
      address: targetTokenAddressOnZ,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [recipient],
    })
    console.log(
      `${ts()} Deposit: Initial balance on ${targetChain.name}: ${initialBalance}`,
    )

    // 8. Build and execute funding intent (send to deposit address on Y)
    // Derive targetTokens from sourceAssets: the source tokens with amounts become
    // the exact target on the deposit chain. sourceAssets must be in exact input format.
    if (!intent.sourceAssets || !Array.isArray(intent.sourceAssets)) {
      throw new Error(
        'Deposit mode requires sourceAssets in exact input format: [{ chain, token, amount }]',
      )
    }
    const sourceAssetConfigs = intent.sourceAssets as {
      chain: string
      token: string
      amount?: string
    }[]
    const missingAmounts = sourceAssetConfigs.filter((c) => !c.amount)
    if (missingAmounts.length > 0) {
      throw new Error(
        `Deposit mode requires all sourceAssets to have amounts. Missing amounts for: ${missingAmounts.map((c) => c.token).join(', ')}`,
      )
    }
    const fundingTargetTokens: Token[] = sourceAssetConfigs.map((config) => ({
      symbol: config.token,
      amount: config.amount,
    }))

    // Create a prod account for the funding intent — deposit mode always uses
    // prod orchestrator and prod contracts, regardless of selected environment.
    console.log(`${ts()} Deposit: Creating prod account for funding intent...`)
    const prodAccount = await createRhinestoneAccount('prod')

    console.log(`${ts()} Deposit: Funding deposit address via intent...`)
    const fundingIntent: Intent = {
      targetChain: intent.sourceChains[0],
      targetTokens: fundingTargetTokens,
      sourceChains: [],
      sourceTokens: [],
      tokenRecipient: depositAddress,
      settlementLayers: [],
      sponsored: false,
    }

    const fillResult = await processIntent(
      fundingIntent,
      'prod',
      'execute',
      prodAccount,
      verbose,
    )

    if (!fillResult) {
      throw new Error('Funding intent returned no result')
    }

    console.log(
      `${ts()} Deposit: Funding complete. Fill hash: ${fillResult.fill.hash} on chain ${fillResult.fill.chainId}`,
    )
    if (verbose) {
      console.dir(fillResult, { depth: null })
    }

    // Record the on-chain fill timestamp for webhook timing
    if (webhookListener && fillResult.fill.hash) {
      const fillChain = getChainById(fillResult.fill.chainId)
      const fillClient = createPublicClient({
        chain: fillChain,
        transport: http(),
      })
      const fillTx = await fillClient.getTransactionReceipt({
        hash: fillResult.fill.hash as Hex,
      })
      const fillBlock = await fillClient.getBlock({
        blockNumber: fillTx.blockNumber,
      })
      const fillTimestamp = Number(fillBlock.timestamp) * 1000
      webhookListener.markFundingComplete(depositAddress, fillTimestamp)
    }

    // 9. Wait for bridge completion
    if (webhookListener) {
      console.log(
        `${ts()} Deposit: Waiting for bridge via webhook on ${targetChain.name}...`,
      )
      const bridgeResult = await webhookListener.waitForBridge(
        depositAddress,
        POLL_TIMEOUT,
      )
      const { timings } = bridgeResult
      console.log(
        `${ts()} Deposit: Success! Bridge complete on ${targetChain.name}` +
          ` (fill: ${bridgeResult.destination.transactionHash}, amount: ${bridgeResult.destination.amount})`,
      )
      console.log(
        `${ts()} Deposit: ${depositChain.name} → ${targetChain.name}: Total: ${timings.total}ms` +
          ` (Detect: ${timings.detect}ms, Route: ${timings.route}ms, Bridge: ${timings.bridge}ms)`,
      )
    } else {
      console.log(
        `${ts()} Deposit: Polling for balance on ${targetChain.name}...`,
      )
      const finalBalance = await pollBalance(
        targetChain,
        targetTokenAddressOnZ,
        recipient,
        POLL_TIMEOUT,
        initialBalance,
      )
      console.log(
        `${ts()} Deposit: Success! Final balance on ${targetChain.name}: ${finalBalance} (was ${initialBalance})`,
      )
    }
  } finally {
    if (webhookListener) {
      await webhookListener.cleanup()
    }
  }
}
