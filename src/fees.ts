import { BundleResult, OrderPath } from "@rhinestone/sdk/orchestrator";
import { createPublicClient, Hex, http } from "viem";
import { OpStackTransactionReceipt } from "viem/chains";
import { getChainById } from "./utils/chains";

type GasComparison = {
  [chainId: number]: {
    estimated: bigint;
    actual: bigint;
    difference: bigint;
    percentageDifference: number;
  };
};

export const handleFeeAnalysis = async ({
  result,
  orderPath,
}: {
  result: BundleResult;
  orderPath: OrderPath;
}) => {
  if (result.status !== "COMPLETED") return {};
  const gasComparison: GasComparison = {};
  const gasPriceComparison: GasComparison = {};

  const gasEstimates = orderPath[0].orderBundle.gasPrices;
  const gasPrices = orderPath[0].orderBundle.gasPrices;

  let totalGasUsed = 0n;
  let totalCost = 0n;
  const targetChainId = Number(
    orderPath[0].orderBundle.segments[0].witness.targetChain,
  );

  const fillCost = await getTxCost({
    txHash: result.fillTransactionHash as Hex,
    chainId: targetChainId,
  });

  totalGasUsed += fillCost.gasUsed;
  totalCost += fillCost.gasUsed * fillCost.gasPrice;

  gasComparison[targetChainId] = getGasComparison({
    gas: fillCost.gasUsed,
    chainId: targetChainId,
    estimates: gasEstimates,
  });

  gasPriceComparison[targetChainId] = getGasComparison({
    gas: fillCost.gasPrice,
    chainId: targetChainId,
    estimates: gasPrices,
  });

  for (const claim of result.claims) {
    if (claim.chainId !== targetChainId) {
      const claimCost = await getTxCost({
        txHash: claim.claimTransactionHash as Hex,
        chainId: claim.chainId,
      });

      totalGasUsed += claimCost.gasUsed;
      totalCost += claimCost.gasUsed * claimCost.gasPrice;

      gasComparison[claim.chainId] = getGasComparison({
        gas: claimCost.gasUsed,
        chainId: claim.chainId,
        estimates: gasEstimates,
      });
      gasPriceComparison[claim.chainId] = getGasComparison({
        gas: claimCost.gasPrice,
        chainId: claim.chainId,
        estimates: gasPrices,
      });
    }
  }
  return {
    totalGasUsed,
    totalCost,
    gasComparison,
    gasPriceComparison,
  };
};

const getGasComparison = ({
  gas,
  chainId,
  estimates,
}: {
  gas: bigint;
  chainId: number;
  estimates: Record<string, bigint>;
}) => {
  const gasEstimated = BigInt(estimates[String(chainId)]) ?? 0n;
  const difference = gasEstimated - gas;
  const percentageDifference =
    (Number(difference) / ((Number(gas) + Number(gasEstimated)) / 2)) * 100;
  return {
    estimated: gasEstimated,
    actual: gas,
    difference,
    percentageDifference: Number(percentageDifference),
  };
};

const getTxCost = async ({
  txHash,
  chainId,
}: {
  txHash: Hex;
  chainId: number;
}) => {
  const client = getPublicClient(chainId);
  const tx = await client.getTransactionReceipt({
    hash: txHash,
  });
  // const l2Cost = Number(tx.gasUsed) * Number(tx.effectiveGasPrice);
  // const l1Cost = BigInt(Number(tx.l1Fee)) ?? 0n;
  // const fillCost = BigInt(l2Cost) + l1Cost;
  // const fillCost = BigInt(l2Cost);
  return {
    gasUsed: tx.gasUsed,
    gasPrice: tx.effectiveGasPrice,
  };
};

const getPublicClient = (chainId: number) => {
  return createPublicClient({
    transport: http(getChainById(chainId).rpcUrls.default.http[0]),
  });
};
