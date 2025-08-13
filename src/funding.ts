import { getTokenAddress } from "@rhinestone/sdk";
import {
  Address,
  Chain,
  createTestClient,
  http,
  pad,
  toHex,
  keccak256,
  encodePacked,
} from "viem";
import { arbitrum, base, mainnet } from "viem/chains";
import { getChain } from "./utils/chains.js";
import { TokenSymbol } from "./types.js";

export const lookup = (chain: Chain): string => {
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

function getTokenBalanceSlot(
  tokenSymbol: TokenSymbol,
  chainId: number,
  account: Address
): `0x${string}` {
  if (tokenSymbol === "ETH") {
    throw new Error("ETH does not have a balance slot (native token)");
  }
  // common balance slots for popular tokens:
  const balanceSlots: Record<string, Record<number, number>> = {
    USDC: {
      1: 9,
      137: 0,
      42161: 51,
      8453: 0,
    },
    USDT: {
      1: 2,
      137: 0,
      42161: 51,
    },
    WETH: {
      1: 3,
      137: 0,
      42161: 51,
      8453: 0,
    },
  };

  const balanceSlot = balanceSlots[tokenSymbol]?.[chainId] ?? 0;

  // calculate storage slot: keccak256(abi.encode(account, balanceSlot))
  const slot = keccak256(
    encodePacked(["address", "uint256"], [account, BigInt(balanceSlot)])
  );

  return slot;
}

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

      console.log("Funding on %s for %s", chain.name, account);

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
          const tokenAddress = getTokenAddress(
            sourceToken as TokenSymbol,
            chain.id
          );
          const tokenBalanceSlot = getTokenBalanceSlot(
            sourceToken as TokenSymbol,
            chain.id,
            account
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
