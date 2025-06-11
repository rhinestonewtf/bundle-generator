import { parseEther, parseUnits } from "viem";
import { Token } from "../types.js";

export const convertTokenAmount = ({ token }: { token: Token }) => {
  if (token.symbol == "ETH" || token.symbol == "WETH") {
    return parseEther(token.amount);
  } else if (token.symbol == "USDC" || token.symbol == "USDT") {
    return parseUnits(token.amount, 6);
  } else {
    throw new Error("Unsupported token");
  }
};
