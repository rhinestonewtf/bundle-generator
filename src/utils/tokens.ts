import {
  type Address,
  createPublicClient,
  erc20Abi,
  http,
  isAddress,
  parseUnits,
} from 'viem'
import type { Token } from '../types.js'
import { getChainById, isNonEvmChain, NON_EVM_CHAINS } from './chains.js'
import { loadRegistry } from './registry.js'

const KNOWN_DECIMALS: Record<string, number> = {
  ETH: 18,
  WETH: 18,
  USDC: 6,
  USDT: 6,
  USDT0: 6,
}

// Non-EVM token decimals — keyed by NON_EVM_CHAINS key, then by BOTH the
// token's own identifier and its symbol. These identifiers can't be queried
// via viem, so the handful used in test intents is hardcoded. Case-sensitive:
// the orchestrator and SDK treat them as opaque strings.
//
// The symbol entries are not redundant. Without them a symbol falls through to
// the global `KNOWN_DECIMALS` guess, which answers a per-chain question
// globally — right for Solana and Tron by luck, and wrong for Stellar, whose
// USDC is SEVEN decimals. Guessing 6 there asks for a tenth of the intended
// amount and nothing raises.
const NON_EVM_TOKEN_DECIMALS_BY_NAME: Record<string, Record<string, number>> = {
  solana: {
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6, // USDC
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6, // USDT
    USDC: 6,
    USDT: 6,
  },
  tron: {
    TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: 6, // USDT
    USDT: 6,
  },
  // Stellar addresses classic assets through their Soroban contract, so XLM has
  // a real `C` address rather than a zero-address sentinel. Both are 7dp.
  stellar: {
    CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75: 7, // USDC
    CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA: 7, // XLM
    USDC: 7,
    XLM: 7,
  },
  // HyperCore is listed for a different reason than the rest: its token IS a
  // queryable EVM ERC20 (the HyperEVM one — the registry gives the spot venue
  // and chain 999 the same USDC address). But its synthetic id has no viem
  // chain, so letting the address path fall through to `getChainById` would
  // fail obscurely. Resolving from this table avoids that entirely.
  hypercore: {
    '0xb88339CB7199b77E23DB6E890353E22632Ba630f': 6, // USDC
    USDC: 6,
  },
}

const NON_EVM_TOKEN_DECIMALS: Record<
  number,
  Record<string, number>
> = Object.fromEntries(
  Object.entries(NON_EVM_TOKEN_DECIMALS_BY_NAME).map(([name, tokens]) => {
    const chain = NON_EVM_CHAINS[name]
    if (!chain) {
      throw new Error(
        `NON_EVM_TOKEN_DECIMALS references unknown chain '${name}'`,
      )
    }
    return [chain.id, tokens]
  }),
)

const decimalsCache = new Map<string, number>()

export const getDecimals = async ({
  tokenSymbolOrAddress,
  chainId,
}: {
  tokenSymbolOrAddress: string
  chainId: number
}): Promise<number> => {
  // Non-EVM destinations: look up by mint/contract address in the static
  // table. No EVM RPC available for these chains.
  const nonEvmTable = NON_EVM_TOKEN_DECIMALS[chainId]
  if (nonEvmTable) {
    const knownNonEvm =
      nonEvmTable[tokenSymbolOrAddress] ??
      nonEvmTable[tokenSymbolOrAddress.toUpperCase()]
    if (knownNonEvm !== undefined) return knownNonEvm
    // Deliberately NO fallback to the global `KNOWN_DECIMALS`. Decimals are a
    // per-chain fact and that table is a global guess: it says USDC is 6, which
    // is wrong on Stellar and would silently ask for a tenth of the amount.
    // A missing entry is a table to extend, not a number to assume.
    throw new Error(
      `Unknown non-EVM token '${tokenSymbolOrAddress}' on chain ${chainId}. ` +
        `Add it to NON_EVM_TOKEN_DECIMALS_BY_NAME — known here: ${Object.keys(nonEvmTable).join(', ')}.`,
    )
  }
  if (!isAddress(tokenSymbolOrAddress)) {
    // The registry is authoritative and per-chain (USDC is 6 decimals almost
    // everywhere, but the table below is a guess and the registry is not).
    const registry = await loadRegistry()
    const entry = registry.resolveToken(chainId, tokenSymbolOrAddress)
    if (entry && entry.decimals >= 0) return entry.decimals
    const known = KNOWN_DECIMALS[tokenSymbolOrAddress.toUpperCase()]
    if (known !== undefined) return known
    throw new Error(
      `Unknown symbol '${tokenSymbolOrAddress}' on chain ${chainId}. Pass an address, or use a symbol the chain registry knows for that chain.`,
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

/**
 * Turn a user-supplied token string into the hex address SDK v2 requires.
 *
 * v2's `normalizeTokenAddress` rejects symbols on every EVM chain, so this is
 * the boundary where the intent files' human-friendly `"USDC"` becomes an
 * address. Only chains whose tokens are genuinely opaque identifiers — Solana
 * mints, Tron contracts, Stellar Soroban contracts — are passed through
 * untouched.
 *
 * That question is asked of the registry's VM type and NOT of `isNonEvmChain`,
 * because the two disagree on HyperCore and only one of them is about token
 * addressing. `isNonEvmChain` is true for HyperCore (it has no viem chain and
 * no RPC, which is what that predicate guards), but its tokens are ordinary
 * HyperEVM ERC20s and the SDK counts every HyperCore wire id as EVM-settled —
 * so a symbol here dies at `Expected a token address on EVM chain …` before
 * routing. The artifact says `vmType: 'evm'` for HyperCore and `svm`/`tvm`/
 * `stellar` for the rest, which is exactly the distinction needed.
 */
export const resolveTokenAddress = async ({
  tokenSymbolOrAddress,
  chainId,
}: {
  tokenSymbolOrAddress: string
  chainId: number
}): Promise<string> => {
  if (isAddress(tokenSymbolOrAddress)) return tokenSymbolOrAddress

  const registry = await loadRegistry()
  const vmType = registry.getVmType(chainId)
  // Unlisted chain: fall back to the local set so Solana/Tron still pass
  // through if the artifact ever stops describing them.
  const opaqueTokenIds = vmType ? vmType !== 'evm' : isNonEvmChain(chainId)
  if (opaqueTokenIds) {
    // A symbol is still resolvable on these chains — the registry knows that
    // USDC on Stellar is a Soroban contract. Resolve it so an intent can say
    // "USDC" here as it does on EVM; the orchestrator rejects the bare symbol
    // as a token address, so passing it through unconditionally made the
    // symbol form silently unusable.
    const known = registry.resolveToken(chainId, tokenSymbolOrAddress)
    if (
      known &&
      known.symbol.toUpperCase() === tokenSymbolOrAddress.toUpperCase()
    ) {
      return known.address
    }
    // Not a symbol the registry knows: it is the chain-native identifier
    // already, and those are opaque to us.
    return tokenSymbolOrAddress
  }

  const entry = registry.resolveToken(chainId, tokenSymbolOrAddress)
  if (!entry) {
    throw new Error(
      `Cannot resolve token '${tokenSymbolOrAddress}' on chain ${chainId}: the chain registry (facts v${registry.version}) lists no such symbol there. Pass the token address instead.`,
    )
  }
  return entry.address
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
