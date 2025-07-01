import { OWNABLE_VALIDATOR_ADDRESS } from "@rhinestone/module-sdk";
import { Address, encodePacked, Hex, LocalAccount } from "viem";
import {
  getOrderBundleHash,
  type Execution,
  type MultiChainCompact,
  type SignedMultiChainCompact,
} from "@rhinestone/sdk/orchestrator";
import { getCompactDomainSeparator, hash } from "./hashing";
import { DEFAULT_CONFIG_ID, hashTypedData } from "../compact";
import { toClaimHashAndTypehashFromTest } from "./new-hashing";
import { toViemHash } from "./hashing-viem";

export function getEmissaryCompactDigest(bundle: any): Hex {
  // const claimHash = hash(bundle);
  const { claimHash, compactTypehash } = toClaimHashAndTypehashFromTest({
    intent: bundle,
  });

  const notarizedCompactDomainSeparator = {
    ...getCompactDomainSeparator(Number(bundle.elements[0].chainId)),
    verifyingContract: "0xa2E6C7Ba8613E1534dCB990e7e4962216C0a5d58" as Address, // NOTE: Weird issue here
  };

  return hashTypedData(notarizedCompactDomainSeparator, claimHash);
}

export const signOrderBundle = async ({
  intentOp,
  owner,
}: {
  intentOp: any;
  owner: LocalAccount;
}) => {
  const orderBundleHash = getEmissaryCompactDigest(intentOp);
  const viemHash = toViemHash(intentOp);

  console.log("Order Bundle Hash:", orderBundleHash);
  console.log("Viem Hash:", viemHash);

  // if (orderBundleHash !== viemHash) {
  //   throw new Error("Order Bundle Hash does not match Viem hash");
  // }

  const bundleSignature = await owner.signMessage({
    message: { raw: viemHash },
  });
  const packedSig = encodePacked(
    ["address", "uint8", "bytes"],
    [OWNABLE_VALIDATOR_ADDRESS, DEFAULT_CONFIG_ID, bundleSignature],
  );

  const signedIntentOp = {
    ...intentOp,
    originSignatures: Array(intentOp.elements.length).fill(packedSig),
    destinationSignature: packedSig,
  };
  return signedIntentOp;
};
