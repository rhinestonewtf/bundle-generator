const { BundleStatus } = require("@rhinestone/orchestrator-sdk");
import type { PostOrderBundleResult } from "@rhinestone/orchestrator-sdk";

export const waitForBundleResult = async ({
  orchestrator,
  bundleResults,
  maxWaitTime = 60000,
}: {
  orchestrator: any;
  bundleResults: PostOrderBundleResult;
  maxWaitTime?: number;
}) => {
  const startTime = Date.now();

  let bundleStatus = await orchestrator.getBundleStatus(
    bundleResults[0].bundleId,
  );

  // Check again every 2 seconds until the status changes or timeout is reached
  while (
    bundleStatus.status === BundleStatus.PENDING ||
    bundleStatus.status === BundleStatus.PARTIALLY_COMPLETED
  ) {
    // Check if we've exceeded the maximum wait time
    if (Date.now() - startTime > maxWaitTime) {
      break; // Exit the loop
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
    bundleStatus = await orchestrator.getBundleStatus(
      bundleResults[0].bundleId,
    );
  }

  return bundleStatus;
};
