import {
  getTokenAddress,
  getTokenBalanceSlot,
} from "@rhinestone/sdk/orchestrator";
import { Address, Chain, createTestClient, http, pad, toHex } from "viem";
import { getChain } from "./utils/chains.js";
import { arbitrum, base, mainnet } from "viem/chains";

const lookup = (chain: Chain): string => {
  switch (chain) {
    case mainnet:
      return "http://localhost:30001";
    case arbitrum:
      return "http://localhost:30002";
    case base:
      return "http://localhost:30003";
  }
  throw new Error(`unsupported chain fork ${chain.name}`);
};

// must be aligned with lookup function above - because each funding needs rpc fork from local e2e infra
export const fundingSupportedChains = ["Ethereum", "Arbitrum", "Base"]
// funding supported tokens
export const fundingSupportedTokens = ["ETH", "WETH", "USDC", "USDT"]

export const fundAccount = async ({
  account,
  sourceChains,
  sourceTokens,
}: {
  account: Address;
  sourceChains: string[];
  sourceTokens: string[];
}) => {
  if (process.env.LOCAL_TESTNET) {
    for (const sourceChain of sourceChains) {
      const chain = getChain(sourceChain);

      console.log("Funding on %s", chain.name);

      const testClient = createTestClient({
        chain,
        mode: "anvil",
        transport: http(lookup(chain)),
      });
      for (const sourceToken of sourceTokens) {
        if (sourceToken === "ETH") {
          await testClient.setBalance({
            address: account,
            value: 100000000000000000000000000000000000000000n,
          });
        } else {
          const tokenAddress = getTokenAddress(sourceToken, chain.id);
          const tokenBalanceSlot = getTokenBalanceSlot(
            sourceToken,
            chain.id,
            account,
          );

          await testClient.setStorageAt({
            address: tokenAddress,
            index: tokenBalanceSlot,
            value: pad(toHex(100000000000000000000000000000000000000000n)),
          });
        }
      }
    }
  }
};
