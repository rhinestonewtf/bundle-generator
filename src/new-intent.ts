import { config } from 'dotenv'

config()

import * as fs from 'node:fs'
import { collectUserInput, showUserAccount } from './cli.js'
import { createRhinestoneAccount, processIntent } from './main.js'

export const main = async () => {
  const {
    intent,
    saveAsFileName,
    environment: environmentString,
    executionMode,
  } = await collectUserInput()

  const rhinestoneAccount = await createRhinestoneAccount(environmentString)
  const address = rhinestoneAccount.getAddress()
  await showUserAccount(address)

  if (saveAsFileName && !saveAsFileName.match(/^(n|no)\.json$/)) {
    if (!fs.existsSync('intents')) {
      fs.mkdirSync('intents', { recursive: true })
    }
    const filePath = `intents/${saveAsFileName}`
    let existingData = []
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      existingData = JSON.parse(data).intentList || []
    }
    existingData.push(intent)
    fs.writeFileSync(
      filePath,
      JSON.stringify({ intentList: existingData }, null, 2),
    )
  }

  await processIntent(intent, environmentString, executionMode, rhinestoneAccount)
}

main()
