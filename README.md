# Bundle Generator

A simple CLI tool to generate bundles on the Rhinestone Orchestrator for testing.

## Usage

When using the bundle generator for the first time, run `pnpm i` to install the dependencies. You will also need to create a `.env` file based on `.env.example`. The owner private key is just used to sign so can be a random private key. The deployment private key needs to hold native tokens on all source chains you plan to use since it's used to deploy smart accounts on these source chains.

## Modes

### Mode: `new`

- Creates a new intent through a cli
- Stores the intent params for future use
- Executes the intent

Usage: `pnpm new` or `pnpm run new`

### Mode `replay`

- Allows you to either replay all stored intents or a subset
- Allows you to either execute them in sequence or parallel

Usage: `pnpm replay` or `pnpm run replay`

### Mode: `simulate`

- Creates a new intent through a cli but only simulates it without execution
- Useful for testing and validation

Usage: `pnpm simulate` or `pnpm run simulate`

You can also add the `--simulate` or `-s` flag to any new intent command: `pnpm new -s`
