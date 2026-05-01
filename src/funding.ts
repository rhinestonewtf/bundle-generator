import {
  type Address,
  type Chain,
  createTestClient,
  encodeAbiParameters,
  http,
  isAddress,
  keccak256,
  pad,
  toHex,
  zeroAddress,
} from 'viem'
import { arbitrum, base, mainnet } from 'viem/chains'
import type { SourceTokens } from './types.js'
import { getChain } from './utils/chains.js'

// Hardcoded address + balance slot table for local-testnet funding only.
// LOCAL_TESTNET=true reaches here; nothing else needs these. Add chains/tokens
// as needed; tokens not in the table are skipped with a warning.
const LOCAL_FUNDING_TOKENS: Record<
  string,
  Record<number, { address: Address; slot: number }>
> = {
  USDC: {
    1: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', slot: 9 },
    137: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', slot: 9 },
    42161: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', slot: 9 },
    8453: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', slot: 9 },
  },
  USDT: {
    1: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', slot: 2 },
    137: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', slot: 0 },
    42161: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', slot: 51 },
  },
  WETH: {
    1: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', slot: 3 },
    137: { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', slot: 3 },
    42161: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', slot: 51 },
    8453: { address: '0x4200000000000000000000000000000000000006', slot: 3 },
  },
}

export const lookup = (chain: Chain): string => {
  switch (chain) {
    case mainnet:
      return 'http://localhost:30001'
    case arbitrum:
      return 'http://localhost:30002'
    case base:
      return 'http://localhost:30003'
  }
  throw new Error(`unsupported chain fork ${chain.name}`)
}

const computeSlot = (account: Address, balanceSlot: number): `0x${string}` =>
  keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }],
      [account, BigInt(balanceSlot)],
    ),
  )

const findEntryByAddress = (chainId: number, tokenAddress: Address) => {
  const target = tokenAddress.toLowerCase()
  for (const perChain of Object.values(LOCAL_FUNDING_TOKENS)) {
    const entry = perChain[chainId]
    if (entry && entry.address.toLowerCase() === target) return entry
  }
  return undefined
}

async function handleSourceTokensWithSymbols(
  account: Address,
  chain: ReturnType<typeof getChain>,
  testClient: ReturnType<typeof createTestClient>,
  sourceToken: string,
) {
  if (isAddress(sourceToken)) return

  if (sourceToken === 'ETH') {
    await testClient.setBalance({
      address: account,
      value: 100000000000000000000000000000000000000000n,
    })
    return
  }

  const entry = LOCAL_FUNDING_TOKENS[sourceToken.toUpperCase()]?.[chain.id]
  if (!entry) {
    console.warn(
      `LOCAL_TESTNET: skipping ${sourceToken} on ${chain.name} (chain ${chain.id}) — not in LOCAL_FUNDING_TOKENS`,
    )
    return
  }

  await testClient.setStorageAt({
    address: entry.address,
    index: computeSlot(account, entry.slot),
    value: pad(toHex(100000000000000000000000000000000000000000n)),
  })
}

async function handleSourceTokensWithAmount(
  account: Address,
  chain: ReturnType<typeof getChain>,
  testClient: ReturnType<typeof createTestClient>,
  sourceToken: { chain: { id: number }; address: string; amount?: string },
) {
  if (!isAddress(sourceToken.address)) {
    console.warn(
      `LOCAL_TESTNET: skipping non-address source token '${sourceToken.address}' on chain ${sourceToken.chain.id}`,
    )
    return
  }
  const tokenAddress = sourceToken.address as Address

  if (tokenAddress === zeroAddress) {
    await testClient.setBalance({
      address: account,
      value: 100000000000000000000000000000000000000000n,
    })
    return
  }

  const entry = findEntryByAddress(sourceToken.chain.id, tokenAddress)
  if (!entry) {
    console.warn(
      `LOCAL_TESTNET: skipping ${tokenAddress} on chain ${sourceToken.chain.id} — not in LOCAL_FUNDING_TOKENS`,
    )
    return
  }

  await testClient.setStorageAt({
    address: tokenAddress,
    index: computeSlot(account, entry.slot),
    value: pad(toHex(100000000000000000000000000000000000000000n)),
  })
}

export const fundAccount = async ({
  account,
  sourceChains,
  sourceTokens,
}: {
  account: Address
  sourceChains: string[]
  sourceTokens: SourceTokens
}) => {
  if (process.env.LOCAL_TESTNET?.toString() !== 'true') return

  for (const sourceChain of sourceChains) {
    const chain = getChain(sourceChain)
    console.log('Funding on %s for %s', chain.name, account)
    const testClient = createTestClient({
      chain,
      mode: 'anvil',
      transport: http(lookup(chain)),
    })
    for (const sourceToken of sourceTokens) {
      if (typeof sourceToken === 'string') {
        await handleSourceTokensWithSymbols(
          account,
          chain,
          testClient,
          sourceToken,
        )
      } else {
        await handleSourceTokensWithAmount(
          account,
          chain,
          testClient,
          sourceToken,
        )
      }
    }
  }
}
