import {
  getTokenAddress,
  getTokenBalanceSlot,
} from "@rhinestone/orchestrator-sdk";
import { Address, createTestClient, http, pad, toHex } from "viem";
import { getChain } from "./utils/chains";
import { foundry } from "viem/chains";

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
      const testClient = createTestClient({
        chain: foundry,
        mode: "anvil",
        transport: http(chain.rpcUrls.default.http[0]),
      });
      for (const sourceToken of sourceTokens) {
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
};
