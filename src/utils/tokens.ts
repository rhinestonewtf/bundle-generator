import { getTokenDecimals, type TokenSymbol } from '@rhinestone/sdk'
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

export const getDecimals = async ({
  tokenSymbolOrAddress,
  chainId,
}: {
  tokenSymbolOrAddress: string
  chainId: number
}): Promise<number> => {
  if (isAddress(tokenSymbolOrAddress)) {
    const publicClient = createPublicClient({
      chain: getChainById(chainId),
      transport: http(),
    })
    return publicClient.readContract({
      address: tokenSymbolOrAddress as Address,
      abi: erc20Abi,
      functionName: 'decimals',
    })
  }
  return getTokenDecimals(tokenSymbolOrAddress as TokenSymbol, chainId)
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
