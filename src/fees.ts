import { BundleResult, OrderPath } from "@rhinestone/sdk/orchestrator";
import { createPublicClient, Hex, http } from "viem";
import { OpStackTransactionReceipt } from "viem/chains";
import { getChainById } from "./utils/chains";

export const handleFeeAnalysis = async ({
  result,
  orderPath,
}: {
  result: BundleResult;
  orderPath: OrderPath;
}) => {
  console.log(result);
  console.dir(orderPath, { depth: null });
  if (result.status !== "COMPLETED") return {};
  const gasCalculations = {
    fill: 0n,
    claims: {} as { [chainId: number]: bigint },
  };
  let totalCost = 0n;
  const targetChainId = Number(
    orderPath[0].orderBundle.segments[0].witness.targetChain,
  );
  const fillCost = await getTxCost({
    txHash: result.fillTransactionHash as Hex,
    chainId: targetChainId,
  });
  totalCost += fillCost;
  gasCalculations.fill = fillCost;

  for (const claim of result.claims) {
    if (claim.chainId !== targetChainId) {
      const claimCost = await getTxCost({
        txHash: claim.claimTransactionHash as Hex,
        chainId: claim.chainId,
      });
      totalCost += claimCost;
      gasCalculations.claims[claim.chainId] = claimCost;
    }
  }
};

const getTxCost = async ({
  txHash,
  chainId,
}: {
  txHash: Hex;
  chainId: number;
}) => {
  const client = getPublicClient(chainId);
  const fillTx = (await client.getTransactionReceipt({
    hash: txHash,
  })) as OpStackTransactionReceipt;
  // console.dir(fillTx, { depth: null });
  const l2Cost = Number(fillTx.gasUsed) * Number(fillTx.effectiveGasPrice);
  // const l1Cost = BigInt(Number(fillTx.l1Fee)) ?? 0n;
  // const fillCost = BigInt(l2Cost) + l1Cost;
  const fillCost = BigInt(l2Cost);
  return fillCost;
};

const getPublicClient = (chainId: number) => {
  return createPublicClient({
    transport: http(getChainById(chainId).rpcUrls.default.http[0]),
  });
};
