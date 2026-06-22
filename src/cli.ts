import * as fs from 'node:fs'
import path from 'node:path'
import { checkbox, confirm, input, select } from '@inquirer/prompts'
import type { SettlementLayer } from '@rhinestone/sdk'
import { type Address, type Chain, type Hex, isAddress, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as viemChains from 'viem/chains'
import type { Intent } from './types.js'
import { getDecimals } from './utils/tokens.js'

// Mirrors the SDK's internal cross-chain layer list, which isn't exported as a
// runtime value. Keep in sync with @rhinestone/sdk's KNOWN_SETTLEMENT_LAYERS.
const KNOWN_SETTLEMENT_LAYERS = [
  'ACROSS',
  'ECO',
  'RELAY',
  'OFT',
  'NEAR',
  'RHINO',
  'CCTP',
] as const satisfies readonly SettlementLayer[]

const isKnownSettlementLayer = (v: unknown): v is SettlementLayer =>
  typeof v === 'string' &&
  (KNOWN_SETTLEMENT_LAYERS as readonly string[]).includes(v)

// A raw array of layer names is the historical (buggy) shape: the SDK silently
// treats it as `{ exclude: undefined }` and matches all layers. Reject it so the
// trap can't be reintroduced.
const validateSettlementLayers = (raw: unknown, context: string): void => {
  if (raw === undefined) return
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `${context}: invalid \`settlementLayers\` shape — expected \`{ "include": [...] }\` or \`{ "exclude": [...] }\` (or omit the field), got ${JSON.stringify(raw)}.`,
    )
  }
  const hasInclude = 'include' in raw
  const hasExclude = 'exclude' in raw
  if (hasInclude === hasExclude) {
    throw new Error(
      `${context}: \`settlementLayers\` must specify exactly one of \`include\` or \`exclude\`.`,
    )
  }
  const key = hasInclude ? 'include' : 'exclude'
  const values = (raw as Record<string, unknown>)[key]
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      `${context}: \`settlementLayers.${key}\` must be a non-empty array.`,
    )
  }
  for (const v of values) {
    if (!isKnownSettlementLayer(v)) {
      throw new Error(
        `${context}: unknown settlement layer \`${String(v)}\` in \`settlementLayers.${key}\`. Known: ${KNOWN_SETTLEMENT_LAYERS.join(', ')}.`,
      )
    }
  }
}

const validateIntent = (intent: unknown, context: string): void => {
  if (!intent || typeof intent !== 'object') {
    throw new Error(`${context}: intent must be an object.`)
  }
  validateSettlementLayers(
    (intent as { settlementLayers?: unknown }).settlementLayers,
    context,
  )
}

