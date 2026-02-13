import type { Address } from 'abitype'

export type Token = {
  symbol: string
  amount?: string
}

export type ParsedToken = {
  symbol: string
  address: Address
  amount?: bigint
}

export type SourceTokens =
  | string[]
  | { chain: { id: number }; address: Address; amount?: string }[]

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

export type BundleResult = {
  status: string
  claims?: Array<{
    chainId: number
    status: string
    depositId?: bigint
    claimTimestamp?: number
    claimTransactionHash?: string
  }>
  destinationChainId?: number
  fillTransactionHash?: string
  fillTimestamp?: number
  [key: string]: any
}

export type OrderPath = {
  [key: string]: any
}
