import type { AppFeeRate, SettlementLayerFilter } from '@rhinestone/sdk'
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
  /**
   * The address handed to the SDK. Always set on EVM chains — SDK v2 rejects
   * symbols in `tokenRequests` — and resolved from the chain registry when the
   * user gave a symbol. Deliberately separate from `address`: that one still
   * means "the user supplied an address", which is what decides whether a real
   * destination ERC20 transfer is built or a no-op call.
   */
  resolvedAddress?: string
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
  settlementLayers?: SettlementLayerFilter
  sponsored: boolean
  destinationOps?: boolean
  feeAsset?: string
  appFees?: AppFeeRate
  auxiliaryFunds?: Record<string, Record<string, string>>
}

export type TokenSymbol = 'ETH' | 'WETH' | 'USDC' | 'USDT' | 'USDT0'

/** Matches the blanc API response shape from the orchestrator / SDK. */
export type IntentResult = {
  status: string
  accountAddress: string
  operations: {
    chain: number
    status: string
    failureReason?: string
    txHash?: string
    timestamp?: number
  }[]
  label?: string
  [key: string]: any
}

/** Flatten all operations from an IntentResult into a list with chainId. */
export function getAllOperations(result: IntentResult) {
  return result.operations.map((operation) => ({
    hash: operation.txHash,
    chainId: operation.chain,
    operation,
    gasUsed: undefined as bigint | undefined,
  }))
}

export type OrderPath = {
  [key: string]: any
}
