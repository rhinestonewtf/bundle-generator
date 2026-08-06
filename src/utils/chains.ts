import {
  hyperCoreMainnet,
  type NonEvmChain,
  solanaMainnet,
  tronMainnet,
} from '@rhinestone/sdk'
import type { Chain } from 'viem'
import * as viemChains from 'viem/chains'

// Non-EVM destination chains — name-keyed so intent JSON can reference them
// the same way as viem chain names. The SDK intentionally doesn't expose a
// numeric `id` on `NonEvmChain` (it derives one internally from `caip2`),
// but simulation-tests reads `targetChain.id` everywhere downstream — so we
// shim a constant id here. Values must match the orchestrator's synthetic
// id registry (`fromCaip2` in @rhinestone/sdk/dist/.../caip2.js).
type DestinationChainWithId = NonEvmChain & { id: number }

// HyperCore's synthetic id is 1337 (the SDK's `fromCaip2('hypercore:mainnet')`),
// which the orchestrator maps to 999 for settlement.
//
// It belongs in NON_EVM_CHAIN_IDS below with Solana and Tron, even though the
// SDK's own `isNonEvmChainId(1337)` is false because HyperCore is EVM-*addressed*.
// The two predicates answer different questions and only one of them is ours:
// this set gates the paths that need a real viem `Chain` + RPC, and HyperCore is
// a virtual chain with neither. Worse, 1337 collides with viem's `localhost`, so
// excluding it doesn't fail loudly — it builds a client against 127.0.0.1:8545.
// Do not "correct" this to match the SDK.
//
// An intent targeting HyperCore must also restrict `settlementLayers` to ACROSS
// and/or ECO. Only those run the on-chain core-deposit that credits Core spot;
// RELAY, NEAR, RHINO and CCTP reject the route outright with
// UNSUPPORTED_HYPERCORE_DESTINATION because they deliver bare USDC and would
// strand it on HyperEVM. Leaving the filter open makes the whole intent fail.
//
// WARNING: delivery lands in the recipient's PERP MARGIN account, not their spot
// balance. `CoreDepositWallet.depositFor`'s `destinationDex` defaults to the perp
// dex, and the only lever (`tokenRequests[].balance`) is silently dropped by the
// SDK — so there is currently no way to reach spot from here, and nothing errors.
// Verify with `clearinghouseState` (perp), not `spotClearinghouseState`. RHI-5510.
export const NON_EVM_CHAINS: Record<string, DestinationChainWithId> = {
  solana: { ...solanaMainnet, id: 792703809 },
  tron: { ...tronMainnet, id: 728126428 },
  hypercore: { ...hyperCoreMainnet, id: 1337 },
}

export const NON_EVM_CHAIN_IDS: ReadonlySet<number> = new Set(
  Object.values(NON_EVM_CHAINS).map((c) => c.id),
)

/**
 * True for a descriptor-addressed destination — one the SDK targets by `caip2`
 * rather than a viem `Chain`. These have no viem RPC, so callers must skip
 * receipt/block enrichment, and the SDK rejects destination *calls* on them.
 */
export const isNonEvmChain = (chainId: number): boolean =>
  NON_EVM_CHAIN_IDS.has(chainId)

/**
 * Strip the shimmed `id` before handing a destination to the SDK. v2 types the
 * destination as `Chain | NonEvmChain` and `NonEvmChain` has **no** `id`, so the
 * presence of one is what makes it take the EVM path — and for HyperCore that
 * lands on the 1337 trap described above.
 */
export const toSdkDestinationChain = (
  chain: Chain | DestinationChainWithId,
): Chain | NonEvmChain => {
  if (!isNonEvmChain(chain.id)) return chain as Chain
  const { id: _id, ...descriptor } = chain as DestinationChainWithId
  return descriptor
}

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

/**
 * Per-chain RPC overrides handed to the SDK as `provider: { type: 'custom' }`.
 *
 * The 1337-is-viem's-`localhost` collision documented on NON_EVM_CHAINS above
 * exists inside the SDK too: v2's own id↔caip2 table calls HyperCore 1337 and
 * resolves it through viem, so any RPC-needing step on a HyperCore destination
 * goes to `127.0.0.1:8545` and fails with `ECONNREFUSED` — which reads as a
 * broken local environment, not a chain-resolution bug. HyperEVM is the right
 * answer: it is what the orchestrator settles HyperCore on, and the registry
 * gives 999 and 1337 the same USDC address.
 */
export const SDK_RPC_OVERRIDES: Record<number, string> = {
  1337: viemChains.hyperEvm.rpcUrls.default.http[0],
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
