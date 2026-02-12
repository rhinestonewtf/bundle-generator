import { config } from 'dotenv'

config()

import * as fs from 'node:fs'
import * as path from 'node:path'
import { getReplayParams } from './cli.js'
import { processIntent } from './main.js'

export const main = async () => {
  const replayParams = await getReplayParams()

  const intents = replayParams.intentsToReplay.flatMap((file) => {
    const filePath = path.join('intents', file)
    const data = fs.readFileSync(filePath, 'utf-8')
    const parsedData = JSON.parse(data)
    return parsedData.intentList ? parsedData.intentList : [parsedData]
  })

  for (const intent of intents) {
    if (!replayParams.asyncMode) {
      await processIntent(
        intent,
        replayParams.environment,
        replayParams.executionMode,
        replayParams.accountType,
      )
    } else {
      processIntent(
        intent,
        replayParams.environment,
        replayParams.executionMode,
        replayParams.accountType,
      )
    }

    await new Promise((resolve) =>
      setTimeout(resolve, replayParams.msBetweenBundles),
    )
  }
}

main()
