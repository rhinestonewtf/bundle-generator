import {
  extractSwapAuthorizations,
  type SwapAuthorization,
} from './swap-authorization.js'

/**
 * A route as the harness consumes it. Structurally a subset of the SDK's quote
 * so the harness does not depend on SDK-internal types that move between
 * versions; the fields used here are the documented Blanc wire surface.
 */
export type RouteLike = {
  intentId: string
  settlementLayer: string
  signData?: unknown
  cost?: {
    output?: {
      amount?: bigint | string
      tokenAddress?: string
      chainId?: number
    }[]
    fees?: {
      total?: { usd?: number }
      breakdown?: { swap?: { usd?: number } }
    }
  }
}

export type CheckContext = {
  /** Every route the orchestrator returned, best first. */
  routes: RouteLike[]
  /** The route the orchestrator ranked best. */
  best: RouteLike
  /** Requested output in raw token units; null for a max-out request. */
  requestedOutputAmount: bigint | null
  /** Destination chain resolved from the scenario intent. */
  targetChainId: number
  /** Layers the scenario wants compared, when it pins a ranking property. */
  compareLayers?: string[]
  /** Set when the orchestrator rejected the request outright. */
  error?: { status?: number; code?: string; message: string }
  /** Submit-time Router/on-chain simulation result for the selected route. */
  simulation?:
    | { status: 'passed'; intentId: string }
    | {
        status: 'failed'
        error: { status?: number; code?: string; message: string }
      }
}

export type CheckOutcome = {
  name: string
  status: 'pass' | 'fail' | 'inapplicable'
  detail: string
}

type Check = (context: CheckContext) => CheckOutcome
export const exitCodeForOutcomes = (outcomes: CheckOutcome[]): number =>
  outcomes.some((outcome) => outcome.status !== 'pass') ? 1 : 0

/**
 * Signing plus dry-run submission exercises POST /intents, Router payload
 * construction, SwapAdapter dispatch and on-chain simulation without broadcast.
 */
const simulationSucceeds: Check = (context) => {
  if (context.routes.length === 0) {
    return {
      name: 'simulationSucceeds',
      status: 'inapplicable',
      detail: 'no returned route to simulate',
    }
  }
  if (!context.simulation) {
    return {
      name: 'simulationSucceeds',
      status: 'fail',
      detail: 'selected route was not submitted with internal_dryRun',
    }
  }
  return context.simulation.status === 'passed'
    ? {
        name: 'simulationSucceeds',
        status: 'pass',
        detail: `selected route passed submit-time simulation without broadcast (intent ${context.simulation.intentId})`,
      }
    : {
        name: 'simulationSucceeds',
        status: 'fail',
        detail: `selected route dry-run failed: ${context.simulation.error.message}`,
      }
}
const swapAuthorizationsOf = (route: RouteLike): SwapAuthorization[] =>
  route.signData === undefined ? [] : extractSwapAuthorizations(route.signData)

/**
 * RHI-6720 audit item 1.
 *
 * For an exact-out destination swap, the authorization's `amountOut`, the
 * quote's reported delivery, and the fixture's requested raw amount describe
 * the same user-visible output. The check must compare all three: internal
 * agreement between the quote and authorization is insufficient when both
 * silently promise less than the user requested.
 *
 * Fails when the requested amount is absent, the authorization differs from
 * it, or the quote reports less than it.
 */
