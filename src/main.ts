import {
  type AuxiliaryFunds,
  getTokenAddress,
  RhinestoneSDK,
} from '@rhinestone/sdk'
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  isAddress,
  parseUnits,
  zeroAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { fundAccount } from './funding.js'
import type { Intent, ParsedToken, SourceAssets, TokenSymbol } from './types.js'
import { getChain, getChainById } from './utils/chains.js'
import { getEnvironment } from './utils/environments.js'
import { rpcTransport } from './utils/rpc.js'
import { convertTokenAmount, getDecimals } from './utils/tokens.js'

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

const resolveSourceAssets = async (sourceAssets: SourceAssets) => {
  // Format 1: string[] → SimpleTokenList, pass as-is
  if (
    Array.isArray(sourceAssets) &&
    sourceAssets.every((item) => typeof item === 'string')
  ) {
    return sourceAssets as string[]
  }

  // Format 3: ExactInputConfig[] → resolve chain names and amounts
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
        address: config.token,
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
    chainTokenMap[chain.id] = tokens
  }
  return chainTokenMap
}

/** Resolve human-friendly auxiliaryFunds to SDK format */
const resolveAuxiliaryFunds = async (
  funds: Record<string, Record<string, string>>,
): Promise<AuxiliaryFunds> => {
  const result: AuxiliaryFunds = {}
  for (const [chainName, tokens] of Object.entries(funds)) {
    const chain = getChain(chainName)
    const tokenEntries: Record<Address, bigint> = {}
    for (const [tokenSymbol, amount] of Object.entries(tokens)) {
      const address = isAddress(tokenSymbol)
        ? (tokenSymbol as Address)
        : getTokenAddress(tokenSymbol as TokenSymbol, chain.id)
      const decimals = await getDecimals({
        tokenSymbolOrAddress: tokenSymbol,
        chainId: chain.id,
      })
      tokenEntries[address] = parseUnits(amount, decimals)
    }
    result[chain.id] = tokenEntries
  }
  return result
}

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

export const createRhinestoneAccount = async (environmentString: string) => {
  const owner = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY! as Hex)
  const environment = getEnvironment(environmentString)
  const rhinestone = new RhinestoneSDK({
    apiKey: environment.apiKey,
    endpointUrl: environment.url,
    useDevContracts: environment.useDevContracts,
  })
  return rhinestone.createAccount({
    owners: {
      type: 'ecdsa' as const,
      accounts: [owner],
    },
  })
}

export type RhinestoneAccount = Awaited<
  ReturnType<typeof createRhinestoneAccount>
>

