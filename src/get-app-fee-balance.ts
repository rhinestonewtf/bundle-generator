import { select } from '@inquirer/prompts'
import { RhinestoneSDK } from '@rhinestone/sdk'
import { config } from 'dotenv'
import { getEnvironment } from './utils/environments.js'

config()

// Prints the integrator's accrued app-fee balance (USD totals) from
// GET /app-fees/balances via the SDK's RhinestoneSDK.getAppFeeBalances().
// The balance is project-scoped (keyed to the env's *_API_KEY), not tied to any
// account, so this talks to the SDK instance directly. Supports
// `--env <local|dev|prod>` non-interactively, else prompts.
export const main = async () => {
  const args = process.argv
  const environmentString = args.includes('--env')
    ? args[args.indexOf('--env') + 1]
    : await select({
        message: 'Select the environment to use',
        choices: [
          { name: 'Prod', value: 'prod' },
          { name: 'Dev', value: 'dev' },
          { name: 'Local', value: 'local' },
        ],
      })

  const environment = getEnvironment(environmentString)
  const sdk = new RhinestoneSDK({
    apiKey: environment.apiKey,
    endpointUrl: environment.url,
    useDevContracts: environment.useDevContracts,
  })

  const balances = await sdk.getAppFeeBalances()

  console.log(`App-fee balance (env: ${environmentString}):`)
  console.log(`   withdrawableUsd: $${balances.withdrawableUsd}`)
  console.log(`   pendingUsd:      $${balances.pendingUsd}`)
}

main().catch(console.error)
