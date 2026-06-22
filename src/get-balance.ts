import { config } from 'dotenv'
import { formatUnits } from 'viem'
import { parseAccountType, parseEnvironment, parseNetworkType } from './cli.js'
import { createRhinestoneAccount } from './main.js'
import { getChainById } from './utils/chains.js'

config()

export const main = async () => {
  const environmentString = await parseEnvironment()

  const networkType = await parseNetworkType()

  const accountType = parseAccountType()
  const rhinestoneAccount = await createRhinestoneAccount(
    environmentString,
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
        if (chain.amount === 0n) return
        const chainFormatted = formatUnits(chain.amount, chain.decimals)
        const chainInfo = getChainById(chain.chain)
        const chainName = chainInfo?.name || `Chain ${chain.chain}`
        console.log(`     └─ ${chainName}: ${chainFormatted}`)
      })
    })
  }
}

main().catch(console.error)
