import { select } from '@inquirer/prompts'
import {
  type AuxiliaryFunds,
  type PreparedQuotes,
  RhinestoneSDK,
  type Transaction,
} from '@rhinestone/sdk'
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  http,
  isAddress,
  parseUnits,
  zeroAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { fundAccount } from './funding.js'
import {
  getAllOperations,
  type Intent,
  type IntentResult,
  type ParsedToken,
  type SourceAssets,
  type SourceTokens,
} from './types.js'
import {
  getChain,
  getChainById,
  getEvmChain,
  getLocalForkRpcUrl,
  isNonEvmChain,
  SDK_RPC_OVERRIDES,
  toSdkDestinationChain,
} from './utils/chains.js'
import { getEnvironment } from './utils/environments.js'
import { loadRegistry } from './utils/registry.js'
import {
  convertTokenAmount,
  getDecimals,
  resolveTokenAddress,
} from './utils/tokens.js'

export function ts() {
  return new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '')
}

const logTimingSummary = (
  bundleLabel: string,
  totalMs: number,
  timings: {
    route: number
    sign: number
    submit: number
    execute: number
    index: number
  },
) => {
  console.log(
    `${ts()} Bundle ${bundleLabel}: Total time: ${totalMs}ms ` +
      `(Route: ${timings.route}ms, Sign: ${timings.sign}ms, Submit: ${timings.submit}ms, Execute: ${timings.execute}ms, Index: ${timings.index}ms)`,
  )
}

/**
 * Expand a plain symbol list into a per-chain address map.
 *
 * Deliberately NOT the SDK's flat `SimpleTokenList`, even though that is the
 * shape a bare list maps onto: `adaptSourceAssets` only sends `chainIds`
 * alongside `tokens` when `sourceChains` is set, so an unscoped list arrives as
 * a bare `{ tokens: [...] }` that the orchestrator matches against nothing —
 * answering `No balances available` on a provably funded account. Under
 * beta.38 that same field carried *symbols* and matched globally; v2's switch
 * to addresses is what made the unscoped form unusable. A per-chain map is
 * scoped by construction, so it behaves the same with or without `sourceChains`.
 */
const expandSymbolList = async (
  symbols: string[],
  sourceChainIds: number[],
  targetChainId: number,
): Promise<Record<number, string[]>> => {
  const registry = await loadRegistry()
  // With no explicit `sourceChains`, fall back to every chain that can actually
  // *be* a source: EVM only, and on the same side of the mainnet/testnet split
  // as the target. Handing the orchestrator a virtual chain here is a hard 400
  // (`Unsupported chain id in access list: 1337`), not a skipped entry.
  const chainIds =
    sourceChainIds.length > 0
      ? sourceChainIds
      : registry.sourceChainIds(registry.isTestnet(targetChainId))
  const chainTokenMap: Record<number, string[]> = {}
  for (const chainId of chainIds) {
    const tokens = symbols.flatMap((symbolOrAddress) => {
      const entry = registry.resolveToken(chainId, symbolOrAddress)
      return entry ? [entry.address] : []
    })
    if (tokens.length > 0) chainTokenMap[chainId] = tokens
  }
  if (Object.keys(chainTokenMap).length === 0) {
    throw new Error(
      `None of [${symbols.join(', ')}] resolve on any source chain (facts v${registry.version}).`,
    )
  }
  return chainTokenMap
}

