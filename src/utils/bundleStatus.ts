import {
  BundleStatus,
  type PostOrderBundleResult,
} from "@rhinestone/sdk/orchestrator";
import { ts } from "../main.js";

export const waitForBundleResult = async ({
  orchestrator,
  bundleResults,
  bundleLabel = "",
  maxWaitTime = 60000,
}: {
  orchestrator: any;
  bundleResults: PostOrderBundleResult;
  bundleLabel?: string;
  maxWaitTime?: number;
}) => {
  const startTime = Date.now();

  let bundleStatus = await orchestrator.getBundleStatus(
    bundleResults[0].bundleId,
  );

  console.log(
    `${ts()} Bundle ${bundleLabel ? bundleLabel + ": " : ""}Pending...`,
  );

  // Check again every 2 seconds until the status changes or timeout is reached
  while (
    bundleStatus.status === BundleStatus.PENDING ||
    bundleStatus.status === BundleStatus.PARTIALLY_COMPLETED ||
    bundleStatus.status == "PRECONFIRMED" ||
    bundleStatus.status == "FILLED"
  ) {
    // Check if we've exceeded the maximum wait time
    if (Date.now() - startTime > maxWaitTime) {
      break; // Exit the loop
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    bundleStatus = await orchestrator.getBundleStatus(
      bundleResults[0].bundleId,
    );
  }

  return bundleStatus;
};
