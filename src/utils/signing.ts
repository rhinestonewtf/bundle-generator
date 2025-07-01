import { OWNABLE_VALIDATOR_ADDRESS } from "@rhinestone/module-sdk";
import { Address, encodePacked, Hex, hexToBigInt, LocalAccount } from "viem";
import {
  getOrderBundleHash,
  type Execution,
  type MultiChainCompact,
  type SignedMultiChainCompact,
} from "@rhinestone/sdk/orchestrator";
import { getCompactDomainSeparator, hash } from "./hashing";
import { DEFAULT_CONFIG_ID, hashTypedData } from "../compact";
import { toClaimHashAndTypehashFromTest } from "./new-hashing";
import { toViemHash, toViemHashHardcoded } from "./hashing-viem";

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

const mockIntentOp: any = {
  sponsor: "0x0000000000000000000000000000000000000006",
  nonce: 1n,
  expires: 2000n,
  elements: [
    {
      arbiter: "0x0000000000000000000000000000000000000004" as Address,
      chainId: 1,
      idsAndAmounts: [
        [
          hexToBigInt(
            "0x1000000000000000000000000000000000000000000000000000000000000005",
          ),
          50n,
        ],
      ],
      mandate: {
        recipient: "0x0000000000000000000000000000000000000001" as Address,
        tokenOut: [
          [
            hexToBigInt(
              "0x1000000000000000000000000000000000000000000000000000000000000003",
            ),
            100n,
          ],
        ],
        destinationChainId: 1,
        fillDeadline: 1000n,
        preClaimOps: [
          {
            to: "0x0000000000000000000000000000000000000001",
            value: 0n,
            data: "0x",
          },
        ],
        destinationOps: [
          {
            to: "0x0000000000000000000000000000000000000002",
            value: 0n,
            data: "0x",
          },
        ],
      },
    },
  ],
};

export const signOrderBundle = async ({
  intentOp,
  owner,
}: {
  intentOp: any;
  owner: LocalAccount;
}) => {
  console.dir(intentOp, { depth: null });
  // const orderBundleHash = getEmissaryCompactDigest(intentOp);
  const viemHash = toViemHash(intentOp);

  const mockHash = toViemHash(mockIntentOp);
  console.log("Mock Order Bundle Hash:", mockHash);

  const hardcodedMockHash = toViemHashHardcoded(mockIntentOp);
  console.log("Hardcoded Mock Order Bundle Hash:", hardcodedMockHash);

  const realHash =
    "0x4d0cfac32252459b882d86d7fa984549b94c1099be87b6d8734df212e1c29ed2";
  console.log("Real Order Bundle Hash:", realHash);

  const match = mockHash === realHash;
  console.log("Hash Match:", match);

  // console.log("Order Bundle Hash:", orderBundleHash);
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
