import { parseUnits } from 'viem'
import { getTokenDecimals } from '../registry.js'
import type { Token } from '../types.js'

export const getDecimals = ({
  tokenSymbolOrAddress,
  chainId,
}: {
  tokenSymbolOrAddress: string
  chainId: number
}): Promise<number> => {
  return getTokenDecimals(tokenSymbolOrAddress, chainId)
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
