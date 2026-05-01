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
  const chain = ensureInit().get(chainId)
  if (!chain) {
    throw new Error(`Chain ${chainId} not in /chains response`)
  }
  if (symbolOrAddress.toUpperCase() === 'ETH') return ETH_PSEUDO_ADDRESS
  if (chain.supportedTokens === 'all') {
    throw new Error(
      `Chain ${chainId} accepts arbitrary tokens; pass an address instead of symbol '${symbolOrAddress}'`,
    )
  }
  const match = chain.supportedTokens.find(
    (t) => t.symbol.toUpperCase() === symbolOrAddress.toUpperCase(),
  )
  if (!match) {
    throw new Error(
      `Token '${symbolOrAddress}' not supported on chain ${chainId}. Available: ${chain.supportedTokens.map((t) => t.symbol).join(', ')}`,
    )
  }
  return match.address
}

export const getTokenSymbol = (
  tokenAddress: Address,
  chainId: number,
): string | undefined => {
  const chain = ensureInit().get(chainId)
  if (!chain || chain.supportedTokens === 'all') return undefined
  const target = tokenAddress.toLowerCase()
  return chain.supportedTokens.find((t) => t.address.toLowerCase() === target)
    ?.symbol
}

export const getTokenDecimals = async (
  symbolOrAddress: string,
  chainId: number,
): Promise<number> => {
  const chain = ensureInit().get(chainId)
  if (chain && chain.supportedTokens !== 'all') {
    const lookup = isAddress(symbolOrAddress)
      ? chain.supportedTokens.find(
          (t) => t.address.toLowerCase() === symbolOrAddress.toLowerCase(),
        )
      : chain.supportedTokens.find(
          (t) => t.symbol.toUpperCase() === symbolOrAddress.toUpperCase(),
        )
    if (lookup) return lookup.decimals
  }
  if (symbolOrAddress.toUpperCase() === 'ETH') return 18
  if (!isAddress(symbolOrAddress)) {
    throw new Error(
      `Cannot resolve decimals for symbol '${symbolOrAddress}' on chain ${chainId} — not in /chains and not an address`,
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
