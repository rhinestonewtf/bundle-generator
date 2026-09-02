import { type Address, isAddress } from 'viem'

/**
 * Runtime chain/token registry, read from the signed chain-facts artifact that
 * the orchestrator itself boots from.
 *
 * SDK v2 removed its bundled token registry: `normalizeTokenAddress` now
 * requires a hex address on every EVM chain and rejects symbols outright. The
 * orchestrator's own `GET /chains` can't fill the gap either — it reports
 * `supportedTokens: 'all'` for most chains (Base and Robinhood Chain included),
 * so it advertises no symbol table for them.
 *
 * Fetching this at runtime rather than depending on a pinned
 * `@rhinestone/shared-configs` is deliberate: a pinned registry is exactly what
 * made Robinhood Chain (4663) unusable here while it was live in prod. The
 * artifact is global — there is no per-env staging of it — so a chain appears
 * to this CLI as soon as it is published, with no dependency bump.
 *
 * Skew to be aware of: consumers load the artifact at boot, so a running
 * orchestrator can be a version behind `latest.json`. That only ever affects a
 * brand-new chain or token, and it surfaces as a clear orchestrator rejection
 * rather than a silently wrong route.
 */

const FACTS_URL = 'https://facts.rhinestone.dev/latest.json'

export type RegistryToken = {
  symbol: string
  address: Address
  decimals: number
}

type FactsToken = {
  symbol: string
  address: string
  decimals: number
}

type FactsChain = {
  caip2: string
  name: string
  vmType: string
  network: string
  tokens?: FactsToken[]
}

type FactsArtifact = {
  version: string
  chains: Record<string, FactsChain>
}

export type Registry = {
  version: string
  /** Chain ids the artifact describes. */
  chainIds: number[]
  /**
   * Chain ids usable as an intent *source*: EVM, and matching `testnet`.
   * Solana/Tron/HyperCore are destination-only here, and the orchestrator
   * rejects them outright in a source access list
   * (`Unsupported chain id in access list: 1337`).
   */
  sourceChainIds: (testnet: boolean) => number[]
  /** Whether the artifact marks this chain as a testnet. Unknown ids read as mainnet. */
  isTestnet: (chainId: number) => boolean
  /**
   * The chain's VM per the artifact (`evm` / `svm` / `tvm`), or undefined if it
   * isn't listed. This is the only reliable answer to "are this chain's token
   * identifiers hex addresses?" — see `resolveTokenAddress`.
   */
  getVmType: (chainId: number) => string | undefined
  /**
   * Resolve a user-supplied token string on a chain. An address passes through
   * (looked up for decimals when known); a symbol is matched case-insensitively.
   */
  resolveToken: (
    chainId: number,
    symbolOrAddress: string,
  ) => RegistryToken | undefined
  /** Chain id for a viem-style name with spaces stripped, e.g. `robinhoodchain`. */
  getChainIdByName: (normalizedName: string) => number | undefined
}

const normalizeName = (name: string) => name.replace(/ /g, '').toLowerCase()

const buildRegistry = (artifact: FactsArtifact): Registry => {
  const tokensByChain = new Map<number, RegistryToken[]>()
  const chainIdByName = new Map<string, number>()
  const evmChains = new Map<number, { testnet: boolean }>()
  const testnetChainIds = new Set<number>()
  const vmTypeByChain = new Map<number, string>()

  for (const [key, chain] of Object.entries(artifact.chains)) {
    const chainId = Number(key)
    if (!Number.isFinite(chainId)) continue
    chainIdByName.set(normalizeName(chain.name), chainId)
    vmTypeByChain.set(chainId, chain.vmType)
    if (chain.network === 'testnet') testnetChainIds.add(chainId)
    if (chain.vmType === 'evm' && chain.caip2.startsWith('eip155:')) {
      evmChains.set(chainId, { testnet: chain.network === 'testnet' })
    }
    // Every chain's tokens, not just the EVM ones. Dropping a non-EVM token
    // left its chain with an empty list, so `resolveToken` could not turn a
    // symbol into an address there and an intent had to name the raw
    // identifier — a base58 mint or a Soroban contract — where an EVM intent
    // says "USDC".
    const tokens = (chain.tokens ?? []).map<RegistryToken>((token) => ({
      symbol: token.symbol,
      // Case-folded for hex ONLY. The artifact publishes checksummed EVM
      // addresses; the orchestrator echoes and matches lowercase, and its
      // `sourceAssets.tokens` filter is compared as a raw string — so a
      // checksummed address matches no balance and comes back as `No balances
      // available` on a demonstrably funded account. A base58 mint or a base32
      // strkey is CASE-SENSITIVE and folding it corrupts the identifier.
      address: (isAddress(token.address)
        ? token.address.toLowerCase()
        : token.address) as Address,
      decimals: token.decimals,
    }))
    tokensByChain.set(chainId, tokens)
  }

  return {
    version: artifact.version,
    chainIds: [...tokensByChain.keys()],
    sourceChainIds: (testnet) =>
      [...evmChains.entries()]
        .filter(([, meta]) => meta.testnet === testnet)
        .map(([chainId]) => chainId),
    isTestnet: (chainId) => testnetChainIds.has(chainId),
    getVmType: (chainId) => vmTypeByChain.get(chainId),
    resolveToken: (chainId, symbolOrAddress) => {
      const tokens = tokensByChain.get(chainId) ?? []
      if (isAddress(symbolOrAddress)) {
        const lower = symbolOrAddress.toLowerCase()
        return (
          tokens.find((t) => t.address.toLowerCase() === lower) ?? {
            // Unknown-to-the-registry address: still a valid input for the SDK,
            // but decimals have to come from the chain. Signalled with -1 so
            // callers fall through to an RPC read rather than trusting a guess.
            symbol: symbolOrAddress,
            address: symbolOrAddress as Address,
            decimals: -1,
          }
        )
      }
      const upper = symbolOrAddress.toUpperCase()
      return tokens.find((t) => t.symbol.toUpperCase() === upper)
    },
    getChainIdByName: (name) => chainIdByName.get(normalizeName(name)),
  }
}

let cached: Promise<Registry> | undefined

/** Load the chain-facts artifact once per process. */
export const loadRegistry = (): Promise<Registry> => {
  if (!cached) {
    cached = (async () => {
      const response = await fetch(FACTS_URL)
      if (!response.ok) {
        throw new Error(
          `Failed to load the chain registry from ${FACTS_URL}: ${response.status} ${response.statusText}`,
        )
      }
      return buildRegistry((await response.json()) as FactsArtifact)
    })().catch((error) => {
      // Don't cache a failed load — a transient network blip shouldn't poison
      // every later lookup in a long `--async` replay.
      cached = undefined
      throw error
    })
  }
  return cached
}
