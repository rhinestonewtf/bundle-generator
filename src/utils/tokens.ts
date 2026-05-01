import {
  type Address,
  createPublicClient,
  erc20Abi,
  http,
  isAddress,
  parseUnits,
} from 'viem'
import type { Token } from '../types.js'
import { getChainById } from './chains.js'

const KNOWN_DECIMALS: Record<string, number> = {
  ETH: 18,
  WETH: 18,
  USDC: 6,
  USDT: 6,
}

const decimalsCache = new Map<string, number>()

export const getDecimals = async ({
  tokenSymbolOrAddress,
  chainId,
}: {
  tokenSymbolOrAddress: string
  chainId: number
}): Promise<number> => {
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
