import { OrderPath, PostOrderBundleResult } from "@rhinestone/sdk/orchestrator";

export const handleFeeAnalysis = async ({
  result,
  orderPath,
}: {
  result: PostOrderBundleResult;
  orderPath: OrderPath;
}) => {
  console.log(result);
  console.dir(orderPath, { depth: null });
};