// SDK v2 takes addresses throughout `sourceAssets` — `SimpleTokenList` is
// `Address[]`, `ChainTokenMap` is `Record<chainId, Address[]>`, and
// `ExactInputConfig.address` is an `Address`. Intent files stay symbol-based,
// so every shape is resolved here.
const resolveSourceAssets = async (
  sourceAssets: SourceAssets,
  sourceChainIds: number[],
  targetChainId: number,
) => {
  // Format 1: a plain symbol list → per-chain map (see expandSymbolList).
  if (
    Array.isArray(sourceAssets) &&
    sourceAssets.every((item) => typeof item === 'string')
  ) {
    return expandSymbolList(
      sourceAssets as string[],
      sourceChainIds,
      targetChainId,
    )
  }

  // Format 3: ExactInputConfig[] → resolve chain names, token addresses, amounts
  if (Array.isArray(sourceAssets)) {
    const configs = sourceAssets as {
      chain: string
      token: string
      amount?: string
    }[]
    const resolved = []
    for (const config of configs) {
      const chain = getChain(config.chain)
      const entry: { chain: typeof chain; address: string; amount?: bigint } = {
        chain,
        address: await resolveTokenAddress({
          tokenSymbolOrAddress: config.token,
          chainId: chain.id,
        }),
      }
      if (config.amount) {
        const decimals = await getDecimals({
          tokenSymbolOrAddress: config.token,
          chainId: chain.id,
        })
        entry.amount = parseUnits(config.amount, decimals)
      }
      resolved.push(entry)
    }
    return resolved
  }

  // Format 2: Record<string, string[]> → ChainTokenMap (chain name keys → chain ID keys)
  const chainTokenMap: Record<number, string[]> = {}
  for (const [chainName, tokens] of Object.entries(sourceAssets)) {
    const chain = getChain(chainName)
    chainTokenMap[chain.id] = await Promise.all(
      tokens.map((token) =>
        resolveTokenAddress({ tokenSymbolOrAddress: token, chainId: chain.id }),
      ),
    )
  }
  return chainTokenMap
}

/**
 * The legacy `sourceTokens` field, resolved to addresses for SDK v2. Kept
 * separate from `resolveSourceAssets` because its object form is keyed by a
 * bare `{ id }` rather than a chain name.
 */
const resolveLegacySourceTokens = async (
  sourceTokens: SourceTokens,
  sourceChainIds: number[],
  targetChainId: number,
) => {
  if (sourceTokens.every((token) => typeof token === 'string')) {
    return expandSymbolList(
      sourceTokens as string[],
      sourceChainIds,
      targetChainId,
    )
  }

  const entries = sourceTokens as {
    chain: { id: number }
    address: string
    amount?: string
  }[]
  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      address: await resolveTokenAddress({
        tokenSymbolOrAddress: entry.address,
        chainId: entry.chain.id,
      }),
    })),
  )
}

/** Resolve human-friendly auxiliaryFunds to SDK format. Keys must be addresses. */
const resolveAuxiliaryFunds = async (
  funds: Record<string, Record<string, string>>,
): Promise<AuxiliaryFunds> => {
  const result: AuxiliaryFunds = {}
  for (const [chainName, tokens] of Object.entries(funds)) {
    const chain = getChain(chainName)
    const tokenEntries: Record<Address, bigint> = {}
    for (const [tokenKey, amount] of Object.entries(tokens)) {
      if (!isAddress(tokenKey)) {
        throw new Error(
          `auxiliaryFunds for ${chainName}: '${tokenKey}' must be an address (symbols not supported here)`,
        )
      }
      const decimals = await getDecimals({
        tokenSymbolOrAddress: tokenKey,
        chainId: chain.id,
      })
      tokenEntries[tokenKey as Address] = parseUnits(amount, decimals)
    }
    result[chain.id] = tokenEntries
  }
  return result
}

/**
 * An empty `sourceAssets` means "not specified", never "consider no assets".
 *
 * Both shapes it can take are truthy when empty, so a plain
 * `intent.sourceAssets ? ... : fallback` takes the first branch and never
 * reaches the documented `sourceTokens` fallback. Neither resulting failure
 * names the fixture as the cause:
 *
 *   []  is vacuously a symbol list, so it reaches `expandSymbolList` and
 *       throws "None of [] resolve on any source chain (facts vX)", which
 *       reads as a chain-registry problem.
 *   {}  resolves to an empty chain->token map, which the orchestrator treats
 *       as NO constraint rather than an empty one, so the intent is planned
 *       against every balance the fixture meant to exclude -- including the
 *       destination's own, which then refuses it as ALREADY_FUNDED.
 */
const presentSourceAssets = (
  sourceAssets: SourceAssets | undefined,
): SourceAssets | undefined =>
  sourceAssets && Object.keys(sourceAssets).length > 0
    ? sourceAssets
    : undefined