const deliversRequestedFixedOutput: Check = (context) => {
  const authorizations = swapAuthorizationsOf(context.best)
  const exactOut = authorizations.filter((a) => a.direction === 'exact-out')
  if (exactOut.length === 0) {
    return {
      name: 'deliversRequestedFixedOutput',
      status: 'fail',
      detail: 'required exact-out route carries no SwapAdapter authorization',
    }
  }
  if (context.requestedOutputAmount === null) {
    return {
      name: 'deliversRequestedFixedOutput',
      status: 'fail',
      detail: 'fixed-output check requires one requested output amount',
    }
  }

  const outputs = context.best.cost?.output ?? []
  const failures: string[] = []
  const requested = context.requestedOutputAmount
  for (const authorization of exactOut) {
    if (authorization.amountOut !== requested) {
      failures.push(
        `authorized amountOut ${authorization.amountOut} != requested output ${requested} for ${authorization.tokenOut}`,
      )
    }
    const matching = outputs.find(
      (entry) =>
        typeof entry.tokenAddress === 'string' &&
        entry.tokenAddress.toLowerCase() ===
          authorization.tokenOut.toLowerCase(),
    )
    if (!matching || matching.amount === undefined) {
      failures.push(
        `authorized tokenOut ${authorization.tokenOut} has no cost.output entry — the quote does not report the token it is authorized to deliver`,
      )
      continue
    }
    const quoted = BigInt(matching.amount)
    if (quoted < requested) {
      failures.push(
        `quoted delivery ${quoted} < requested output ${requested} for ${authorization.tokenOut}`,
      )
    }
  }

  return {
    name: 'deliversRequestedFixedOutput',
    status: failures.length === 0 ? 'pass' : 'fail',
    detail:
      failures.length === 0
        ? `authorization and quoted delivery preserve requested output ${requested} across ${exactOut.length} authorization(s)`
        : failures.join('; '),
  }
}

/**
 * Exact-output authorization must never cap below the executable quote.
 *
 * Approximate exact-output venues such as 1inch execute fixed-input calldata:
 * their quoted input already includes the venue's slippage allowance, so the
 * authorization cap intentionally equals that executable amount. Requiring a
 * second buffer would authorize funds the calldata cannot spend and would not
 * protect against a later market move.
 */
const exactOutInputCapHasHeadroom: Check = (context) => {
  const exactOut = swapAuthorizationsOf(context.best).filter(
    (a) => a.direction === 'exact-out',
  )
  if (exactOut.length === 0) {
    return {
      name: 'exactOutInputCapHasHeadroom',
      status: 'fail',
      detail: 'required exact-out route carries no SwapAdapter authorization',
    }
  }

  const failures = exactOut.filter(
    (authorization) => authorization.amountInMax < authorization.quotedAmountIn,
  )
  return {
    name: 'exactOutInputCapHasHeadroom',
    status: failures.length === 0 ? 'pass' : 'fail',
    detail:
      failures.length === 0
        ? exactOut
            .map(
              (authorization) =>
                `authorized cap ${authorization.amountInMax} covers executable quote ${authorization.quotedAmountIn}`,
            )
            .join('; ')
        : failures
            .map(
              (authorization) =>
                `amountInMax ${authorization.amountInMax} < quotedAmountIn ${authorization.quotedAmountIn}: immediately unfillable`,
            )
            .join('; '),
  }
}

/**
 * The authorization must be internally coherent and actually switched on.
 * A revoked (`authorized: false`) or zero-output authorization means the signed
 * bounds cannot fill.
 */
const swapAuthorizationMatchesQuote: Check = (context) => {
  const authorizations = swapAuthorizationsOf(context.best)
  if (authorizations.length === 0) {
    return {
      name: 'swapAuthorizationMatchesQuote',
      status: 'fail',
      detail:
        'required deferred-swap route carries no SwapAdapter authorization',
    }
  }

  const failures: string[] = []
  for (const authorization of authorizations) {
    if (!authorization.authorized) {
      failures.push(
        'authorization encoded with authorized=false: the fill cannot consume it',
      )
    }
    if (
      authorization.tokenIn.toLowerCase() ===
      authorization.tokenOut.toLowerCase()
    ) {
      failures.push(
        `tokenIn == tokenOut (${authorization.tokenIn}): degenerate swap`,
      )
    }
    if (authorization.direction === 'exact-out') {
      if (authorization.amountOut === 0n)
        failures.push('exact-out authorization with amountOut == 0')
      if (authorization.quotedAmountIn === 0n)
        failures.push('exact-out authorization with quotedAmountIn == 0')
    } else {
      if (authorization.amountIn === 0n)
        failures.push('exact-in authorization with amountIn == 0')
      if (authorization.quotedAmountOut === 0n)
        failures.push('exact-in authorization with quotedAmountOut == 0')
      if (authorization.minAmountOut > authorization.quotedAmountOut) {
        failures.push(
          `minAmountOut ${authorization.minAmountOut} > quotedAmountOut ${authorization.quotedAmountOut}: floor above the quote is unfillable`,
        )
      }
    }
  }

  return {
    name: 'swapAuthorizationMatchesQuote',
    status: failures.length === 0 ? 'pass' : 'fail',
    detail:
      failures.length === 0
        ? `${authorizations.length} authorization(s) coherent`
        : failures.join('; '),
  }
}

