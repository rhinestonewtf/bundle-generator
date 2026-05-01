import type { Address } from 'abitype'

export type Token = {
  symbol: string
  amount?: string
}

export type ParsedToken = {
  /** User-provided string: either a symbol like 'USDC' or an address. */
  symbol: string
  /** Set only when `symbol` is an address; needed to build destination ERC20 transfer calls. */
  address?: Address
  amount?: bigint
}

export type SourceTokens =
  | string[]
  | { chain: { id: number }; address: string; amount?: string }[]

export type SourceAssets =
  | string[]
  | Record<string, string[]>
  | { chain: string; token: string; amount?: string }[]

export type Intent = {
  targetChain: string
  targetTokens: Token[]
  sourceChains: string[]
  sourceTokens: SourceTokens
  sourceAssets?: SourceAssets
  tokenRecipient: string
  recipient?: string
  settlementLayers: string[]
  sponsored: boolean
  destinationOps?: boolean
  feeAsset?: string
  auxiliaryFunds?: Record<string, Record<string, string>>
}

export type TokenSymbol = 'ETH' | 'WETH' | 'USDC' | 'USDT'

export type IntentResult = {
  fill: {
    hash: string | undefined
    chainId: number
  }
  claims: {
    hash: string | undefined
    chainId: number
  }[]
  [key: string]: any
}

export type OrderPath = {
  [key: string]: any
}
