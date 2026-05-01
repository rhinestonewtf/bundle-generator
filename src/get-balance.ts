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
      console.log(`   ${token.symbol}: (${token.chains.length} chain(s))`)
      token.chains.forEach((chain) => {
        const chainBalance = chain.locked + chain.unlocked
        if (chainBalance === 0n) return
        const chainFormatted = formatUnits(chainBalance, chain.decimals)
        const chainInfo = getChainById(chain.chain)
        const chainName = chainInfo?.name || `Chain ${chain.chain}`
        console.log(`     └─ ${chainName}: ${chainFormatted}`)
      })
    })
  }
}

main().catch(console.error)
