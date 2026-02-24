import { select } from '@inquirer/prompts'
import { RhinestoneSDK } from '@rhinestone/sdk'
import { config } from 'dotenv'
import type { Account, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getEnvironment } from './utils/environments.js'

config()

export const main = async () => {
  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex,
  )

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
    useDevContracts: environment.useDevContracts,
  })
  const rhinestoneAccount = await rhinestone.createAccount({
    owners: {
      type: 'ecdsa' as const,
      accounts: [owner],
    },
  })

  const address = await rhinestoneAccount.getAddress()
  console.log(`Account address: ${address}`)
}

main()
