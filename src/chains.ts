import { arbitrum, base, mainnet, polygon } from "viem/chains";

export const getChain = (name: string) => {
  switch (name) {
    case "Ethereum":
      return mainnet;
    case "Polygon":
      return polygon;
    case "Arbitrum":
      return arbitrum;
    case "Base":
      return base;
    default:
      throw new Error(`Chain ${name} not supported`);
  }
};
