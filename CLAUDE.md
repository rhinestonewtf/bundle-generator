# bundle-generator — Claude Instructions

An interactive CLI that builds, saves and replays intents against a real
Rhinestone Orchestrator. It is the tool people reach for when they need to ask
"does this route actually work end to end", against `dev`, a local
orchestrator — or **prod**.

**Read the safety section before running anything.** `pnpm replay --env prod
--mode execute` signs and submits real intents from a real funded account on
mainnet. There is no dry-run default and no confirmation gate.

## Why it exists / what breaks without it

The orchestrator's happy path spans quoting, route planning, settlement-layer
selection, signing, submission and fill. Reproducing one specific shape of that
— a given source/target pair, a given settlement layer, a sponsored intent, two
intents racing — is tedious to do by hand and impossible to do repeatably.

This repo makes an intent a **JSON file you can re-run**. That's what makes it
useful for reproducing a bug, bisecting a regression, or generating load against
dev.

Nothing in production depends on it. If it breaks, engineers lose their fastest
way to exercise the orchestrator, not a customer-facing capability.

## Where it sits in the intent lifecycle

At the very front, standing in for an integrator's app:

```
intents/*.json ──▶ bundle-generator ──▶ @rhinestone/sdk ──▶ orchestrator
                     (signs with            (prepare /        dev | prod | local
                      OWNER_PRIVATE_KEY)     sign / submit)
                          │
                          └──▶ viem public clients, direct to chain RPCs
                               (balances, app-fee reads, local-fork funding)
```

It is a client, not a service: nothing calls it, it listens on no port, and it
has no deployment. There is no ArgoCD Application and no image.

## Ownership

No `CODEOWNERS`. Contributors by commit volume: **Konrad Kopp** (by a wide
margin), **Diego Braga**, **Aman Raj**, **Kai Aldag**, **Tadas Valiukas**,
**Timur Badretdinov**.

## Running it

```sh
pnpm i
cp .env.example .env      # fill the API key for the env you're targeting

pnpm address              # smart account address
pnpm balance              # balances across supported chains
pnpm new                  # interactive: build, save and run a new intent
pnpm replay               # replay saved intents from intents/
pnpm app-fee-balance

pnpm check                # biome lint + format — the only quality gate
pnpm check:fix
```

Every command takes `--env <prod|dev|local>` and prompts if omitted.

## Key files

| path | what |
|---|---|
| `src/cli.ts` | Prompts, argument parsing, and **intent-file validation** |
| `src/main.ts` | The actual run: route → sign → submit → execute → index, with timing |
| `src/new-intent.ts`, `src/existing-intent.ts` | Entry points for `pnpm new` / `pnpm replay` |
| `src/types.ts` | The intent file schema — the authoritative shape |
| `src/utils/environments.ts` | The three environments and which API key each needs |
| `src/funding.ts` | `LOCAL_TESTNET` anvil funding via storage-slot writes |
| `intents/` | Saved intents — **gitignored**, so they are yours alone |

## Gotchas

- **`--mode execute` against `--env prod` spends real money on mainnet.** It
  signs with `OWNER_PRIVATE_KEY` and submits. Use `--mode simulate` or
  `--mode route` when you only want to see what the orchestrator would do, and
  double-check `--env` before every prod run — the env prompt is skipped
  whenever `--env` is passed.
- **This repo is also cloned as `simulation-tests`.** There is no
  `rhinestonewtf/simulation-tests` repo; local checkouts and notes calling it
  "sim-tests" or "simulation-tests" point at *this* remote. Confirm with
  `git remote -v` before concluding a change is missing.
- **`settlementLayers` is `{ include: [...] }` or `{ exclude: [...] }`, never a
  bare array.** A raw array is the historical shape and the SDK silently treats
  it as `{ exclude: undefined }`, matching *every* layer — so an intent that
  looks pinned to ACROSS would quietly run on any layer. `cli.ts` rejects the
  array shape outright so the trap can't come back. Exactly one of
  `include`/`exclude`, non-empty.
- **`KNOWN_SETTLEMENT_LAYERS` in `cli.ts` is a hand-maintained mirror** of the
  SDK's list, which isn't exported as a runtime value. A layer added to
  `@rhinestone/sdk` is rejected here until this array is updated.
- **There is no CI.** The repo has no `.github/` directory at all — no build, no
  typecheck, no test on a pull request. `pnpm check` locally is the entire
  quality gate, and `tsc` is never run in isolation (`tsx` transpiles without
  type-checking), so a type error can be merged and only surfaces at runtime.
- **`intents/` is gitignored.** Saved intents never leave your machine, so
  "replay the intent from that bug" means someone has to paste the JSON. Keep
  reproductions in the ticket, not just on disk.
- **`--async` is incompatible with `--quote interactive`** — you can't be
  prompted per intent while they run in parallel. `--async` is how you produce
  the overlapping-intent cases that only show up under a tight race.
- **`sourceAssets` overrides `sourceTokens` for routing**, and its three accepted
  shapes are not interchangeable: a plain list applies the same tokens to every
  source chain, a per-chain map differs per chain, and the exact-inputs form
  pins amounts. Getting a thin single-chain source is the usual cause of an
  `INSUFFICIENT_BALANCE` quote — pool with `sourceChains: []` plus
  `sourceAssets`.
- **`auxiliaryFunds` token keys must be addresses, not symbols** — the SDK
  requires addresses there, and decimals are read from the chain.
- **`LOCAL_TESTNET=true` funding is a hardcoded table** of token addresses and
  ERC-20 balance storage slots in `src/funding.ts`, covering a few tokens on
  mainnet/base/arbitrum only. Tokens outside it are skipped with a warning, not
  an error — so a local run can proceed with an unfunded account and fail later
  for an unrelated-looking reason.
- **`useDevContracts` is `true` for both `dev` and `local`, `false` for `prod`.**
  It's derived from the env name in `src/utils/environments.ts`, not
  configurable — pointing `local` at a prod-contracts orchestrator needs a code
  change.
