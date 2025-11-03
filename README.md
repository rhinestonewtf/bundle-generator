# Bundle Generator

A simple CLI tool to generate intents on the Rhinestone Orchestrator for testing.

## Usage

When using the bundle generator for the first time, run `pnpm i` to install the dependencies. You will also need to create a `.env` file based on `.env.example`. The owner private key is just used to sign so can be a random private key. You only need the api keys of the env you're using.

## Environments

The bundle generator supports three different environments:

- Prod
- Dev
- Local

Note: if you're running a local testnet, set `LOCAL_TESTNET=true`

## Usage

### Command `address`

- Gets the address for the smart account to send funds to

Usage: `pnpm address` or `pnpm run address`

### Command `balance`

- Gets the balance of the smart account across all supported chains

Usage: `pnpm address` or `pnpm run address`

### Command: `new`

- Creates a new intent through a cli
- Stores the intent params for future use
- Executes the intent

Usage: `pnpm new` or `pnpm run new`

### Mode `replay`

- Allows you to either replay all stored intents or a subset
- Allows you to either execute them in sequence or parallel

Usage: `pnpm replay` or `pnpm run replay`

## Testing vectors

In order to generate a large set of test cases, run `./generate.sh` or `./generate_testnets.sh`. The vectors are:

- [x] Networks: what networks to use
- [x] Token outs: what tokens to request on target
- [ ] Token ins: what tokens to use as input
- [x] Sponsored: whether the intent is sponsored
- [x] Destination ops: whether there are target executions
- [x] Settlement layers: which settelment layers to use
- [x] Samechain no token transfers
- [x] Multi token output
- [ ] Account deployments
- [ ] EIP-7702
- [ ] EOAs
- [ ] Non-7579 accounts
- [ ] Multi token input
- [ ] Multi origin chain
- [ ] Locked funds
- [ ] Unlocked funds
- [ ] Preclaim ops
