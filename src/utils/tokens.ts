import {
  createPublicClient,
  http,
  isAddress,
  parseUnits,
  erc20Abi,
} from "viem";
import { Token } from "../types.js";
import { getTokenDecimals, TokenSymbol } from "@rhinestone/sdk";
import { getChainById } from "./chains.js";

export const convertTokenAmount = async ({
  token,
  chainId,
}: {
  token: Token;
  chainId: number;
}) => {
  if (isAddress(token.symbol)) {
    const publicClient = createPublicClient({
      chain: getChainById(chainId),
      transport: http(),
    });
    const decimals = await publicClient.readContract({
      address: token.symbol,
      abi: erc20Abi,
      functionName: "decimals",
    });
    return parseUnits(token.amount, decimals);
  } else {
    const decimals = getTokenDecimals(token.symbol as TokenSymbol, chainId);
    return parseUnits(token.amount, decimals);
  }
};