/**
 * MultiChainOps omits domain.chainId by design and binds each execution chain
 * in message.ops[].chainId. Single-chain payloads bind it in the domain.
 * The signed execution and reported output must match the scenario's requested
 * destination exactly; accepting any generally supported chain would hide a
 * source/destination placement regression.
 */
const swapRunsOnSupportedDestination: Check = (context) => {
  const authorizations = swapAuthorizationsOf(context.best)
  if (authorizations.length === 0) {
    return {
      name: 'swapRunsOnSupportedDestination',
      status: 'fail',
      detail:
        'required deferred-swap route carries no SwapAdapter authorization',
    }
  }
  const signData = context.best.signData as
    | {
        destination?: {
          domain?: { chainId?: number | bigint | string }
          primaryType?: string
          message?: { ops?: { chainId?: number | bigint | string }[] }
        }
      }
    | undefined
  const destination = signData?.destination
  const signedChainIds =
    destination?.primaryType === 'MultiChainOps'
      ? (destination.message?.ops ?? []).map((op) => Number(op.chainId))
      : [Number(destination?.domain?.chainId)]
  if (!signedChainIds.includes(context.targetChainId)) {
    return {
      name: 'swapRunsOnSupportedDestination',
      status: 'fail',
      detail: `signed destination payload targets [${signedChainIds.join(', ')}], expected chain ${context.targetChainId}`,
    }
  }
  const wrongOutputs = (context.best.cost?.output ?? []).filter(
    (output) =>
      output.chainId !== undefined && output.chainId !== context.targetChainId,
  )
  return {
    name: 'swapRunsOnSupportedDestination',
    status: wrongOutputs.length === 0 ? 'pass' : 'fail',
    detail:
      wrongOutputs.length === 0
        ? `signed execution and delivered output target requested chain ${context.targetChainId}`
        : `reported output chain disagrees with requested destination ${context.targetChainId}`,
  }
}

/** The quote must expose both delivered output and the swap fee charged for it. */
const swapFeeAndOutputAreObservable: Check = (context) => {
  const authorizations = swapAuthorizationsOf(context.best)
  if (authorizations.length === 0) {
    return {
      name: 'swapFeeAndOutputAreObservable',
      status: 'fail',
      detail:
        'required deferred-swap route carries no SwapAdapter authorization',
    }
  }
  const outputs = context.best.cost?.output ?? []
  const missing = authorizations.filter(
    (authorization) =>
      !outputs.some(
        (output) =>
          output.amount !== undefined &&
          typeof output.tokenAddress === 'string' &&
          output.tokenAddress.toLowerCase() ===
            authorization.tokenOut.toLowerCase(),
      ),
  )
  const swapFee = context.best.cost?.fees?.breakdown?.swap?.usd
  const failures: string[] = []
  if (missing.length > 0)
    failures.push(
      `${missing.length} authorized output(s) absent from cost.output`,
    )
  if (typeof swapFee !== 'number' || !Number.isFinite(swapFee) || swapFee < 0) {
    failures.push('cost.fees.breakdown.swap.usd is missing or invalid')
  }
  return {
    name: 'swapFeeAndOutputAreObservable',
    status: failures.length === 0 ? 'pass' : 'fail',
    detail:
      failures.length === 0
        ? `delivered output and $${swapFee} swap fee reported`
        : failures.join('; '),
  }
}

/**
 * A max-out candidate with zero output notional cannot participate in output
 * ranking. The quote-only observable is therefore that every compared layer
 * survives and reports positive delivered output. The default selector also
 * considers route cost and fill time, so this check does not second-guess its
 * winner from output and displayed fees alone.
 */
