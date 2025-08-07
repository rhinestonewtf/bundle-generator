import { Hex } from "viem";
import { BundleResult, OrderPath } from "./utils/sdk-registry";
import { getPublicClientByChainId } from "./utils/clients";

type GasComparison = {
  [chainId: number]: {
    estimate: bigint;
    actual: bigint;
    difference: bigint;
    percentageDifference: number;
  };
};

export const handleFeeAnalysis = async ({
  result,
  orderPath,
  targetGasUnits,
}: {
  result: BundleResult;
  orderPath: OrderPath;
  targetGasUnits: bigint;
}) => {
  if (result.status !== "COMPLETED") return {};
  const gasComparison: GasComparison = {};
  const gasPriceComparison: GasComparison = {};

  const gasPrices = orderPath[0].orderBundle.gasPrices;

  let totalGasUsed = 0n;
  let totalCost = 0n;
  const targetChainId = Number(
    orderPath[0].orderBundle.segments[0].witness.targetChain
  );

  const fillCost = await getTxCost({
    txHash: result.fillTransactionHash as Hex,
    chainId: targetChainId,
  });

  totalGasUsed += fillCost.gasUsed;
  totalCost += fillCost.gasUsed * fillCost.gasPrice;

  gasComparison[targetChainId] = getGasComparison({
    actual: fillCost.gasUsed,
    estimate: targetGasUnits, // default 1m gas
  });

  gasPriceComparison[targetChainId] = getGasComparison({
    actual: fillCost.gasPrice,
    // @ts-ignore
    estimate: BigInt(gasPrices[targetChainId]) || 0n,
  });

  for (const claim of result.claims || []) {
    if (claim.chainId !== targetChainId) {
      const claimCost = await getTxCost({
        txHash: claim.claimTransactionHash as Hex,
        chainId: claim.chainId,
      });

      totalGasUsed += claimCost.gasUsed;
      totalCost += claimCost.gasUsed * claimCost.gasPrice;

      gasComparison[claim.chainId] = getGasComparison({
        actual: claimCost.gasUsed,
        estimate: getClaimGasEstimate({
          segments: orderPath[0].orderBundle.segments,
          targetChainId,
        }),
      });
      gasPriceComparison[claim.chainId] = getGasComparison({
        actual: claimCost.gasPrice,
        // @ts-ignore
        estimate: BigInt(gasPrices[claim.chainId]) || 0n,
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

const getClaimGasEstimate = ({
  targetChainId,
  segments,
}: {
  targetChainId: number;
  segments: any;
}) => {
  const numberOfSegments = segments.filter(
    (segment: any) => segment.chainId !== targetChainId
  ).length;
  return BigInt(numberOfSegments) * 470_000n; // 470k gas per segment
};

const getGasComparison = ({
  actual,
  estimate,
}: {
  actual: bigint;
  estimate: bigint;
}) => {
  const difference = estimate - actual;
  const percentageDifference =
    (Number(difference) / ((Number(actual) + Number(estimate)) / 2)) * 100;
  return {
    estimate,
    actual,
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
  const client = getPublicClientByChainId(chainId);
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
