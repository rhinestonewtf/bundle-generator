import { config } from 'dotenv'
import { parseAccountType, parseEnvironment } from './cli.js'
import { createRhinestoneAccount } from './main.js'

config()

export const main = async () => {
  const environmentString = await parseEnvironment()

  const accountType = parseAccountType()
  const rhinestoneAccount = await createRhinestoneAccount(
    environmentString,
    accountType,
  )

  const address = await rhinestoneAccount.getAddress()
  console.log(`Account address: ${address} (${accountType})`)
}

main()