const maxOutPlanIsRankable: Check = (context) => {
  const compare = context.compareLayers ?? []
  const routes = context.routes.filter((route) =>
    compare.includes(route.settlementLayer),
  )
  const present = new Set(routes.map((route) => route.settlementLayer))
  const missing = compare.filter((layer) => !present.has(layer))
  const zeroOutput = routes.filter((route) =>
    (route.cost?.output ?? []).every(
      (entry) => entry.amount === undefined || BigInt(entry.amount) <= 0n,
    ),
  )
  const failures = [
    ...(missing.length > 0
      ? [`missing compared layer(s): ${missing.join(', ')}`]
      : []),
    ...(zeroOutput.length > 0
      ? [
          `zero delivered output for ${zeroOutput.map((route) => route.settlementLayer).join(', ')}`,
        ]
      : []),
  ]
  return {
    name: 'maxOutPlanIsRankable',
    status: failures.length === 0 ? 'pass' : 'fail',
    detail:
      failures.length === 0
        ? `all compared layers [${compare.join(', ')}] report positive delivered output`
        : failures.join('; '),
  }
}

/**
 * RHI-6720 audit item 5.
 *
 * A bridge that can deliver the requested token natively must still compete as
 * its no-swap plan. If preparing the deferred swap replaces the direct plan,
 * a request for a natively bridgeable token comes back only as
 * bridge-intermediate plus a destination DEX swap — strictly worse and
 * carrying swap risk the user never needed to take.
 *
 * Fails on: every returned route carries a swap authorization, i.e. no
 * direct-delivery plan survived.
 */
const directDeliveryStillCompetes: Check = (context) => {
  if (context.routes.length === 0) {
    return {
      name: 'directDeliveryStillCompetes',
      status: 'inapplicable',
      detail: 'no routes returned',
    }
  }
  const direct = context.routes.filter(
    (route) => swapAuthorizationsOf(route).length === 0,
  )
  return {
    name: 'directDeliveryStillCompetes',
    status: direct.length > 0 ? 'pass' : 'fail',
    detail:
      direct.length > 0
        ? `${direct.length}/${context.routes.length} route(s) deliver directly without a destination swap`
        : `all ${context.routes.length} route(s) carry a destination swap authorization: the direct-delivery plan was replaced rather than competing alongside`,
  }
}

/**
 * RHI-6720 audit item 3.
 *
 * An off-registry destination token must either be handled (priced by address
 * through a real deferred swap) or declined cleanly. What it must never do is
 * reach the pricing lookup unguarded and fail with a server error, nor be
 * silently treated as a registry token because its symbol string matched.
 *
 * Fails on: a 5xx response, or a TOKEN_PRICE_MISSING error code.
 */
const declinesCleanlyOrPricesByAddress: Check = (context) => {
  if (context.error) {
    const status = context.error.status ?? 0
    const isServerError = status >= 500
    const isPriceMissing = /TOKEN_PRICE_MISSING/i.test(
      `${context.error.code ?? ''} ${context.error.message}`,
    )
    if (isServerError || isPriceMissing) {
      return {
        name: 'declinesCleanlyOrPricesByAddress',
        status: 'fail',
        detail:
          `unguarded pricing lookup: status ${status || 'n/a'} ${context.error.code ?? ''} ${context.error.message}`.trim(),
      }
    }
    return {
      name: 'declinesCleanlyOrPricesByAddress',
      status: 'pass',
      detail: `declined cleanly with status ${status || 'n/a'}: ${context.error.message}`,
    }
  }
  return {
    name: 'declinesCleanlyOrPricesByAddress',
    status: 'pass',
    detail: `route planned for the off-registry token across ${context.routes.length} route(s)`,
  }
}

export const CHECKS: Record<string, Check> = {
  simulationSucceeds,
  deliversRequestedFixedOutput,
  exactOutInputCapHasHeadroom,
  swapAuthorizationMatchesQuote,
  swapRunsOnSupportedDestination,
  swapFeeAndOutputAreObservable,
  maxOutPlanIsRankable,
  directDeliveryStillCompetes,
  declinesCleanlyOrPricesByAddress,
}
