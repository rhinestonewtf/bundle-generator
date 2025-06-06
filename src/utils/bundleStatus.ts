import {
  BundleStatus,
  type PostOrderBundleResult,
} from "@rhinestone/sdk/orchestrator";
import { ts } from "../main.js";

export const waitForBundleResult = async ({
  orchestrator,
  bundleResults,
  bundleLabel = "",
  processStartTime,
  maxWaitTime = 20000,
  iterationTime = 500,
}: {
  orchestrator: any;
  bundleResults: PostOrderBundleResult;
  processStartTime: number;
  bundleLabel?: string;
  maxWaitTime?: number;
  iterationTime?: number;
}) => {
  const startTime = Date.now();

  let bundleStatus = await orchestrator.getBundleStatus(
    bundleResults[0].bundleId,
  );

  console.log(
    `${ts()} Bundle ${bundleLabel ? bundleLabel + ": " : ""}Pending...`,
  );

  let isPreconfirmed = false;
  let isFilled = false;

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

    if (bundleStatus.status === BundleStatus.PRECONFIRMED) {
      if (!isPreconfirmed) {
        console.log(
          `${ts()} Bundle ${bundleLabel}: Preconfirmed in ${new Date().getTime() - processStartTime}ms`,
        );
        isPreconfirmed = true;
      }
    }

    if (bundleStatus.status === BundleStatus.FILLED) {
      if (isFilled) {
        console.log(
          `${ts()} Bundle ${bundleLabel}: Filled in ${new Date().getTime() - processStartTime}ms`,
        );
        isFilled = true;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, iterationTime));
    bundleStatus = await orchestrator.getBundleStatus(
      bundleResults[0].bundleId,
    );
  }

  return bundleStatus;
};
