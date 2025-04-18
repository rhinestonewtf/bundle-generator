import { OWNABLE_VALIDATOR_ADDRESS } from "@rhinestone/module-sdk";
import { encodePacked, LocalAccount } from "viem";
const { getOrderBundleHash } = require("@rhinestone/orchestrator-sdk");
import type {
  Execution,
  MultiChainCompact,
  SignedMultiChainCompact,
} from "@rhinestone/orchestrator-sdk";

export const signOrderBundle = async ({
  orderPath,
  owner,
}: {
  orderPath: {
    orderBundle: MultiChainCompact;
    injectedExecutions: Execution[];
  }[];
  owner: LocalAccount;
}) => {
  const orderBundleHash = getOrderBundleHash(orderPath[0].orderBundle);

  const bundleSignature = await owner.signMessage({
    message: { raw: orderBundleHash },
  });
  const packedSig = encodePacked(
    ["address", "bytes"],
    [OWNABLE_VALIDATOR_ADDRESS, bundleSignature],
  );

  const signedOrderBundle: SignedMultiChainCompact = {
    ...orderPath[0].orderBundle,
    originSignatures: Array(orderPath[0].orderBundle.segments.length).fill(
      packedSig,
    ),
    targetSignature: packedSig,
  };
  return signedOrderBundle;
};
