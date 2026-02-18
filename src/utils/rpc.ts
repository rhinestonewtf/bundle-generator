import { http } from 'viem'

const alchemyChainSlugs: Record<number, string> = {
  1: 'eth-mainnet',
  10: 'opt-mainnet',
  137: 'polygon-mainnet',
  8453: 'base-mainnet',
  42161: 'arb-mainnet',
  43114: 'avax-mainnet',
  324: 'zksync-mainnet',
  146: 'sonic-mainnet',
}

export const getRpcUrl = (chainId: number): string => {
  const apiKey = process.env.ALCHEMY_API_KEY
  const slug = alchemyChainSlugs[chainId]
  if (!apiKey || !slug) {
    // Fall back to viem's default RPC if no Alchemy key or unsupported chain
    return ''
  }
  return `https://${slug}.g.alchemy.com/v2/${apiKey}`
}

export const rpcTransport = (chainId: number) => {
  const url = getRpcUrl(chainId)
  return url ? http(url) : http()
}
