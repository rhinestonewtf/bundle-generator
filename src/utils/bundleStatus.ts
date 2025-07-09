import { BundleResult, BundleStatus } from "@rhinestone/sdk/orchestrator";
import { ts } from "../main.js";
import axios from "axios";

const getBundleStatus = async (
  bundleId: bigint,
  bearerToken?: string
): Promise<BundleResult> => {
  const response = await axios.get(
    `${
      process.env.ORCHESTRATOR_API_URL
    }/intent-operation/${bundleId.toString()}/status`,
    {
      headers: {
        "x-api-key": process.env.ORCHESTRATOR_API_KEY,
        Authorization: `Bearer ${bearerToken}`,
      },
    }
  );

  return response.data;
};

export const waitForBundleResult = async ({
  orchestrator,
  bundleResult,
  bundleLabel = "",
  processStartTime,
  maxWaitTime = 20000,
  iterationTime = 500,
  bearerToken,
}: {
  orchestrator: any;
  bundleResult: any;
  processStartTime: number;
  bundleLabel?: string;
  maxWaitTime?: number;
  iterationTime?: number;
  bearerToken?: string;
}) => {
  const startTime = Date.now();

  let bundleStatus = await getBundleStatus(bundleResult.id, bearerToken);
  console.dir(bundleStatus, { depth: null });

  console.log(
    `${ts()} Bundle ${bundleLabel ? bundleLabel + ": " : ""}Pending...`
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
          `${ts()} Bundle ${bundleLabel}: Preconfirmed in ${
            new Date().getTime() - processStartTime
          }ms`
        );
        isPreconfirmed = true;
      }
    }

    if (bundleStatus.status === BundleStatus.FILLED) {
      if (isFilled) {
        console.log(
          `${ts()} Bundle ${bundleLabel}: Filled in ${
            new Date().getTime() - processStartTime
          }ms`
        );
        isFilled = true;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, iterationTime));
    bundleStatus = await getBundleStatus(bundleResult.id, bearerToken);
  }

  return bundleStatus;
};
