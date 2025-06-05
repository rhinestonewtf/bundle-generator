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

export const getChainById = (chainId: number) => {
  switch (chainId) {
    case mainnet.id:
      return mainnet;
    case polygon.id:
      return polygon;
    case arbitrum.id:
      return arbitrum;
    case base.id:
      return base;
    case optimism.id:
      return optimism;
    case sepolia.id:
      return sepolia;
    case optimismSepolia.id:
      return optimismSepolia;
    case arbitrumSepolia.id:
      return arbitrumSepolia;
    case baseSepolia.id:
      return baseSepolia;
    default:
      throw new Error(`Chain ID ${chainId} not supported`);
  }
};
