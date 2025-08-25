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
  soneium,
  zksync,
  sonic,
  sonicTestnet
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
    case "Soneium":
      return soneium;
    case "Sonic":
      return sonic;
    case "Sepolia":
      return sepolia;
    case "OpSepolia":
      return optimismSepolia;
    case "ArbSepolia":
      return arbitrumSepolia;
    case "BaseSepolia":
      return baseSepolia;
    case "SonicTestnet":
      return sonicTestnet;
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
    case zksync.id:
      return zksync;
    case soneium.id:
      return soneium;
    case sonic.id:
      return sonic;
    case sepolia.id:
      return sepolia;
    case optimismSepolia.id:
      return optimismSepolia;
    case arbitrumSepolia.id:
      return arbitrumSepolia;
    case baseSepolia.id:
      return baseSepolia;
    case sonicTestnet.id:
      return sonicTestnet;
    default:
      throw new Error(`Chain ID ${chainId} not supported`);
  }
};
