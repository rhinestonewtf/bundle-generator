import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import {
  buildTransactionDetails,
  createRhinestoneAccount,
  ts,
} from '../main.js'
import type { Intent } from '../types.js'
import {
  CHECKS,
  exitCodeForOutcomes,
  type CheckContext,
  type CheckOutcome,
} from './checks.js'

config()

const SCENARIO_DIR = path.join('scenarios', 'deferred-destination-swap')

/**
 * A scenario file: an intent the orchestrator must route, plus the names of the
 * checks its route response has to satisfy. `checks` names keys of `CHECKS`;
 * an unknown name is a hard error rather than a silent skip, so a typo cannot
 * quietly reduce a scenario to "no assertions ran".
 */
type Scenario = {
  description: string
  checks: string[]
  intent: Intent
}

const parseScenario = (filePath: string): Scenario => {
  const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${filePath}: scenario must be a JSON object`)
  }
  const description = 'description' in raw ? raw.description : undefined
  const checks = 'checks' in raw ? raw.checks : undefined
  const intent = 'intent' in raw ? raw.intent : undefined
  if (typeof description !== 'string' || description.length === 0) {
    throw new Error(`${filePath}: 'description' must be a non-empty string`)
  }
  if (
    !Array.isArray(checks) ||
    checks.length === 0 ||
    !checks.every((name): name is string => typeof name === 'string')
  ) {
    throw new Error(`${filePath}: 'checks' must be a non-empty string array`)
  }
  for (const name of checks) {
    if (!(name in CHECKS)) {
      throw new Error(
        `${filePath}: unknown check '${name}'. Known: ${Object.keys(CHECKS).join(', ')}`,
      )
    }
  }
  if (typeof intent !== 'object' || intent === null || Array.isArray(intent)) {
    throw new Error(`${filePath}: 'intent' must be a JSON object`)
  }
  // The fixture format is the CLI's own permissive intent shape, validated by
  // the SDK at route time; re-validating it here would fork that contract.
  const scenarioIntent = intent as Intent
  return { description, checks, intent: scenarioIntent }
}


type ScenarioError = { status?: number; code?: string; message: string }

/**
 * HTTP status and error code are what several audit items turn on (a clean
 * decline vs. an unguarded 500), and the SDK surfaces them as untyped extra
 * properties on a plain `Error`.
 */
const toErrorContext = (error: unknown): ScenarioError => {
  if (!(error instanceof Error)) return { message: String(error) }
  const status = 'status' in error ? error.status : undefined
  const code = 'code' in error ? error.code : undefined
  return {
    ...(typeof status === 'number' ? { status } : {}),
    ...(typeof code === 'string' ? { code } : {}),
    message: error.message,
  }
}

const runScenario = async (
  filePath: string,
  environment: string,
): Promise<CheckOutcome[]> => {
  const scenario = parseScenario(filePath)
  const name = path.basename(filePath, '.json')
  console.log(`${ts()} [${name}] ${scenario.description}`)

  const account = await createRhinestoneAccount(environment)
  const { transactionDetails, requestedOutputAmount } =
    await buildTransactionDetails(scenario.intent, account)

  let context: CheckContext
  try {
    const prepared = await account.prepareTransaction(transactionDetails)
    const { best, all } = prepared.quotes
    console.log(
      `${ts()} [${name}] ${all.length} route(s); best ${best.settlementLayer}`,
    )
    context = {
      routes: all,
      best,
      requestedOutputAmount,
      ...(scenario.intent.settlementLayers &&
      'include' in scenario.intent.settlementLayers
        ? { compareLayers: scenario.intent.settlementLayers.include }
        : {}),
    }
  } catch (error) {
    const errorContext = toErrorContext(error)
    console.log(
      `${ts()} [${name}] route request failed: ${errorContext.message}`,
    )
    // A rejected request is data, not a harness failure: several audit items
    // are precisely about WHICH rejection the orchestrator produces. The checks
    // decide whether this particular refusal is acceptable.
    context = {
      routes: [],
      best: { intentId: '', settlementLayer: '' },
      requestedOutputAmount,
      error: errorContext,
    }
  }

  return scenario.checks.map((checkName) => {
    const outcome = CHECKS[checkName](context)
    const marker =
      outcome.status === 'pass'
        ? 'PASS'
        : outcome.status === 'fail'
          ? 'FAIL'
          : 'SKIP'
    console.log(
      `${ts()} [${name}] ${marker} ${outcome.name}: ${outcome.detail}`,
    )
    return outcome
  })
}

const main = async () => {
  const environment = process.env.SCENARIO_ENV ?? 'dev'
  // Checked up front rather than left to viem: without it the first scenario
  // dies inside `privateKeyToAccount` with a bare "cannot read 'slice'", which
  // reads like a harness bug rather than a missing credential.
  if (!process.env.OWNER_PRIVATE_KEY) {
    throw new Error(
      'OWNER_PRIVATE_KEY is required to sign scenario intents. Set it in .env ' +
        `(see .env.example). SCENARIO_ENV=${environment} also needs the matching ` +
        'API key: DEV_API_KEY, PROD_API_KEY, or LOCAL_API_KEY.',
    )
  }
  const only = process.argv[2]
  const files = fs
    .readdirSync(SCENARIO_DIR)
    .filter((file) => file.endsWith('.json'))
    .filter((file) => (only ? file.includes(only) : true))
    .map((file) => path.join(SCENARIO_DIR, file))
    .sort()

  if (files.length === 0) {
    throw new Error(
      `no scenarios matched${only ? ` filter '${only}'` : ''} in ${SCENARIO_DIR}`,
    )
  }

  const outcomes: CheckOutcome[] = []
  for (const file of files) {
    outcomes.push(...(await runScenario(file, environment)))
  }

  const failed = outcomes.filter((outcome) => outcome.status === 'fail')
  const passed = outcomes.filter((outcome) => outcome.status === 'pass')
  const skipped = outcomes.filter(
    (outcome) => outcome.status === 'inapplicable',
  )
  console.log(
    `${ts()} ${passed.length} passed, ${failed.length} failed, ${skipped.length} inapplicable`,
  )
  process.exitCode = exitCodeForOutcomes(outcomes)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
