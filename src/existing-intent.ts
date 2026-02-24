import { config } from 'dotenv'

config()

import { getReplayParams } from './cli.js'
import { runDepositMode } from './deposit.js'
import { createRhinestoneAccount, processIntent } from './main.js'

export const main = async () => {
  const replayParams = await getReplayParams()
  const { intents } = replayParams

  const rhinestoneAccount = await createRhinestoneAccount(
    replayParams.environment,
  )

  if (replayParams.executionMode === 'deposit') {
    if (intents.length > 1 && !replayParams.asyncMode) {
      throw new Error(
        'Multiple deposit intents require async mode (deposit service supports single target per account)',
      )
    }

    for (let i = 0; i < intents.length; i++) {
      const intent = intents[i]
      if (!replayParams.asyncMode) {
        await runDepositMode(
          intent,
          replayParams.environment,
          rhinestoneAccount,
          replayParams.verbose,
        )
      } else {
        runDepositMode(
          intent,
          replayParams.environment,
          rhinestoneAccount,
          replayParams.verbose,
        ).catch((error) => {
          console.error('Deposit execution failed:', error)
        })
      }

      if (i < intents.length - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, replayParams.msBetweenBundles),
        )
      }
    }
    return
  }

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
