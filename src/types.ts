import { Address } from "abitype";

export type Token = {
  symbol: string;
  amount: string;
};

export type ParsedToken = {
  symbol: string;
  address: Address;
  amount: bigint;
};

export type Intent = {
  targetChain: string;
  targetTokens: Token[];
  sourceChains: string[];
  sourceTokens: string[];
  tokenRecipient: string;
  settlementLayers: string[];
  sponsored: boolean;
  destinationOps?: boolean;
};

export type TokenSymbol = "ETH" | "WETH" | "USDC" | "USDT";

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
