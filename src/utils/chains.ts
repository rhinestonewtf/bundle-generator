import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  sepolia,
  zksync,
} from "viem/chains";

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
    case "Optimism":
      return optimism;
    case "ZkSync":
      return zksync;
    case "Sepolia":
      return sepolia;
    case "OpSepolia":
      return optimismSepolia;
    case "ArbSepolia":
      return arbitrumSepolia;
    case "BaseSepolia":
      return baseSepolia;
    default:
      throw new Error(`Chain ${name} not supported`);
  }
};