/** Extract token symbols from sourceAssets for local testnet funding */
const extractFundingTokens = (sourceAssets: SourceAssets): string[] => {
  // string[] format: tokens are already symbols
  if (
    Array.isArray(sourceAssets) &&
    sourceAssets.every((item) => typeof item === 'string')
  ) {
    return sourceAssets as string[]
  }

  // ExactInputConfig[] format: extract token fields
  if (Array.isArray(sourceAssets)) {
    const configs = sourceAssets as {
      chain: string
      token: string
      amount?: string
    }[]
    return [...new Set(configs.map((c) => c.token))]
  }

  // Record<string, string[]> format: collect all unique token symbols
  return [...new Set(Object.values(sourceAssets).flat())]
}

export const createRhinestoneAccount = async (
  environmentString: string,
  accountType: 'smart' | 'eoa' = 'smart',
) => {
  const owner = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY! as Hex)
  const environment = getEnvironment(environmentString)
  const rhinestone = new RhinestoneSDK({
    apiKey: environment.apiKey,
    endpointUrl: environment.url,
    useDevContracts: environment.useDevContracts,
    provider: { type: 'custom', urls: SDK_RPC_OVERRIDES },
  })

  if (accountType === 'eoa') {
    return rhinestone.createAccount({
      eoa: owner,
      account: {
        type: 'eoa' as const,
      },
    })
  }

  return rhinestone.createAccount({
    owners: {
      type: 'ecdsa' as const,
      accounts: [owner],
    },
    // Pinned explicitly rather than left to the SDK default, because the
    // account address is derived from this descriptor: SDK v2 moved the default
    // from Nexus 1.2.0 to 1.2.1, which silently re-derives every account to a
    // new address and shows up as `No balances available` on an account that is
    // provably funded on-chain. Naming the version means the next default bump
    // is a visible diff here, not a stranded test account.
    //
    // Test float was migrated 1.2.0 → 1.2.1 on 2026-08-06:
    //   prod 0x5893b690…291CF → 0x5F52cca9…2446c
    //   dev  0x4326Ae48…1a428 → 0x23c66979…2A4CE
    account: { type: 'nexus' as const, version: '1.2.1' as const },
  })
}

export type RhinestoneAccount = Awaited<
  ReturnType<typeof createRhinestoneAccount>
>

type Quote = PreparedQuotes['all'][number]

const pickQuoteInteractively = async (
  quotes: PreparedQuotes,
): Promise<Quote> => {
  if (quotes.all.length === 1) {
    return quotes.all[0]
  }
  const choice = await select<string>({
    message: 'Pick a route',
    choices: quotes.all.map((quote) => {
      const isBest = quote.intentId === quotes.best.intentId
      return {
        name: `${isBest ? '*' : ' '} ${quote.settlementLayer} — ${quote.estimatedFillTime.seconds}s — $${quote.cost.fees.total.usd}`,
        value: quote.intentId,
      }
    }),
  })
  return quotes.all.find((q) => q.intentId === choice) ?? quotes.best
}

const pickQuote = async (
  quotes: PreparedQuotes,
  selection: string,
): Promise<Quote> => {
  if (selection === 'best') return quotes.best
  if (selection === 'interactive') return pickQuoteInteractively(quotes)

  const layer = selection.toUpperCase()
  const match = quotes.all.find(
    (q) => q.settlementLayer.toUpperCase() === layer,
  )
  if (!match) {
    const available = [...new Set(quotes.all.map((q) => q.settlementLayer))]
    throw new Error(
      `No route found for settlement layer '${selection}'. Available: ${available.join(', ')}`,
    )
  }
  return match
}

