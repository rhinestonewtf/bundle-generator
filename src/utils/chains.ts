import * as viemChains from "viem/chains";

export const getChain = (name: string) => {
  const chain = Object.values(viemChains).find(
    (chain) =>
      (chain.name as string).replace(/ /g, "").toLowerCase() ==
      name.toLowerCase(),
  );
  if (!chain) {
    throw new Error(
      `Chain ${name} is not supported. Use the viem chain name without spaces.`,
    );
  }
  return chain;
};

export const getChainById = (chainId: number) => {
  const chain = Object.values(viemChains).find((chain) => chain.id == chainId);
  if (!chain) {
    throw new Error(`Chain with id ${chainId} is not supported.`);
  }
  return chain;
};
