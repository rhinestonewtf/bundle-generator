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

export function getEmissaryCompactDigest(bundle: any): Hex {
  const claimHash = hash(bundle);
  const notarizedCompactDomainSeparator = {
    ...getCompactDomainSeparator(Number(bundle.elements[0].chainId)),
    verifyingContract: "0x66c78EDBb13aF2Cb8990d1E70eb25C29c2921e69" as Address, // NOTE: Weird issue here
  };

  return hashTypedData(notarizedCompactDomainSeparator, claimHash);
}

export const signOrderBundle = async ({
  orderBundle,
  owner,
}: {
  orderBundle: any;
  owner: LocalAccount;
}) => {
  const orderBundleHash = getEmissaryCompactDigest(orderBundle);

  const bundleSignature = await owner.signMessage({
    message: { raw: orderBundleHash },
  });
  const packedSig = encodePacked(
    ["address", "uint8", "bytes"],
    [OWNABLE_VALIDATOR_ADDRESS, DEFAULT_CONFIG_ID, bundleSignature],
  );

  const signedOrderBundle = {
    ...orderBundle,
    originSignatures: Array(orderBundle.elements.length).fill(packedSig),
    targetSignature: packedSig,
  };
  return signedOrderBundle;
};
