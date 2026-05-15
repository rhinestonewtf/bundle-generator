import {
  type Address,
  createPublicClient,
  erc20Abi,
  http,
  isAddress,
  parseUnits,
} from 'viem'
import type { Token } from '../types.js'
import { getChainById, NON_EVM_CHAINS } from './chains.js'

const KNOWN_DECIMALS: Record<string, number> = {
  ETH: 18,
  WETH: 18,
  USDC: 6,
  USDT: 6,
  USDT0: 6,
}

// Non-EVM token decimals — keyed by NON_EVM_CHAINS key, then mint/contract
// address. SPL mints (base58) and Tron T-prefix addresses can't be queried
// via viem, so we hardcode the handful we use in test intents. Case-sensitive
// — the orchestrator and SDK both treat these as opaque strings.
const NON_EVM_TOKEN_DECIMALS_BY_NAME: Record<string, Record<string, number>> = {
  solana: {
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6, // USDC
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6, // USDT
  },
  tron: {
    TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: 6, // USDT
  },
}

const NON_EVM_TOKEN_DECIMALS: Record<
  number,
  Record<string, number>
> = Object.fromEntries(
  Object.entries(NON_EVM_TOKEN_DECIMALS_BY_NAME).map(([name, tokens]) => {
    const chain = NON_EVM_CHAINS[name]
    if (!chain) {
      throw new Error(
        `NON_EVM_TOKEN_DECIMALS references unknown chain '${name}'`,
      )
    }
    return [chain.id, tokens]
  }),
)

const decimalsCache = new Map<string, number>()

export const getDecimals = async ({
  tokenSymbolOrAddress,
  chainId,
}: {
  tokenSymbolOrAddress: string
  chainId: number
}): Promise<number> => {
  // Non-EVM destinations: look up by mint/contract address in the static
  // table. No EVM RPC available for these chains.
  const nonEvmTable = NON_EVM_TOKEN_DECIMALS[chainId]
  if (nonEvmTable) {
    const knownNonEvm = nonEvmTable[tokenSymbolOrAddress]
    if (knownNonEvm !== undefined) return knownNonEvm
    const knownSymbol = KNOWN_DECIMALS[tokenSymbolOrAddress.toUpperCase()]
    if (knownSymbol !== undefined) return knownSymbol
    throw new Error(
      `Unknown non-EVM token '${tokenSymbolOrAddress}' on chain ${chainId}. ` +
        `Known: ${Object.keys(nonEvmTable).join(', ')} or symbols ${Object.keys(KNOWN_DECIMALS).join(', ')}.`,
    )
  }
  if (!isAddress(tokenSymbolOrAddress)) {
    const known = KNOWN_DECIMALS[tokenSymbolOrAddress.toUpperCase()]
    if (known !== undefined) return known
    throw new Error(
      `Unknown symbol '${tokenSymbolOrAddress}'. Pass an address or use one of: ${Object.keys(KNOWN_DECIMALS).join(', ')}`,
    )
  }
  const cacheKey = `${chainId}:${tokenSymbolOrAddress.toLowerCase()}`
  const cached = decimalsCache.get(cacheKey)
  if (cached !== undefined) return cached
  const publicClient = createPublicClient({
    chain: getChainById(chainId),
    transport: http(),
  })
  const decimals = await publicClient.readContract({
    address: tokenSymbolOrAddress as Address,
    abi: erc20Abi,
    functionName: 'decimals',
  })
  decimalsCache.set(cacheKey, decimals)
  return decimals
}

export const convertTokenAmount = async ({
  token,
  chainId,
}: {
  token: Token
  chainId: number
}) => {
  const decimals = await getDecimals({
    tokenSymbolOrAddress: token.symbol,
    chainId,
  })
  return parseUnits(token.amount!, decimals)
}
