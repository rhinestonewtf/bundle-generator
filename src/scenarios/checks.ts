import {
  extractSwapAuthorizations,
  hasMatchingSwapFillSelector,
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
  /** Layers the scenario wants compared, when it pins a ranking property. */
  compareLayers?: string[]
  /** Set when the orchestrator rejected the request outright. */
  error?: { status?: number; code?: string; message: string }
}

export type CheckOutcome = {
  name: string
  status: 'pass' | 'fail' | 'inapplicable'
  detail: string
}

type Check = (context: CheckContext) => CheckOutcome
export const exitCodeForOutcomes = (outcomes: CheckOutcome[]): number =>
  outcomes.some((outcome) => outcome.status !== 'pass') ? 1 : 0

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
 * RHI-6720 audit item 2.
 *
 * `amountInMax` is the hard cap the SwapAdapter pulls against, and
 * `quotedAmountIn` is the expected input at quote time. Setting the cap equal
 * to the quote leaves zero headroom: any adverse price move between quoting and
 * bridge arrival makes the pull exceed the cap and the child fill reverts
 * permanently, stranding the intermediate token.
 *
 * Fails on: amountInMax == quotedAmountIn (no headroom), or a cap below the
 * quote (immediately unfillable).
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

  const failures: string[] = []
  for (const authorization of exactOut) {
    if (authorization.amountInMax < authorization.quotedAmountIn) {
      failures.push(
        `amountInMax ${authorization.amountInMax} < quotedAmountIn ${authorization.quotedAmountIn}: unfillable at the quoted price`,
      )
      continue
    }
    if (authorization.amountInMax === authorization.quotedAmountIn) {
      failures.push(
        `amountInMax == quotedAmountIn == ${authorization.amountInMax}: zero slippage headroom, so any adverse move between quote and bridge arrival reverts the child fill permanently`,
      )
    }
  }

  return {
    name: 'exactOutInputCapHasHeadroom',
    status: failures.length === 0 ? 'pass' : 'fail',
    detail:
      failures.length === 0
        ? exactOut
            .map(
              (a) =>
                `headroom ${a.amountInMax - a.quotedAmountIn} over quoted ${a.quotedAmountIn}`,
            )
            .join('; ')
        : failures.join('; '),
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
 * Deferred destination swaps are deployable only on Base and Optimism. The
 * destination typed-data domain and every reported output must agree on one of
 * those chain ids, otherwise the scenario is exercising an unsupported chain.
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
    | { destination?: { domain?: { chainId?: number | bigint | string } } }
    | undefined
  const chainId = Number(signData?.destination?.domain?.chainId)
  if (chainId !== 10 && chainId !== 8453) {
    return {
      name: 'swapRunsOnSupportedDestination',
      status: 'fail',
      detail: `destination signData chain ${Number.isFinite(chainId) ? chainId : 'missing'} is not Base (8453) or Optimism (10)`,
    }
  }
  const wrongOutputs = (context.best.cost?.output ?? []).filter(
    (output) => output.chainId !== undefined && output.chainId !== chainId,
  )
  return {
    name: 'swapRunsOnSupportedDestination',
    status: wrongOutputs.length === 0 ? 'pass' : 'fail',
    detail:
      wrongOutputs.length === 0
        ? `authorization and delivered output are scoped to chain ${chainId}`
        : `reported output chain disagrees with destination chain ${chainId}`,
  }
}

/** The signed execution must invoke the Router handler matching its authorization. */
const routerExecutesAuthorizedSwap: Check = (context) => {
  const authorizations = swapAuthorizationsOf(context.best)
  if (authorizations.length === 0) {
    return {
      name: 'routerExecutesAuthorizedSwap',
      status: 'fail',
      detail:
        'required deferred-swap route carries no SwapAdapter authorization',
    }
  }
  const missing = authorizations.filter(
    (authorization) =>
      !hasMatchingSwapFillSelector(
        context.best.signData,
        authorization.direction,
      ),
  )
  return {
    name: 'routerExecutesAuthorizedSwap',
    status: missing.length === 0 ? 'pass' : 'fail',
    detail:
      missing.length === 0
        ? 'signed execution includes the matching Router SwapAdapter handler'
        : `missing Router handler for ${missing.map((item) => item.direction).join(', ')}`,
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
 * RHI-6720 audit item 7.
 *
 * A max-out plan whose output notional is scored as zero absorbs the full
 * output-forgone penalty in the plan selector and can never rank first. The
 * observable consequence is a layer that returns a route but is never ranked
 * competitively against a peer on the same request.
 *
 * Fails on: a compared layer returns a route that reports a delivered amount,
 * yet is ranked below a peer while reporting strictly more output for a lower
 * fee — an ordering no cost model can justify.
 */
const maxOutPlanIsRankable: Check = (context) => {
  const compare = context.compareLayers ?? []
  const present = compare.filter((layer) =>
    context.routes.some((route) => route.settlementLayer === layer),
  )
  if (present.length < 2) {
    return {
      name: 'maxOutPlanIsRankable',
      status: 'inapplicable',
      detail: `need routes from at least 2 of [${compare.join(', ')}], got [${present.join(', ')}]`,
    }
  }

  const totalOutput = (route: RouteLike): bigint =>
    (route.cost?.output ?? []).reduce(
      (sum, entry) =>
        sum + (entry.amount === undefined ? 0n : BigInt(entry.amount)),
      0n,
    )

  const failures: string[] = []
  for (const route of context.routes) {
    if (!compare.includes(route.settlementLayer)) continue
    const output = totalOutput(route)
    const bestOutput = totalOutput(context.best)
    const fee = route.cost?.fees?.total?.usd ?? 0
    const bestFee = context.best.cost?.fees?.total?.usd ?? 0
    if (route.intentId === context.best.intentId) continue
    if (output > bestOutput && fee <= bestFee) {
      failures.push(
        `${route.settlementLayer} delivers ${output} for $${fee} but ranked below ${context.best.settlementLayer} delivering ${bestOutput} for $${bestFee}: strictly better on both axes yet not chosen, which is the signature of a zero output notional`,
      )
    }
  }

  return {
    name: 'maxOutPlanIsRankable',
    status: failures.length === 0 ? 'pass' : 'fail',
    detail:
      failures.length === 0
        ? `ranking consistent across [${present.join(', ')}]`
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
  deliversRequestedFixedOutput,
  exactOutInputCapHasHeadroom,
  swapAuthorizationMatchesQuote,
  swapRunsOnSupportedDestination,
  routerExecutesAuthorizedSwap,
  swapFeeAndOutputAreObservable,
  maxOutPlanIsRankable,
  directDeliveryStillCompetes,
  declinesCleanlyOrPricesByAddress,
}
