import { config } from 'dotenv'

config()

import { getReplayParams } from './cli.js'
import { createRhinestoneAccount, processIntent } from './main.js'
import { initRegistry } from './registry.js'
import { getEnvironment } from './utils/environments.js'

export const main = async () => {
  const replayParams = await getReplayParams()
  const { intents } = replayParams

  await initRegistry(getEnvironment(replayParams.environment).url)

  const rhinestoneAccount = await createRhinestoneAccount(
    replayParams.environment,
    replayParams.featureFlags,
    replayParams.accountType,
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
        replayParams.quoteSelection,
      )
    } else {
      processIntent(
        intent,
        replayParams.environment,
        replayParams.executionMode,
        rhinestoneAccount,
        replayParams.verbose,
        replayParams.quoteSelection,
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