const readIntentFile = (filePath: string) => {
  try {
    const data = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(data)
    const intents: unknown[] = parsed?.intentList ?? [parsed]
    for (let i = 0; i < intents.length; i++) {
      validateIntent(intents[i], `${filePath}[${i}]`)
    }
    return parsed
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`)
    }
    throw error
  }
}

export const collectUserInput = async (): Promise<{
  intent: Intent
  saveAsFileName?: string
  environment: string
  executionMode: string
}> => {
  const environment = await select({
    message: 'Select the environments to use',
    choices: [
      { name: 'Prod', value: 'prod' },
      { name: 'Dev', value: 'dev' },
      { name: 'Local', value: 'local' },
    ],
  })

  const normalizeName = (str: string) => str.replace(/ /g, '')
  const uniqueViemChains = Object.values(viemChains).reduce((acc, chain) => {
    if (typeof chain !== 'object' || !('id' in chain)) return acc
    if (!acc.has(chain.id)) acc.set(chain.id, chain)
    return acc
  }, new Map<number, Chain>())

  const chainConfig = Array.from(uniqueViemChains.values()).map((chain) => ({
    name: chain.name,
    chain: chain,
  }))

  const choices = chainConfig.map(({ name, chain }) => ({
    name: name,
    value: normalizeName(chain.name),
  }))

  const targetChain = await select({
    message: `Select a target chain`,
    choices,
  })

  const targetTokens = await checkbox({
    message: 'Select tokens to transfer on the target chain',
    choices: [
      { name: 'ETH', value: 'ETH' },
      { name: 'WETH', value: 'WETH' },
      { name: 'USDC', value: 'USDC' },
      { name: 'USDT', value: 'USDT' },
      { name: 'USDT0', value: 'USDT0' },
      { name: 'Arbitrary token', value: 'Arbitrary token' },
    ],
    validate: (choices) => {
      if (
        targetChain === 'Polygon' &&
        choices.some(({ value }) => value === 'ETH')
      ) {
        return 'ETH is not acceptable for Polygon target'
      }

      return true
    },
    required: true,
  })

  const abritraryTokenIndex = targetTokens.indexOf('Arbitrary token')

  if (abritraryTokenIndex >= 0) {
    const arbitraryTokenAddress = await input({
      message: 'Insert arbitrary target token address',
      validate: (input) => isAddress(input),
    })

    targetTokens[abritraryTokenIndex] = arbitraryTokenAddress
  }

  const formattedTargetTokens: { symbol: string; amount?: string }[] =
    targetTokens.map((symbol) => {
      return {
        symbol,
      }
    })

  for (const token of formattedTargetTokens) {
    const amount = await input({
      message: `Amount of ${token.symbol} (if arbitrary token, pass amount with correct decimal notation)`,
    })
    if (amount !== '') token.amount = amount
  }

  const sourceChains = await checkbox({
    message: `Select source chains (optional)`,
    choices,
  })

  const sourceTokens = await checkbox({
    message: 'Select source tokens to use (optional)',
    choices: [
      { name: 'ETH', value: 'ETH' },
      { name: 'WETH', value: 'WETH' },
      { name: 'USDC', value: 'USDC' },
      { name: 'USDT', value: 'USDT' },
      { name: 'USDT0', value: 'USDT0' },
      { name: 'Arbitrary token', value: 'Arbitrary token' },
    ],
    validate: (choices) => {
      if (
        sourceChains.length === 1 &&
        sourceChains[0] === 'Polygon' &&
        choices.some(({ value }) => value === 'ETH')
      ) {
        return 'Polygon being the only sorce and having ETH as a token is not valid'
      }

      return true
    },
  })

  const arbitrarySourceTokenIndex = sourceTokens.indexOf('Arbitrary token')

  if (arbitrarySourceTokenIndex >= 0) {
    const arbitrarySourceTokenAddress = await input({
      message: 'Insert arbitrary source token address',
      validate: (input) => isAddress(input),
    })

    sourceTokens[arbitrarySourceTokenIndex] = arbitrarySourceTokenAddress
  }

  const sourceTokensWithAmount: {
    chain: { id: number }
    address: string
    amount?: string
  }[] = []

  let sourceAssetsConfig:
    | string[]
    | Record<string, string[]>
    | { chain: string; token: string; amount?: string }[]
    | undefined

  if (sourceChains.length > 0 && sourceTokens.length > 0) {
    const sourceAssetFormat = await select({
      message: 'How do you want to configure source assets?',
      choices: [
        {
          name: 'Simple token list (same tokens across all chains)',
          value: 'simple',
        },
        {
          name: 'Per-chain token map (different tokens per chain)',
          value: 'chainMap',
        },
        { name: 'Exact inputs with amounts', value: 'exact' },
        { name: 'Legacy format (sourceTokens)', value: 'legacy' },
      ],
    })

    if (sourceAssetFormat === 'simple') {
      sourceAssetsConfig = sourceTokens
    } else if (sourceAssetFormat === 'chainMap') {
      const chainTokenMap: Record<string, string[]> = {}
      for (const chainName of sourceChains) {
        const tokensForChain = await checkbox({
          message: `Select source tokens for ${chainName}`,
          choices: [
            { name: 'ETH', value: 'ETH' },
            { name: 'WETH', value: 'WETH' },
            { name: 'USDC', value: 'USDC' },
            { name: 'USDT', value: 'USDT' },
            { name: 'USDT0', value: 'USDT0' },
          ],
        })
        if (tokensForChain.length > 0) {
          chainTokenMap[chainName] = tokensForChain
        }
      }
      sourceAssetsConfig = chainTokenMap
    } else if (sourceAssetFormat === 'exact') {
      const exactConfigs: { chain: string; token: string; amount?: string }[] =
        []
      for (const chainName of sourceChains) {
        for (const tokenSymbol of sourceTokens) {
          const amountStr = await input({
            message: `Amount of ${tokenSymbol} to pull from ${chainName} (leave empty for no limit)`,
          })
          const config: { chain: string; token: string; amount?: string } = {
            chain: chainName,
            token: tokenSymbol,
          }
          if (amountStr !== '' && amountStr !== '0') {
            config.amount = amountStr
          }
          exactConfigs.push(config)
        }
      }
      sourceAssetsConfig = exactConfigs
    } else {
      // Legacy format
      const shouldConfigureAmounts = await select({
        message: 'Do you want to specify exact amounts for source tokens?',
        choices: [
          { name: 'Yes', value: true },
          { name: 'No', value: false },
        ],
      })

      if (shouldConfigureAmounts) {
        const chainMap = Object.fromEntries(
          chainConfig.map(({ chain }) => [normalizeName(chain.name), chain]),
        )

        for (const chainName of sourceChains) {
          const chain = chainMap[chainName]
          if (!chain) continue

          for (const tokenSymbol of sourceTokens) {
            const amountStr = await input({
              message: `Amount of ${tokenSymbol} to pull from ${chain.name}`,
            })

            const sourceWithAmount: {
              chain: { id: number }
              address: string
              amount?: string
            } = {
              chain: { id: chain.id },
              address: tokenSymbol,
            }

            if (amountStr !== '' && amountStr !== '0') {
              const tokenDecimals = await getDecimals({
                tokenSymbolOrAddress: tokenSymbol,
                chainId: chain.id,
              })
              sourceWithAmount.amount = parseUnits(
                amountStr,
                tokenDecimals,
              ).toString()
            }

            sourceTokensWithAmount.push(sourceWithAmount)
          }
        }
      }
    }
  }

  const settlementLayers = await checkbox({
    message: 'Select settlement layers to use (optional)',
    choices: [
      {
        name: 'Across',
        value: 'ACROSS',
      },
      {
        name: 'Eco',
        value: 'ECO',
      },
      {
        name: 'Relay',
        value: 'RELAY',
      },
    ],
  })

  const sponsored = await select({
    message: 'Do you want to sponsor this intent',
    choices: [
      {
        name: 'Yes',
        value: true,
      },
      {
        name: 'No',
        value: false,
      },
    ],
  })

  const feeAsset = await input({
    message:
      'Fee asset token symbol or address (optional, e.g. USDC, ETH, or 0x...)',
  })

  const recipient = await input({
    message: 'Recipient address for the orchestrator (optional, address)',
  })

  const tokenRecipient = await input({
    message: 'Recipient address for tokens on the target chain',
    default:
      process.env.DEFAULT_TOKEN_RECIPIENT ??
      privateKeyToAccount(process.env.OWNER_PRIVATE_KEY! as Hex).address,
  })

  const filterTokens = (chain: string, sourceTokens: string[]) => {
    switch (chain) {
      case 'Polygon':
        return sourceTokens.filter((token) => token !== 'ETH')
      case 'Sonic':
        return sourceTokens.filter(
          (token) => token === 'USDC' || isAddress(token),
        )
      default:
        return sourceTokens
    }
  }

  const sourceAssets = sourceChains
    .map((chain) => {
      const chainPrefix = chain.slice(0, 3).toLowerCase()
      const filteredTokens = filterTokens(chain, sourceTokens)
      return `${chainPrefix}.${filteredTokens.join(`, ${chainPrefix}.`)}`
    })
    .join(', ')
  const targetAssets = `${formattedTargetTokens
    .map((token) => `${targetChain.slice(0, 3).toLowerCase()}.${token.symbol}`)
    .join(',')}`
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 13)

  const filename = await input({
    message:
      "Enter the .json filename to save the intent to, or 'no' / 'n' to not save\n(Note: You can continually add more intents to an existing file)",
    default: `${sourceAssets} to ${targetAssets} ${timestamp}`,
  })

  const sanitizedFilename = filename.replace(/\.json$/, '')
  const saveAsFileName = `${sanitizedFilename}.json`

  const executionMode = await select({
    message: 'Do you want to execute the intent or simulate it?',
    choices: [
      {
        name: 'Execute',
        value: 'execute',
      },
      { name: 'Simulate', value: 'simulate' },
      { name: 'Route', value: 'route' },
    ],
  })

  return {
    intent: {
      targetChain,
      targetTokens: formattedTargetTokens,
      sourceChains,
      sourceTokens: sourceTokensWithAmount.length
        ? sourceTokensWithAmount
        : sourceTokens,
      ...(sourceAssetsConfig ? { sourceAssets: sourceAssetsConfig } : {}),
      tokenRecipient,
      ...(recipient ? { recipient } : {}),
      ...(settlementLayers.length > 0
        ? {
            settlementLayers: {
              include: settlementLayers as SettlementLayer[],
            },
          }
        : {}),
      sponsored,
      ...(feeAsset ? { feeAsset } : {}),
    },
    saveAsFileName,
    environment,
    executionMode,
  }
}

export const parseAccountType = (): 'smart' | 'eoa' => {
  const args = process.argv
  const isAccountTypeSet = args.includes('--account-type')
  const accountType = isAccountTypeSet
    ? args[args.indexOf('--account-type') + 1]
    : (process.env.ACCOUNT_TYPE ?? 'smart')

  if (accountType !== 'smart' && accountType !== 'eoa') {
    console.error(
      `Error: --account-type must be 'smart' or 'eoa', got '${accountType}'`,
    )
    process.exit(1)
  }

  return accountType as 'smart' | 'eoa'
}

const VALID_ENVIRONMENTS = ['prod', 'dev', 'local'] as const
type EnvironmentValue = (typeof VALID_ENVIRONMENTS)[number]

const isEnvironmentValue = (v: string): v is EnvironmentValue =>
  (VALID_ENVIRONMENTS as readonly string[]).includes(v)

const getFlagValue = (flag: string): string | undefined => {
  const args = process.argv
  const idx = args.indexOf(flag)
  if (idx === -1) return undefined
  return args[idx + 1]
}

/**
 * Resolve the target environment from the `--env` flag, falling back to an
 * interactive prompt when the flag is absent. Exits with a clear error if the
 * flag is set to an unknown value so non-interactive runs fail fast.
 */
export const parseEnvironment = async (): Promise<string> => {
  if (process.argv.includes('--env')) {
    const value = getFlagValue('--env')
    if (!value || !isEnvironmentValue(value)) {
      console.error(
        `Error: --env must be one of ${VALID_ENVIRONMENTS.join(', ')}, got '${value ?? ''}'`,
      )
      process.exit(1)
    }
    return value
  }

  return select({
    message: 'Select the environment to use',
    choices: [
      { name: 'Prod', value: 'prod' },
      { name: 'Dev', value: 'dev' },
      { name: 'Local', value: 'local' },
    ],
  })
}

const VALID_NETWORK_TYPES = ['mainnet', 'testnet'] as const
type NetworkTypeValue = (typeof VALID_NETWORK_TYPES)[number]

const isNetworkTypeValue = (v: string): v is NetworkTypeValue =>
  (VALID_NETWORK_TYPES as readonly string[]).includes(v)

/**
 * Resolve the network type from the `--network` flag, falling back to an
 * interactive prompt when the flag is absent. Exits with a clear error if the
 * flag is set to an unknown value so non-interactive runs fail fast.
 */
export const parseNetworkType = async (): Promise<'mainnet' | 'testnet'> => {
  if (process.argv.includes('--network')) {
    const value = getFlagValue('--network')
    if (!value || !isNetworkTypeValue(value)) {
      console.error(
        `Error: --network must be one of ${VALID_NETWORK_TYPES.join(', ')}, got '${value ?? ''}'`,
      )
      process.exit(1)
    }
    return value
  }

  return select({
    message: 'Select the network type',
    choices: [
      { name: 'Mainnet', value: 'mainnet' },
      { name: 'Testnet', value: 'testnet' },
    ],
  })
}

export const showUserAccount = async (address: string) => {
  console.log(
    `To use your account, you'll need to fund it on the relevant source chain(s). Your account address is ${address}`,
  )
  await confirm({ message: 'Continue?' })
}

