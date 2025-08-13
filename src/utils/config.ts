import { getChainById } from "./chains";

const PROD_ORCHESTRATOR_URL = "https://v1.orchestrator.rhinestone.dev";
const STAGING_ORCHESTRATOR_URL =
  "https://staging.v1.orchestrator.rhinestone.dev";

export const getOrchestratorUrl = (chainId: number) => {
  return isTestnet(chainId) ? STAGING_ORCHESTRATOR_URL : PROD_ORCHESTRATOR_URL;
};

function isTestnet(chainId: number): boolean {
  const chain = getChainById(chainId);
  if (!chain) {
    throw new Error(`Chain not supported: ${chainId}`);
  }
  return chain.testnet ?? false;
}