export const processIntent = async (
  intent: Intent,
  environmentString: string,
  executionMode: string,
  existingAccount?: RhinestoneAccount,
  verbose?: boolean,
  quoteSelection: string = 'best',
): Promise<IntentResult | undefined> => {
  const rhinestoneAccount =
    existingAccount ?? (await createRhinestoneAccount(environmentString))

  // get the target chain and source chains
  const targetChain = getChain(intent.targetChain)
  const sourceChains =
    intent.sourceChains.length > 0
      ? intent.sourceChains.map((chain) => getEvmChain(chain))
      : []

  // fund the account
  const accountAddress = rhinestoneAccount.getAddress()
  const sourceAssets = presentSourceAssets(intent.sourceAssets)
  const fundingTokens = intent.sourceTokens?.length
    ? intent.sourceTokens
    : sourceAssets
      ? extractFundingTokens(sourceAssets)
      : []
  await fundAccount({
    account: accountAddress,
    sourceChains: intent.sourceChains,
    sourceTokens: fundingTokens,
  })

  // get the target address
  const target = intent.tokenRecipient as Address

  const targetTokens: ParsedToken[] = []
  for (const targetToken of intent.targetTokens) {
    const parsed: ParsedToken = {
      symbol: targetToken.symbol,
      ...(isAddress(targetToken.symbol)
        ? { address: targetToken.symbol as Address }
        : {}),
      resolvedAddress: await resolveTokenAddress({
        tokenSymbolOrAddress: targetToken.symbol,
        chainId: targetChain.id,
      }),
    }

    if (targetToken.amount) {
      parsed.amount = await convertTokenAmount({
        token: targetToken,
        chainId: targetChain.id,
      })
    }

    targetTokens.push(parsed)
  }

  // prepare the calls for the target chain. Build a real ERC20 transfer only
  // when the user gave an address; symbol-only intents fall through to a
  // no-op call (the orchestrator's routing is what we're testing).
  const canBuildErc20Transfer = (token: ParsedToken) =>
    token.amount !== undefined &&
    (token.symbol === 'ETH' || token.address !== undefined)
  // Descriptor-addressed destinations (Solana, Tron, HyperCore) are
  // solver-mediated: the SDK rejects an intent that carries destination calls for
  // them, so emit none regardless of `destinationOps`. Without this, the only
  // thing standing between a descriptor target and a pre-route failure is the
  // caller remembering `destinationOps: false` in the fixture.
  const calls =
    intent.destinationOps === false || isNonEvmChain(targetChain.id)
      ? []
      : targetTokens.length && targetTokens.every(canBuildErc20Transfer)
        ? targetTokens.map((token: ParsedToken) => {
            return {
              to: token.symbol === 'ETH' ? target : (token.address as Address),
              value: token.symbol === 'ETH' ? token.amount : 0n,
              data:
                token.symbol === 'ETH'
                  ? ('0x' as Hex)
                  : encodeFunctionData({
                      abi: erc20Abi,
                      functionName: 'transfer',
                      args: [target, token.amount!],
                    }),
            }
          })
        : [
            {
              to: zeroAddress,
              data: '0x69696969',
            },
          ]

  // prepare the token requests. SDK v2 requires a hex address on EVM chains
  // (symbols are rejected outright), so use the registry-resolved address.
  const tokenRequests = targetTokens.map((token: ParsedToken) => {
    const address = (token.resolvedAddress ?? token.symbol) as Address
    if (token.amount) {
      return { address, amount: token.amount }
    }

    return { address }
  })

  // prepare the source assets label
  const sourceAssetsLabel =
    intent.sourceChains.length > 0
      ? intent.sourceChains
          .map((chain) => {
            if (!intent.sourceTokens || intent.sourceTokens.length === 0) {
              return `${chain.slice(0, 3).toLowerCase()}.*`
            }
            return intent.sourceTokens
              .map((token) =>
                typeof token === 'string'
                  ? `${chain.slice(0, 3).toLowerCase()}.${token}`
                  : `${chain.slice(0, 3).toLowerCase()}.${token.address}`,
              )
              .join(', ')
          })
          .join(' | ')
      : (intent.sourceTokens || [])
          .map((t) => (typeof t === 'string' ? t : t.address))
          .join(', ')

  // prepare the target assets label
  const targetAssetsLabel = intent.targetTokens
    .map(
      (token) =>
        `${token.amount || 'Total Balance'} ${intent.targetChain
          .slice(0, 3)
          .toLowerCase()}.${token.symbol.toLowerCase()}`,
    )
    .join(', ')

  // prepare the recipient label
  const recipientLabel = intent.tokenRecipient
    ? intent.tokenRecipient.slice(0, 6)
    : 'self'

  const settlementLayersLabel = intent.settlementLayers
    ? 'include' in intent.settlementLayers
      ? ` via ${intent.settlementLayers.include.join()}`
      : ` excluding ${intent.settlementLayers.exclude.join()}`
    : ''
  const appFeeLabel = intent.appFees
    ? ` +${intent.appFees.feeBps}bps appFee`
    : ''
  const bundleLabel = `${sourceAssetsLabel} > ${targetAssetsLabel}${settlementLayersLabel}${intent.sponsored ? ' sponsored' : ''}${appFeeLabel} to ${recipientLabel}`

  console.log(`${ts()} Bundle ${bundleLabel}: Starting transaction process`)

  // ----- Phase 1: Prepare transaction
  const prepareStartTime = Date.now()
  console.log(`${ts()} Bundle ${bundleLabel}: [1/4] Preparing transaction...`)

  // resolve source assets: prefer sourceAssets over sourceTokens
  const resolvedSourceAssets = sourceAssets
    ? await resolveSourceAssets(
        sourceAssets,
        sourceChains.map((chain) => chain.id),
        targetChain.id,
      )
    : intent.sourceTokens?.length
      ? await resolveLegacySourceTokens(
          intent.sourceTokens,
          sourceChains.map((chain) => chain.id),
          targetChain.id,
        )
      : undefined

  // resolve auxiliary funds if provided
  const resolvedAuxiliaryFunds = intent.auxiliaryFunds
    ? await resolveAuxiliaryFunds(intent.auxiliaryFunds)
    : undefined

  const transactionDetails = {
    sourceChains: sourceChains.length > 0 ? sourceChains : undefined,
    targetChain: toSdkDestinationChain(targetChain),
    calls,
    tokenRequests,
    sponsored: intent.sponsored,
    ...(resolvedSourceAssets ? { sourceAssets: resolvedSourceAssets } : {}),
    ...(intent.settlementLayers
      ? { settlementLayers: intent.settlementLayers }
      : {}),
    ...(intent.recipient ? { recipient: intent.recipient as Address } : {}),
    ...(intent.feeAsset ? { feeAsset: intent.feeAsset } : {}),
    ...(intent.appFees ? { appFees: intent.appFees } : {}),
    ...(resolvedAuxiliaryFunds
      ? { auxiliaryFunds: resolvedAuxiliaryFunds }
      : {}),
  }

  // SDK's `Transaction` is a discriminated union (SameChain | CrossChainEvm |
  // CrossChainNonEvm) keyed on the `targetChain` / `tokenRequests` shape.
  // The intent JSON we read is permissive and chain-agnostic, so we build a
  // single shape and let the SDK route it at runtime.
  const preparedTransaction = await rhinestoneAccount.prepareTransaction(
    transactionDetails as Transaction,
  )

  const prepareEndTime = Date.now()
  console.log(
    `${ts()} Bundle ${bundleLabel}: [1/4] Prepared in ${
      prepareEndTime - prepareStartTime
    }ms`,
  )

  const { best, all } = preparedTransaction.quotes
  console.log(
    `${ts()} Bundle ${bundleLabel}: [1/4] Got ${all.length} route(s); best: ${best.intentId} via ${best.settlementLayer}`,
  )

  if (verbose) {
    console.log(
      `${ts()} Bundle ${bundleLabel}: [verbose] all routes (${all.length}):`,
    )
    all.forEach((quote, i) => {
      const marker = quote.intentId === best.intentId ? '*' : ' '
      console.log(
        `${ts()} Bundle ${bundleLabel}: [verbose] ${marker} [${i}] ${quote.settlementLayer} (intentId=${quote.intentId}, fillTime=${quote.estimatedFillTime.seconds}s, fees=$${quote.cost.fees.total.usd})`,
      )
      console.log(
        `${ts()} Bundle ${bundleLabel}: [verbose] app fee: $${quote.cost.fees.breakdown.app?.usd ?? 0}`,
      )
      const {
        signData: _signData,
        tokenRequirements: _tokenRequirements,
        ...rest
      } = quote
      console.dir(rest, { depth: null })
    })
  }

  const chosenQuote = await pickQuote(
    preparedTransaction.quotes,
    quoteSelection,
  )
  if (chosenQuote.intentId !== best.intentId) {
    console.log(
      `${ts()} Bundle ${bundleLabel}: [1/4] Selected non-best route: ${chosenQuote.settlementLayer} (intentId=${chosenQuote.intentId})`,
    )
  }
  // Capture the post-picker timestamp so interactive wait time doesn't get
  // attributed to the sign phase (or the total).
  const pickEndTime = Date.now()
  const pickerElapsed = pickEndTime - prepareEndTime

  if (executionMode === 'route') {
    console.log(
      `${ts()} Bundle ${bundleLabel}: Route-only mode, skipping sign/submit/execute`,
    )
    console.dir(preparedTransaction.quotes, { depth: null })
    logTimingSummary(bundleLabel, prepareEndTime - prepareStartTime, {
      route: prepareEndTime - prepareStartTime,
      sign: 0,
      submit: 0,
      execute: 0,
      index: 0,
    })
    return
  }

  // sign the transaction with signTransaction method
  console.log(`${ts()} Bundle ${bundleLabel}: [2/4] Signing transaction...`)
  const signedTransaction = await rhinestoneAccount.signTransaction(
    preparedTransaction,
    { intentId: chosenQuote.intentId },
  )

  const signEndTime = Date.now()
  console.log(
    `${ts()} Bundle ${bundleLabel}: [2/4] Signed in ${
      signEndTime - pickEndTime
    }ms`,
  )

  try {
    const submitStartTime = Date.now()
    console.log(
      `${ts()} Bundle ${bundleLabel}: [3/4] Submitting transaction...`,
    )
    const isSimulate = executionMode === 'simulate'
    // submit the transaction using the SDK
    const transactionResult = await rhinestoneAccount.submitTransaction(
      signedTransaction,
      { internal_dryRun: isSimulate },
    )

    const submitEndTime = Date.now()
    console.log(
      `${ts()} Bundle ${bundleLabel}: [3/4] Submitted in ${
        submitEndTime - submitStartTime
      }ms`,
    )

    console.log(`${ts()} Bundle ${bundleLabel}: [4/4] Waiting for execution...`)
    const executionStartTime = Date.now()
    const result = (await rhinestoneAccount.waitForExecution(
      transactionResult,
    )) as IntentResult
    const executionEndTime = Date.now()

    result.label = bundleLabel
    const allOps = getAllOperations(result)
    let fillTimestamp = executionEndTime
    for (const op of allOps) {
      // Non-EVM chains have no viem RPC — skip receipt enrichment there.
      // Bundle status tracking for non-EVM dests is tracked separately (RHI-3797).
      if (!isSimulate && op.hash && !isNonEvmChain(op.chainId)) {
        // Against the local stack, on-chain reads must hit the anvil fork RPC,
        // not viem's default public mainnet RPC — otherwise a tx that only
        // exists on the fork is "not found". Use waitForTransactionReceipt so
        // receipt enrichment doesn't race the block (the intent already reached
        // a terminal state via waitForExecution above).
        const forkRpcUrl =
          environmentString === 'local'
            ? getLocalForkRpcUrl(op.chainId)
            : undefined
        const publicClient = createPublicClient({
          chain: getChainById(op.chainId),
          transport: forkRpcUrl ? http(forkRpcUrl) : http(),
        })
        const txReceipt = await publicClient.waitForTransactionReceipt({
          hash: op.hash as Hex,
        })
        op.gasUsed = txReceipt.gasUsed
        // Use the latest on-chain timestamp as the fill timestamp
        const block = await publicClient.getBlock({
          blockNumber: txReceipt.blockNumber,
        })
        const blockTime = Number(block.timestamp) * 1000
        if (blockTime > fillTimestamp) {
          fillTimestamp = blockTime
        }
      }
    }

    console.log(
      `${ts()} Bundle ${bundleLabel}: [4/4] Execution completed in ${
        fillTimestamp - executionStartTime
      }ms`,
    )
    logTimingSummary(
      bundleLabel,
      executionEndTime - prepareStartTime - pickerElapsed,
      {
        route: prepareEndTime - prepareStartTime,
        sign: signEndTime - pickEndTime,
        submit: submitEndTime - signEndTime,
        execute: fillTimestamp - executionStartTime,
        index: executionEndTime - fillTimestamp,
      },
    )

    if (verbose) {
      console.dir(result, { depth: null })
    }

    return result
  } catch (error: any) {
    console.error(
      `${ts()} Bundle ${bundleLabel}: Submission/Execution failed`,
      error?.response?.data ?? error,
    )
    if (error?.issues) {
      console.error(`${ts()} Bundle ${bundleLabel}: issues:`)
      console.dir(error.issues, { depth: null })
    }
  }
}
