import { Address } from "viem";

function getSDKRegistry() {
  try {
    const sdkPath = require.resolve("@rhinestone/sdk");
    const registryPath = sdkPath.replace(
      "/dist/src/index.js",
      "/dist/src/orchestrator/registry.js"
    );
    return require(registryPath);
  } catch (error) {
    throw new Error(
      `Failed to load SDK registry: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

const registry = getSDKRegistry();

// export type BundleResult = any;
// export type OrderPath = any;

export type BundleResult = {
  status: string;
  claims?: Array<{
    chainId: number;
    status: string;
    depositId?: bigint;
    claimTimestamp?: number;
    claimTransactionHash?: string;
  }>;
  destinationChainId?: number;
  fillTransactionHash?: string;
  fillTimestamp?: number;
  [key: string]: any;
};

export type OrderPath = {
  [key: string]: any;
};

export const INTENT_STATUS_CONSTANTS = {
  PENDING: "PENDING",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
  PARTIALLY_COMPLETED: "PARTIALLY_COMPLETED",
  COMPLETED: "COMPLETED",
  FILLED: "FILLED",
  PRECONFIRMED: "PRECONFIRMED",
  UNKNOWN: "UNKNOWN",
  CLAIMED: "CLAIMED",
} as const;

export const getTokenAddress = (symbol: string, chainId: number): Address => {
  return registry.getTokenAddress(symbol, chainId);
};

export const getTokenBalanceSlot = (
  symbol: string,
  chainId: number,
  account: Address
): `0x${string}` => {
  return registry.getTokenBalanceSlot(symbol, chainId, account);
};

export const getSupportedTokens = (chainId: number) => {
  return registry.getSupportedTokens(chainId);
};

export const getTokenSymbol = (
  tokenAddress: Address,
  chainId: number
): string => {
  return registry.getTokenSymbol(tokenAddress, chainId);
};

export const getWethAddress = (chain: { id: number }): Address => {
  return registry.getWethAddress(chain);
};

export const isTokenAddressSupported = (
  address: Address,
  chainId: number
): boolean => {
  return registry.isTokenAddressSupported(address, chainId);
};

export const getSupportedChainIds = (): number[] => {
  return registry.getSupportedChainIds();
};

export const getChainById = (chainId: number) => {
  return registry.getChainById(chainId);
};