export const getReplayParams = async () => {
  if (!fs.existsSync('intents')) {
    console.error("Error: 'intents' folder not found.")
    process.exit(1)
  }

  const args = process.argv
  const flagsWithValues = new Set([
    '--async',
    '--mode',
    '--env',
    '--account-type',
    '--quote',
  ])
  const slicedArgs = args.slice(2)
  const directFile = slicedArgs.find((arg, i) => {
    if (arg.startsWith('--')) return false
    const prevArg = slicedArgs[i - 1]
    if (prevArg && flagsWithValues.has(prevArg)) return false
    return true
  })

  let parsedIntents: Intent[] = []

  if (directFile) {
    const jsonFilename = directFile.endsWith('.json')
      ? directFile
      : `${directFile}.json`
    const filePath = path.join('intents', jsonFilename)

    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`)
      process.exit(1)
    }

    const data = readIntentFile(filePath)
    parsedIntents = data.intentList ? data.intentList : [data]

    console.log(`Loaded ${parsedIntents.length} intent(s) from ${filePath}`)
  } else {
    const files = fs
      .readdirSync('intents')
      .filter((file) => file.endsWith('.json'))

    const fileIntentsMap = new Map<string, Intent[]>()
    const intentsList = files.map((file) => {
      const data = readIntentFile(path.join('intents', file))
      const intents: Intent[] = data.intentList ? data.intentList : [data]
      fileIntentsMap.set(file, intents)
      return { file, count: intents.length }
    })

    const autoAll = args.includes('--all')
    const isAll = autoAll
      ? true
      : await select({
          message: 'Do you want to replay all intents?',
          choices: [
            { name: 'Yes', value: true },
            { name: 'No', value: false },
          ],
        })

    if (isAll) {
      for (const file of files) {
        parsedIntents.push(...fileIntentsMap.get(file)!)
      }
    } else {
      const selectedFiles = await checkbox({
        message: 'Select intents to replay',
        choices: intentsList.map(({ file, count }) => ({
          name: `${file} (${count} intents)`,
          value: file,
        })),
      })
      for (const file of new Set(selectedFiles)) {
        parsedIntents.push(...fileIntentsMap.get(file)!)
      }
    }

    console.log(`Total intents selected: ${parsedIntents.length}`)
  }

  const autoAsyncMode = args.includes('--async')
  let autoAsyncDuration: string | undefined
  if (autoAsyncMode) {
    autoAsyncDuration = args[args.indexOf('--async') + 1]
  }

  let asyncMode = autoAsyncMode
  let delay = autoAsyncDuration || '2500'
  if (parsedIntents.length > 1 && !asyncMode) {
    asyncMode = await select({
      message: 'Do you want to replay intents in parallel / asynchronously?',
      choices: [
        { name: 'Yes', value: true },
        { name: 'No', value: false },
      ],
    })

    if (asyncMode) {
      delay = await input({
        message:
          'Enter milliseconds delay between each intent (default is 2500)',
        default: '2500',
      })
    }
  }

  const environment = await parseEnvironment()

  const isExecutionModeSet = args.includes('--mode')
  let executionMode: string
  if (isExecutionModeSet) {
    executionMode = args[args.indexOf('--mode') + 1]
  } else {
    executionMode = await select({
      message: 'Do you want to execute the intent or simulate it?',
      choices: [
        { name: 'Execute', value: 'execute' },
        { name: 'Simulate', value: 'simulate' },
        { name: 'Route', value: 'route' },
      ],
    })
  }

  const verbose = args.includes('--verbose')

  const accountType = parseAccountType()

  const isQuoteSet = args.includes('--quote')
  const quoteSelection = isQuoteSet
    ? (args[args.indexOf('--quote') + 1] ?? 'best')
    : 'best'

  if (quoteSelection === 'interactive' && asyncMode) {
    console.error(
      'Error: --quote interactive cannot be combined with --async (no stdin in parallel mode)',
    )
    process.exit(1)
  }

  return {
    intents: parsedIntents,
    asyncMode,
    msBetweenBundles: parseInt(delay, 10),
    environment,
    executionMode,
    verbose,
    accountType,
    quoteSelection,
  }
}
