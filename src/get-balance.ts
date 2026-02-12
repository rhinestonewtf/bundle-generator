import { select } from '@inquirer/prompts'
import { RhinestoneSDK } from '@rhinestone/sdk'
import { config } from 'dotenv'
import { type Account, type Hex, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { AccountType } from './types.js'
import { getChainById } from './utils/chains.js'
import { getEnvironment } from './utils/environments.js'

config()

export const main = async () => {
  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex,
  )

  const accountType = await select<AccountType>({
    message: 'Select the account type',
    choices: [
      { name: 'Smart Account (ERC-4337)', value: 'smart-account' },
      { name: 'EOA (EIP-7702)', value: 'eoa' },
    ],
  })

  const environmentString = await select({
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

  const environment = getEnvironment(environmentString)
  const orchestratorUrl = environment.url
  const rhinestoneApiKey = environment.apiKey

  // create the rhinestone account instance
  const rhinestone = new RhinestoneSDK({
    apiKey: rhinestoneApiKey,
    endpointUrl: orchestratorUrl,
    useDevContracts: environment.url !== undefined,
  })
  const rhinestoneAccount = await rhinestone.createAccount({
    owners: {
      type: 'ecdsa' as const,
      accounts: [owner],
    },
    ...(accountType === 'eoa' && { eoa: owner }),
  })

  const address = rhinestoneAccount.getAddress()
  console.log(`Account: ${address}\n`)

  console.log('Portfolio (via Rhinestone SDK):')
  const isDevMode = process.env.DEV_CONTRACTS === 'true'
  const portfolio = await rhinestoneAccount.getPortfolio(isDevMode)

  if (portfolio.length === 0) {
    console.log('   No tokens found in portfolio')
  } else {
    portfolio.forEach((token) => {
      const totalBalance = token.balances.locked + token.balances.unlocked
      const formattedBalance = formatUnits(totalBalance, token.decimals)
      console.log(
        `   ${token.symbol}: ${formattedBalance} (${token.chains.length} chains)`,
      )

      token.chains.forEach((chain) => {
        const chainBalance = chain.locked + chain.unlocked
        const chainFormatted = formatUnits(chainBalance, token.decimals)
        const chainInfo = getChainById(chain.chain)
        const chainName = chainInfo?.name || `Chain ${chain.chain}`
        if (chainBalance > 0n) {
          console.log(`     └─ ${chainName}: ${chainFormatted}`)
        }
      })
    })
  }
}

main().catch(console.error)
