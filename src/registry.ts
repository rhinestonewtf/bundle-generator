import {
  type Address,
  createPublicClient,
  erc20Abi,
  http,
  isAddress,
} from 'viem'
import { getChainById } from './utils/chains.js'

interface OrchestratorToken {
  symbol: string
  address: Address
  decimals: number
}

interface OrchestratorChain {
  name: string
  supportedTokens: 'all' | OrchestratorToken[]
  testnet: boolean
}

type ChainsResponse = Record<string, OrchestratorChain>

let cache: Map<number, OrchestratorChain> | undefined
let initializedFor: string | undefined

const ETH_PSEUDO_ADDRESS: Address = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

// Fallback canonical addresses for chains where the orchestrator returns
// `supportedTokens: 'all'` and therefore doesn't surface canonical addresses
// for the common ERC20s. Most prod chains are in this bucket today, so this
// table lets users keep using symbol shortcuts (USDC, USDT, WETH) instead of
// pasting addresses. When `/chains` starts returning canonical addresses for
// these chains, this table can shrink or go away.
const CANONICAL_TOKENS: Record<number, Record<string, Address>> = {
  1: {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  10: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  },
  56: {
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
  },
  137: {
    WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
  8453: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  42161: {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
}

const CANONICAL_DECIMALS: Record<string, number> = {
  ETH: 18,
  WETH: 18,
  USDC: 6,
  USDT: 6,
}

const decimalsCache = new Map<string, number>()

const ensureInit = () => {
  if (!cache) {
    throw new Error(
      'Registry not initialized. Call initRegistry(orchestratorUrl) before any token lookup.',
    )
  }
  return cache
}

export const initRegistry = async (orchestratorUrl: string): Promise<void> => {
  if (initializedFor === orchestratorUrl && cache) return
  const response = await fetch(`${orchestratorUrl}/chains`)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch /chains from ${orchestratorUrl}: ${response.status} ${response.statusText}`,
    )
  }
  const data = (await response.json()) as ChainsResponse
  const next = new Map<number, OrchestratorChain>()
  for (const [chainId, chain] of Object.entries(data)) {
    next.set(Number(chainId), chain)
  }
  cache = next
  initializedFor = orchestratorUrl
}

export const getSupportedChainIds = (): number[] => {
  return [...ensureInit().keys()]
}

export const getTokenAddress = (
  symbolOrAddress: string,
  chainId: number,
): Address => {
  if (isAddress(symbolOrAddress)) return symbolOrAddress as Address
  const upper = symbolOrAddress.toUpperCase()
  if (upper === 'ETH') return ETH_PSEUDO_ADDRESS

  const chain = ensureInit().get(chainId)
  if (!chain) {
    throw new Error(`Chain ${chainId} not in /chains response`)
  }
  if (chain.supportedTokens !== 'all') {
    const match = chain.supportedTokens.find(
      (t) => t.symbol.toUpperCase() === upper,
    )
    if (match) return match.address
    throw new Error(
      `Token '${symbolOrAddress}' not supported on chain ${chainId}. Available: ${chain.supportedTokens.map((t) => t.symbol).join(', ')}`,
    )
  }

  const fallback = CANONICAL_TOKENS[chainId]?.[upper]
  if (fallback) return fallback
  throw new Error(
    `Chain ${chainId} accepts arbitrary tokens but no canonical address for symbol '${symbolOrAddress}'. Pass the address explicitly or add it to CANONICAL_TOKENS.`,
  )
}

export const getTokenSymbol = (
  tokenAddress: Address,
  chainId: number,
): string | undefined => {
  const target = tokenAddress.toLowerCase()
  const chain = ensureInit().get(chainId)
  if (chain && chain.supportedTokens !== 'all') {
    return chain.supportedTokens.find((t) => t.address.toLowerCase() === target)
      ?.symbol
  }
  for (const [symbol, address] of Object.entries(
    CANONICAL_TOKENS[chainId] ?? {},
  )) {
    if (address.toLowerCase() === target) return symbol
  }
  return undefined
}

export const getTokenDecimals = async (
  symbolOrAddress: string,
  chainId: number,
): Promise<number> => {
  const upper = symbolOrAddress.toUpperCase()
  if (CANONICAL_DECIMALS[upper] !== undefined) return CANONICAL_DECIMALS[upper]

  const chain = ensureInit().get(chainId)
  if (chain && chain.supportedTokens !== 'all') {
    const lookup = isAddress(symbolOrAddress)
      ? chain.supportedTokens.find(
          (t) => t.address.toLowerCase() === symbolOrAddress.toLowerCase(),
        )
      : chain.supportedTokens.find((t) => t.symbol.toUpperCase() === upper)
    if (lookup) return lookup.decimals
  }

  if (!isAddress(symbolOrAddress)) {
    throw new Error(
      `Cannot resolve decimals for symbol '${symbolOrAddress}' on chain ${chainId} — not in /chains, not in canonical table, and not an address`,
    )
  }
  const cacheKey = `${chainId}:${symbolOrAddress.toLowerCase()}`
  const cached = decimalsCache.get(cacheKey)
  if (cached !== undefined) return cached
  const publicClient = createPublicClient({
    chain: getChainById(chainId),
    transport: http(),
  })
  const decimals = await publicClient.readContract({
    address: symbolOrAddress as Address,
    abi: erc20Abi,
    functionName: 'decimals',
  })
  decimalsCache.set(cacheKey, decimals)
  return decimals
}
