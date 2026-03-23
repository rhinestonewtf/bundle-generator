import { select } from '@inquirer/prompts'
import { config } from 'dotenv'
import { formatUnits } from 'viem'
import { parseAccountType } from './cli.js'
import { createRhinestoneAccount } from './main.js'
import { getChainById } from './utils/chains.js'

config()

export const main = async () => {
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

  const networkType = await select({
    message: 'Select the network type',
    choices: [
      {
        name: 'Mainnet',
        value: 'mainnet',
      },
      {
        name: 'Testnet',
        value: 'testnet',
      },
    ],
  })

  const accountType = parseAccountType()
  const rhinestoneAccount = await createRhinestoneAccount(
    environmentString,
    undefined,
    accountType,
  )

  const address = rhinestoneAccount.getAddress()
  console.log(`Account: ${address}\n`)

  console.log('Portfolio (via Rhinestone SDK):')
  const isTestnet = networkType === 'testnet'
  const portfolio = await rhinestoneAccount.getPortfolio(isTestnet)

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
