import { Chain, createPublicClient, http } from "viem";
import { getChainById } from "./chains";

export const getPublicClient = (chain: Chain) => {
  return createPublicClient({
    chain: chain,
    transport: http(),
  });
};

export const getPublicClientByChainId = (chainId: number) => {
  return createPublicClient({
    transport: http(getChainById(chainId).rpcUrls.default.http[0]),
  });
};
