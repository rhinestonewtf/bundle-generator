import { select } from '@inquirer/prompts'
import { config } from 'dotenv'
import { parseAccountType } from './cli.js'
import { createRhinestoneAccount } from './main.js'

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

  const accountType = parseAccountType()
  const rhinestoneAccount = await createRhinestoneAccount(
    environmentString,
    undefined,
    accountType,
  )

  const address = await rhinestoneAccount.getAddress()
  console.log(`Account address: ${address} (${accountType})`)
}

main()
