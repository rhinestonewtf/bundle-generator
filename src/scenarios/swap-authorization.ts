import { decodeFunctionData, type Hex, toFunctionSelector } from 'viem'

/**
 * ABI copied from compact-utils `SwapAdapter.sol`
 * (`src/swapper/SwapAdapter.sol` on `feat/RHI-6676-transient-swap-authorization`).
 * Only the two authorization setters are needed: they are what the destination
 * IntentExecutor element signs, so they are the on-chain economic bounds the
 * quote is promising against.
 */
const SWAP_ADAPTER_ABI = [
  {
    type: 'function',
    name: 'setExactInAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'tokenOut', type: 'address' },
      { name: 'minAmountOut', type: 'uint256' },
      { name: 'quotedAmountOut', type: 'uint256' },
      { name: 'orderRef', type: 'uint256' },
      { name: 'authorized', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setExactOutAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'amountInMax', type: 'uint256' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'quotedAmountIn', type: 'uint256' },
      { name: 'orderRef', type: 'uint256' },
      { name: 'authorized', type: 'bool' },
    ],
    outputs: [],
  },
] as const

const EXACT_IN_SELECTOR = toFunctionSelector(
  'setExactInAuthorization(address,uint256,address,uint256,uint256,uint256,bool)',
)
const EXACT_OUT_SELECTOR = toFunctionSelector(
  'setExactOutAuthorization(address,uint256,address,uint256,uint256,uint256,bool)',
)
const EXACT_IN_FILL_SELECTOR = toFunctionSelector(
  'handleFill_swapAdapter_exactIn(address,address,uint256,address,uint256,uint256,uint256,(address,uint256,bytes)[])',
)
const EXACT_OUT_FILL_SELECTOR = toFunctionSelector(
  'handleFill_swapAdapter_exactOut(address,address,uint256,address,uint256,uint256,uint256,(address,uint256,bytes)[])',
)

export type ExactInAuthorization = {
  direction: 'exact-in'
  tokenIn: string
  amountIn: bigint
  tokenOut: string
  minAmountOut: bigint
  quotedAmountOut: bigint
  orderRef: bigint
  authorized: boolean
}

export type ExactOutAuthorization = {
  direction: 'exact-out'
  tokenIn: string
  amountInMax: bigint
  tokenOut: string
  amountOut: bigint
  quotedAmountIn: bigint
  orderRef: bigint
  authorized: boolean
}

export type SwapAuthorization = ExactInAuthorization | ExactOutAuthorization

/**
 * Collects every hex string anywhere inside a signData payload.
 *
 * The authorization call is an `Execution.callData` nested inside the signed
 * destination-ops element, and the wire shape of `signData.*.message` is an
 * open `{ [key: string]: unknown }` bag — the SDK does not type its interior.
 * Walking the whole structure is deliberate: it keeps this harness working when
 * the element layout is reshaped, which is exactly the kind of change that
 * would otherwise silently stop exercising the authorization.
 */
const collectHexStrings = (node: unknown, sink: string[]): void => {
  if (typeof node === 'string') {
    if (node.startsWith('0x') && node.length >= 10) sink.push(node)
    return
  }
  if (Array.isArray(node)) {
    for (const entry of node) collectHexStrings(entry, sink)
    return
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectHexStrings(value, sink)
  }
}

const decodeOne = (data: Hex): SwapAuthorization | null => {
  const selector = data.slice(0, 10).toLowerCase()
  if (selector !== EXACT_IN_SELECTOR && selector !== EXACT_OUT_SELECTOR) {
    return null
  }
  const { functionName, args } = decodeFunctionData({
    abi: SWAP_ADAPTER_ABI,
    data,
  })
  if (functionName === 'setExactInAuthorization') {
    const [
      tokenIn,
      amountIn,
      tokenOut,
      minAmountOut,
      quotedAmountOut,
      orderRef,
      authorized,
    ] = args
    return {
      direction: 'exact-in',
      tokenIn,
      amountIn,
      tokenOut,
      minAmountOut,
      quotedAmountOut,
      orderRef,
      authorized,
    }
  }
  const [
    tokenIn,
    amountInMax,
    tokenOut,
    amountOut,
    quotedAmountIn,
    orderRef,
    authorized,
  ] = args
  return {
    direction: 'exact-out',
    tokenIn,
    amountInMax,
    tokenOut,
    amountOut,
    quotedAmountIn,
    orderRef,
    authorized,
  }
}

/**
 * Every SwapAdapter authorization the route asks the user to sign.
 *
 * An empty array means the route delivers without a destination swap — which is
 * a meaningful answer, not a failure: it is how a direct-delivery plan is told
 * apart from a bridge-plus-swap plan.
 */
export const extractSwapAuthorizations = (
  signData: unknown,
): SwapAuthorization[] => {
  const candidates: string[] = []
  collectHexStrings(signData, candidates)

  const authorizations: SwapAuthorization[] = []
  for (const candidate of candidates) {
    let decoded: SwapAuthorization | null = null
    try {
      decoded = decodeOne(candidate as Hex)
    } catch {
      // A hex blob that starts with the selector but does not decode is not an
      // authorization. Skip rather than fail: signData carries unrelated bytes.
      continue
    }
    if (decoded) authorizations.push(decoded)
  }
  return authorizations
}

/** Whether signData commits to the Router entry point matching the swap direction. */
export const hasMatchingSwapFillSelector = (
  signData: unknown,
  direction: SwapAuthorization['direction'],
): boolean => {
  const candidates: string[] = []
  collectHexStrings(signData, candidates)
  const selector =
    direction === 'exact-in' ? EXACT_IN_FILL_SELECTOR : EXACT_OUT_FILL_SELECTOR
  return candidates.some((candidate) =>
    candidate.toLowerCase().includes(selector.slice(2)),
  )
}