export const processIntent = async (
  intent: Intent,
  environmentString: string,
  executionMode: string,
  existingAccount?: RhinestoneAccount,
  verbose?: boolean,
) => {
  const rhinestoneAccount =
    existingAccount ?? (await createRhinestoneAccount(environmentString))

  // get the target chain and source chains
  const targetChain = getChain(intent.targetChain)
  const sourceChains =
    intent.sourceChains.length > 0
      ? intent.sourceChains.map((chain) => getChain(chain))
      : []

  // fund the account
  const accountAddress = rhinestoneAccount.getAddress()
  const fundingTokens = intent.sourceTokens?.length
    ? intent.sourceTokens
    : intent.sourceAssets
      ? extractFundingTokens(intent.sourceAssets)
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
    const target: ParsedToken = {
      symbol: targetToken.symbol,
      address: isAddress(targetToken.symbol)
        ? targetToken.symbol
        : getTokenAddress(targetToken.symbol as TokenSymbol, targetChain.id),
    }

    if (targetToken.amount) {
      target.amount = await convertTokenAmount({
        token: targetToken,
        chainId: targetChain.id,
      })
    }

    targetTokens.push(target)
  }

  // prepare the calls for the target chain
  const calls =
    intent.destinationOps === false
      ? []
      : targetTokens.length && targetTokens.every((token) => token.amount)
        ? targetTokens.map((token: ParsedToken) => {
            return {
              to: token.symbol === 'ETH' ? target : token.address,
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

  // prepare the token requests
  const tokenRequests = targetTokens.map((token: ParsedToken) => {
    if (token.amount) {
      return {
        address: token.address,
        amount: token.amount,
      }
    }

    return { address: token.address }
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
  const recipientLabel = intent.tokenRecipient.slice(0, 6)

  const bundleLabel = `${sourceAssetsLabel} > ${targetAssetsLabel}${intent.settlementLayers?.length ? ` via ${intent.settlementLayers.join()}` : ''}${intent.sponsored ? ' sponsored' : ''} to ${recipientLabel}`

  console.log(`${ts()} Bundle ${bundleLabel}: Starting transaction process`)

  // ----- Phase 1: Prepare transaction
  const prepareStartTime = Date.now()
  console.log(`${ts()} Bundle ${bundleLabel}: [1/4] Preparing transaction...`)

  // resolve source assets: prefer sourceAssets over sourceTokens
  const resolvedSourceAssets = intent.sourceAssets
    ? await resolveSourceAssets(intent.sourceAssets)
    : intent.sourceTokens?.length
      ? intent.sourceTokens
      : undefined

  // resolve auxiliary funds if provided
  const resolvedAuxiliaryFunds = intent.auxiliaryFunds
    ? await resolveAuxiliaryFunds(intent.auxiliaryFunds)
    : undefined

  const transactionDetails = {
    sourceChains: sourceChains.length > 0 ? sourceChains : undefined,
    targetChain,
    calls,
    tokenRequests,
    sponsored: intent.sponsored,
    ...(resolvedSourceAssets ? { sourceAssets: resolvedSourceAssets } : {}),
    ...(intent.settlementLayers?.length > 0
      ? { settlementLayers: intent.settlementLayers }
      : {}),
    ...(intent.recipient ? { recipient: intent.recipient as Address } : {}),
    ...(intent.feeAsset ? { feeAsset: intent.feeAsset } : {}),
    ...(resolvedAuxiliaryFunds
      ? { auxiliaryFunds: resolvedAuxiliaryFunds }
      : {}),
  }

  const preparedTransaction =
    await rhinestoneAccount.prepareTransaction(transactionDetails)

  const prepareEndTime = Date.now()
  console.log(
    `${ts()} Bundle ${bundleLabel}: [1/4] Prepared in ${
      prepareEndTime - prepareStartTime
    }ms`,
  )

  if (verbose) {
    console.log(`${ts()} Bundle ${bundleLabel}: [verbose] intentOp:`)
    console.dir(preparedTransaction.intentRoute.intentOp, { depth: null })
    console.log(`${ts()} Bundle ${bundleLabel}: [verbose] intentCost:`)
    console.dir(preparedTransaction.intentRoute.intentCost, { depth: null })
  }

  // check that sponsorship is working correctly
  if (intent.sponsored) {
    // todo: adjust type in sdk
    const sponsorFee =
      // @ts-expect-error
      preparedTransaction.intentRoute.intentCost.sponsorFee
    if (sponsorFee.relayer === 0) {
      throw new Error('Sponsorship is not supplied as expected')
    }
  }

  const quotes = preparedTransaction.intentRoute.intentOp.signedMetadata.quotes
  if (quotes) {
    for (const outerQuote of Object.values(quotes)) {
      for (const innerQuote of Object.values(outerQuote)) {
        console.log(
          `${ts()} Bundle ${bundleLabel}: [1/4] Swap detected with slippage ${
            Math.round((innerQuote as any).slippage * 100) / 100
          }%`,
        )
      }
    }
  }

  console.log(
    `${ts()} Bundle ${bundleLabel}: [1/4] Intent id: ${
      preparedTransaction.intentRoute.intentOp.nonce
    }`,
  )

  if (executionMode === 'route') {
    console.log(
      `${ts()} Bundle ${bundleLabel}: Route-only mode, skipping sign/submit/execute`,
    )
    console.dir(preparedTransaction.intentRoute, { depth: null })
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
  const signedTransaction =
    await rhinestoneAccount.signTransaction(preparedTransaction)

  const signEndTime = Date.now()
  console.log(
    `${ts()} Bundle ${bundleLabel}: [2/4] Signed in ${
      signEndTime - prepareEndTime
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
      undefined,
      isSimulate,
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
      isSimulate,
    )) as any
    const executionEndTime = Date.now()

    result.label = bundleLabel
    let fillTimestamp = executionEndTime
    if (!isSimulate && result.fill.hash) {
      const fillPublicClient = createPublicClient({
        chain: getChainById(result.fill.chainId),
        transport: rpcTransport(result.fill.chainId),
      })
      const fillTx = await fillPublicClient.getTransactionReceipt({
        hash: result.fill.hash as Hex,
      })
      const fillBlock = await fillPublicClient.getBlock({
        blockNumber: fillTx.blockNumber,
      })
      fillTimestamp = Number(fillBlock.timestamp) * 1000
      result.fill.gasUsed = fillTx.gasUsed
    }
    for (const claim of result.claims) {
      if (claim.hash) {
        const claimPublicClient = createPublicClient({
          chain: getChainById(claim.chainId),
          transport: rpcTransport(claim.chainId),
        })
        const claimTx = await claimPublicClient.getTransactionReceipt({
          hash: claim.hash as Hex,
        })
        claim.gasUsed = claimTx.gasUsed
      }
    }

    console.log(
      `${ts()} Bundle ${bundleLabel}: [4/4] Execution completed in ${
        fillTimestamp - executionStartTime
      }ms`,
    )
    logTimingSummary(bundleLabel, executionEndTime - prepareStartTime, {
      route: prepareEndTime - prepareStartTime,
      sign: signEndTime - prepareEndTime,
      submit: submitEndTime - signEndTime,
      execute: fillTimestamp - executionStartTime,
      index: executionEndTime - fillTimestamp,
    })

    console.dir(result, { depth: null })
  } catch (error: any) {
    console.error(
      `${ts()} Bundle ${bundleLabel}: Submission/Execution failed`,
      error?.response?.data ?? error,
    )
  }
}
