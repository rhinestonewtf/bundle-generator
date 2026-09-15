---
name: replay-intent
description: Use when running bundle-generator unattended (no TTY), picking which account to fund for an environment, or writing an intent fixture that forces a settlement layer.
---

# Driving bundle-generator unattended

- **One `OWNER_PRIVATE_KEY` derives a different smart account on prod than on dev/local**, because
  `useDevContracts` changes the init code. Fund and read the address `pnpm address --env <env>` prints.
- **An unattended `pnpm replay` needs a filename or `--all`, plus `--env` and `--mode`.** A file holding
  more than one intent also prompts for parallelism unless `--async <ms>` is passed; no flag runs them sequentially.
- **`--async` always consumes the next argument as its delay**, so follow it with a number — `--async my-intent`
  swallows the filename. `--async 0` gives the tightest overlap.
- **`pnpm new` ignores `--env` and always prompts**, so it cannot run unattended. Write the fixture under
  `intents/` and replay it instead.
- **Fixture chain names are viem's `name` with spaces removed, matched case-insensitively** (`getChain` in
  `src/utils/chains.ts`), so Optimism is `OPMainnet`, not `Optimism`.
- **`LZ` cannot be named in `settlementLayers`** — `KNOWN_SETTLEMENT_LAYERS` in `src/cli.ts` and the pinned SDK's
  type both lack it. The orchestrator inverts `exclude` against its own full layer list, so excluding every known layer forces LZ.
