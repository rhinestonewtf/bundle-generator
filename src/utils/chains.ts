import { type NonEvmChain, solanaMainnet, tronMainnet } from '@rhinestone/sdk'
import type { Chain } from 'viem'
import * as viemChains from 'viem/chains'

// Non-EVM destination chains — name-keyed so intent JSON can reference them
// the same way as viem chain names. The SDK intentionally doesn't expose a
// numeric `id` on `NonEvmChain` (it derives one internally from `caip2`),
// but simulation-tests reads `targetChain.id` everywhere downstream — so we
// shim a constant id here. Values must match the orchestrator's synthetic
// id registry (`fromCaip2` in @rhinestone/sdk/dist/.../caip2.js).
type DestinationChainWithId = NonEvmChain & { id: number }

export const NON_EVM_CHAINS: Record<string, DestinationChainWithId> = {
  solana: { ...solanaMainnet, id: 792703809 },
  tron: { ...tronMainnet, id: 728126428 },
}

export const NON_EVM_CHAIN_IDS: ReadonlySet<number> = new Set(
  Object.values(NON_EVM_CHAINS).map((c) => c.id),
)

export const isNonEvmChain = (chainId: number): boolean =>
  NON_EVM_CHAIN_IDS.has(chainId)

// viem re-exports some non-Chain values (e.g. defineChain). Guard the
// .name / .id access so the find() doesn't throw on those.
const isViemChain = (value: unknown): value is Chain => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { id?: unknown; name?: unknown }
  return typeof v.id === 'number' && typeof v.name === 'string'
}

export const getChain = (name: string): Chain | DestinationChainWithId => {
  const lower = name.toLowerCase()
  const nonEvm = NON_EVM_CHAINS[lower]
  if (nonEvm) return nonEvm
  const chain = Object.values(viemChains).find(
    (c) => isViemChain(c) && c.name.replace(/ /g, '').toLowerCase() === lower,
  )
  if (!chain) {
    throw new Error(
      `Chain ${name} is not supported. Use the viem chain name without spaces.`,
    )
  }
  return chain as Chain
}

// EVM-only resolver. Use this on paths that can't handle non-EVM chains
// (anvil funding, source-chain lists for cross-chain EVM transactions, etc.).
export const getEvmChain = (name: string): Chain => {
  if (NON_EVM_CHAINS[name.toLowerCase()]) {
    throw new Error(
      `Chain ${name} is non-EVM and not supported in this context.`,
    )
  }
  return getChain(name) as Chain
}

export const getChainById = (chainId: number): Chain => {
  const chain = Object.values(viemChains).find(
    (c) => isViemChain(c) && c.id === chainId,
  )
  if (!chain) {
    throw new Error(`Chain with id ${chainId} is not supported.`)
  }
  return chain as Chain
}

// Local anvil fork RPC endpoints, keyed by chainId. Ports follow the e2e stack
// convention (chains exposed on 30001-30008). Used so on-chain reads (e.g.
// receipt enrichment) hit the local fork instead of viem's default public
// mainnet RPC — otherwise a tx that only exists on the fork is "not found".
const LOCAL_FORK_RPC_BY_CHAIN_ID: Record<number, string> = {
  1: 'http://localhost:30001', // mainnet
  42161: 'http://localhost:30002', // arbitrum
  8453: 'http://localhost:30003', // base
  137: 'http://localhost:30004', // polygon
  146: 'http://localhost:30005', // sonic
  10: 'http://localhost:30006', // optimism
  100: 'http://localhost:30007', // gnosis
  9745: 'http://localhost:30008', // plasma
}

export const getLocalForkRpcUrl = (chainId: number): string | undefined =>
  LOCAL_FORK_RPC_BY_CHAIN_ID[chainId]
