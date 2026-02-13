import * as fs from 'node:fs'
import path from 'node:path'
import { checkbox, confirm, input, select } from '@inquirer/prompts'
import {
  getAllSupportedChainsAndTokens,
  getTokenAddress,
  type TokenSymbol,
} from '@rhinestone/sdk'
import { type Address, type Chain, type Hex, isAddress, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as viemChains from 'viem/chains'
import type { Intent } from './types.js'
import { getDecimals } from './utils/tokens.js'

const readIntentFile = (filePath: string) => {
  try {
    const data = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? `Invalid JSON in ${filePath}: ${error.message}`
        : `Failed to read ${filePath}: ${error}`
    throw new Error(message)
  }
}

export const collectUserInput = async (): Promise<{
  intent: Intent
  saveAsFileName?: string
  environment: string
  executionMode: string
}> => {
  const sdkData = getAllSupportedChainsAndTokens()
  const normalizeName = (str: string) => str.replace(/ /g, '')
  const supportedChainIds = new Set(sdkData.map((c) => c.chainId))
  const uniqueViemChains = Object.values(viemChains).reduce((acc, chain) => {
    if (typeof chain !== 'object' || !('id' in chain)) return acc
    if (!acc.has(chain.id) && supportedChainIds.has(chain.id)) {
      acc.set(chain.id, chain)
    }
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
    address: Address
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
        { name: 'Simple token list (same tokens across all chains)', value: 'simple' },
        { name: 'Per-chain token map (different tokens per chain)', value: 'chainMap' },
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
          ],
        })
        if (tokensForChain.length > 0) {
          chainTokenMap[chainName] = tokensForChain
        }
      }
      sourceAssetsConfig = chainTokenMap
    } else if (sourceAssetFormat === 'exact') {
      const exactConfigs: { chain: string; token: string; amount?: string }[] = []
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
            const tokenAddress = isAddress(tokenSymbol)
              ? (tokenSymbol as Hex)
              : (getTokenAddress(tokenSymbol as TokenSymbol, chain.id) as Hex)

            const amountStr = await input({
              message: `Amount of ${tokenSymbol} to pull from ${chain.name}`,
            })

            const sourceWithAmount: {
              chain: { id: number }
              address: Address
              amount?: string
            } = {
              chain: { id: chain.id },
              address: tokenAddress,
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

  const environment = await select({
    message: 'Select the environments to use',
    choices: [
      {
        name: 'Prod',
        value: 'prod',
      },
      {
        name: 'Dev',
        value: 'dev',
      },
      {
        name: 'Local',
        value: 'local',
      },
    ],
  })

  const executionMode = await select({
    message: 'Do you want to execute the intent or simulate it?',
    choices: [
      {
        name: 'Execute',
        value: 'execute',
      },
      { name: 'Simulate', value: 'simulate' },
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
      settlementLayers,
      sponsored,
      ...(feeAsset ? { feeAsset } : {}),
    },
    saveAsFileName,
    environment,
    executionMode,
  }
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
  const flagsWithValues = new Set(['--async', '--mode', '--env'])
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

  const isEnvSet = args.includes('--env')
  let environment: string
  if (isEnvSet) {
    environment = args[args.indexOf('--env') + 1]
  } else {
    environment = await select({
      message: 'Select the environment to use',
      choices: [
        { name: 'Prod', value: 'prod' },
        { name: 'Dev', value: 'dev' },
        { name: 'Local', value: 'local' },
      ],
    })
  }

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
      ],
    })
  }

  const verbose = args.includes('--verbose')

  return {
    intents: parsedIntents,
    asyncMode,
    msBetweenBundles: parseInt(delay, 10),
    environment,
    executionMode,
    verbose,
  }
}
