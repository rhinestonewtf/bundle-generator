# Bundle Generator

CLI tool to generate and replay intents on the Rhinestone Orchestrator.

## Setup

```sh
pnpm i
cp .env.example .env
```

Set the API key for your target environment in `.env`. The owner private key is used for signing and can be any valid private key.

## Environment variables

| Variable | Description |
|---|---|
| `OWNER_PRIVATE_KEY` | Private key for signing intents |
| `PROD_API_KEY` | API key for prod orchestrator |
| `DEV_API_KEY` | API key for dev orchestrator |
| `LOCAL_API_KEY` | API key for local orchestrator |
| `DEFAULT_TOKEN_RECIPIENT` | Default recipient address (falls back to owner) |
| `LOCAL_TESTNET` | Set to `true` to enable local testnet funding |

## Commands

### `pnpm address`

Prints the smart account address.

### `pnpm balance`

Shows token balances across all supported chains.

### `pnpm new`

Interactive CLI to create, save, and execute a new intent.

### `pnpm replay [filename] [options]`

Replay saved intents from the `intents/` directory.

| Option | Description |
|---|---|
| `filename` | Replay a specific file (`.json` extension optional) |
| `--all` | Replay all intents without prompting |
| `--env <prod\|dev\|local>` | Set environment |
| `--mode <execute\|simulate>` | Set execution mode |
| `--async [delay]` | Run in parallel with optional delay in ms (default: 2500) |
| `--verbose` | Print `intentOp` and `intentCost` after transaction preparation |

Examples:

```sh
pnpm replay                                        # interactive
pnpm replay my-intent --env prod --mode execute     # specific file
pnpm replay --all --env dev --async 3000            # all, parallel
```

## Intent JSON format

Intents are stored in `intents/*.json`. A file contains either a single intent object or `{ "intentList": [...] }`.

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `targetChain` | `string` | yes | Target chain name (e.g. `"ArbitrumOne"`, `"Base"`) |
| `targetTokens` | `{ symbol, amount? }[]` | yes | Tokens to receive on target chain |
| `sourceChains` | `string[]` | yes | Source chain names (can be empty for auto-routing) |
| `sourceTokens` | `string[] \| object[]` | yes | Source tokens (symbols or `{ chain, address, amount }` objects) |
| `tokenRecipient` | `string` | yes | Address to receive tokens on target chain |
| `settlementLayers` | `string[]` | yes | Settlement layers (`"ACROSS"`, `"ECO"`, `"RELAY"`, or `[]`) |
| `sponsored` | `boolean` | yes | Whether the intent is sponsored |
| `sourceAssets` | see below | no | Source asset configuration (overrides `sourceTokens` for routing) |
| `recipient` | `string` | no | Recipient address for the orchestrator |
| `feeAsset` | `string` | no | Fee token symbol or address (e.g. `"USDC"`) |
| `destinationOps` | `boolean` | no | Whether to include target chain executions (default: `true`) |
| `auxiliaryFunds` | `Record<chain, Record<token, amount>>` | no | Off-chain balances for route-finding |

### `sourceAssets` formats

Three formats are supported:

**Simple token list** (same tokens across all source chains):
```json
"sourceAssets": ["WETH", "USDC"]
```

**Per-chain token map** (different tokens per chain):
```json
"sourceAssets": { "Base": ["WETH", "USDC"], "ArbitrumOne": ["USDC"] }
```

**Exact inputs with amounts**:
```json
"sourceAssets": [{ "chain": "Base", "token": "WETH", "amount": "0.001" }]
```

### `auxiliaryFunds`

Specifies off-chain balances (e.g. exchange accounts) that the route-finder can consider. Uses human-readable chain names, token symbols, and amounts:

```json
"auxiliaryFunds": {
  "ArbitrumOne": { "USDC": "500" },
  "Base": { "WETH": "0.5" }
}
```

### Example intent

```json
{
  "intentList": [{
    "targetChain": "ArbitrumOne",
    "targetTokens": [{ "symbol": "WETH", "amount": "0.001" }],
    "sourceChains": ["Base"],
    "sourceTokens": [],
    "sourceAssets": { "Base": ["WETH", "USDC"] },
    "tokenRecipient": "0x...",
    "recipient": "0x...",
    "settlementLayers": ["ACROSS"],
    "sponsored": false,
    "feeAsset": "USDC",
    "auxiliaryFunds": { "ArbitrumOne": { "USDC": "500" } }
  }]
}
```