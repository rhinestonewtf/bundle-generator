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
  zeroAddress,
} from "viem";
import { arbitrum, base, mainnet } from "viem/chains";
import { getChain } from "./utils/chains.js";
import { SourceTokens, TokenSymbol } from "./types.js";
import { getTokenSymbol } from "@rhinestone/sdk/dist/src/orchestrator";

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
  account: Address,
): `0x${string}` {
  if (tokenSymbol === "ETH") {
    throw new Error("ETH does not have a balance slot (native token)");
  }
  // common balance slots for popular tokens:
  const balanceSlots: Record<string, Record<number, number>> = {
    USDC: {
      1: 9,
      137: 9,
      42161: 9,
      8453: 9,
    },
    USDT: {
      1: 2,
      137: 0,
      42161: 51,
      8452: 51,
    },
    WETH: {
      1: 3,
      137: 3,
      42161: 51,
      8453: 3,
    },
  };

  const balanceSlot = balanceSlots[tokenSymbol]?.[chainId] ?? 0;

  // calculate storage slot: keccak256(abi.encode(account, balanceSlot))
  const slot = keccak256(
    encodePacked(["address", "uint256"], [account, BigInt(balanceSlot)]),
  );

  return slot;
}

async function handleSourceTokensWithSymbols(
  account: Address,
  chain: ReturnType<typeof getChain>,
  testClient: ReturnType<typeof createTestClient>, 
  sourceToken: string
) {
  if (sourceToken === "ETH") {
    await testClient.setBalance({
      address: account,
      value: 100000000000000000000000000000000000000000n,
    });
  } else {
    const tokenAddress = getTokenAddress(
      sourceToken as TokenSymbol,
      chain.id,
    );
    const tokenBalanceSlot = getTokenBalanceSlot(
      sourceToken as TokenSymbol,
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

async function handleSourceTokensWithAmount(
  account: Address,
  chain: ReturnType<typeof getChain>,
  testClient: ReturnType<typeof createTestClient>, 
  sourceToken: { chain: Chain, address: Address, amount?: bigint }
) {
  if (sourceToken.address === zeroAddress) {
    await testClient.setBalance({
      address: account,
      value: 100000000000000000000000000000000000000000n,
    });
  } else {
    const tokenSymbol = getTokenSymbol(
      sourceToken.address,
      chain.id,
    );
    const tokenBalanceSlot = getTokenBalanceSlot(
      tokenSymbol as TokenSymbol,
      sourceToken.chain.id,
      account,
    );

    await testClient.setStorageAt({
      address: sourceToken.address,
      index: tokenBalanceSlot,
      value: pad(toHex(100000000000000000000000000000000000000000n)),
    });
  }
}

export const fundAccount = async ({
  account,
  sourceChains,
  sourceTokens,
}: {
  account: Address;
  sourceChains: string[];
  sourceTokens: SourceTokens;
}) => {
  if (process.env.LOCAL_TESTNET?.toString() === "true") {
    for (const sourceChain of sourceChains) {
      const chain = getChain(sourceChain);

      console.log("Funding on %s for %s", chain.name, account);

      const testClient = createTestClient({
        chain,
        mode: "anvil",
        transport: http(lookup(chain)),
      });
      for (const sourceToken of sourceTokens) {
        if (typeof sourceToken === 'string') {
          await handleSourceTokensWithSymbols(
            account,
            chain,
            testClient,
            sourceToken,
          )
        } else {
          await handleSourceTokensWithAmount(
            account,
            chain,
            testClient,
            sourceToken,
          )
        }
      }
    }
  }
};
