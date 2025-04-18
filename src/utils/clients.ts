import { Chain, createPublicClient, http } from "viem";

export const getPublicClient = (chain: Chain) => {
  return createPublicClient({
    chain: chain,
    transport: http(),
  });
};
