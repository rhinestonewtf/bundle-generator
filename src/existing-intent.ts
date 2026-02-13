import { config } from 'dotenv'

config()

import { getReplayParams } from './cli.js'
import { createRhinestoneAccount, processIntent } from './main.js'

export const main = async () => {
  const replayParams = await getReplayParams()
  const { intents } = replayParams

  const rhinestoneAccount = await createRhinestoneAccount(
    replayParams.environment,
  )

  for (let i = 0; i < intents.length; i++) {
    const intent = intents[i]
    if (!replayParams.asyncMode) {
      await processIntent(
        intent,
        replayParams.environment,
        replayParams.executionMode,
        rhinestoneAccount,
        replayParams.verbose,
      )
    } else {
      processIntent(
        intent,
        replayParams.environment,
        replayParams.executionMode,
        rhinestoneAccount,
        replayParams.verbose,
      ).catch((error) => {
        console.error('Intent execution failed:', error)
      })
    }

    if (i < intents.length - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, replayParams.msBetweenBundles),
      )
    }
  }
}

main()
