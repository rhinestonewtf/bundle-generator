import { http } from 'viem'

const alchemyChainSlugs: Record<number, string> = {
  // L1s
  1: 'eth-mainnet',
  56: 'bnb-mainnet',
  100: 'gnosis-mainnet',
  137: 'polygon-mainnet',
  146: 'sonic-mainnet',
  1284: 'moonbeam-mainnet',
  1329: 'sei-mainnet',
  2020: 'ronin-mainnet',
  7000: 'zetachain-mainnet',
  42220: 'celo-mainnet',
  43114: 'avalanche-mainnet',
  80094: 'berachain-mainnet',
  // L2s
  10: 'opt-mainnet',
  30: 'rootstock-mainnet',
  204: 'opbnb-mainnet',
  252: 'frax-mainnet',
  324: 'zksync-mainnet',
  480: 'worldchain-mainnet',
  747: 'flow-mainnet',
  1088: 'metis-mainnet',
  1101: 'polygonzkevm-mainnet',
  5000: 'mantle-mainnet',
  8453: 'base-mainnet',
  34443: 'mode-mainnet',
  42161: 'arb-mainnet',
  42170: 'arbnova-mainnet',
  59144: 'linea-mainnet',
  60808: 'bob-mainnet',
  81457: 'blast-mainnet',
  534352: 'scroll-mainnet',
  // L3s / Rollups
  130: 'unichain-mainnet',
  360: 'shape-mainnet',
  1868: 'soneium-mainnet',
  2741: 'abstract-mainnet',
  7777777: 'zora-mainnet',
  33139: 'apechain-mainnet',
  57073: 'ink-mainnet',
  666666666: 'degen-mainnet',
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
