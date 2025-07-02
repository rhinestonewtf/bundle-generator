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
  sponsor: "0x5b04415cB6E002F2f315531CFa56b1112A2159AA",
  nonce:
    9640911881560008175144633844095210830337614424550972085581633153162897522688n,
  expires: 1782982338n,
  elements: [
    {
      arbiter: "0x306ba68E347D83E6171389E80E0B7Be978a5303A" as Address,
      chainId: 8453,
      idsAndAmounts: [
        [
          21854126412662723981022530371211081521698004233493962776526716101293957447680n,
          2320010528690n,
        ],
      ],
      mandate: {
        recipient: "0x5b04415cB6E002F2f315531CFa56b1112A2159AA" as Address,
        tokenOut: [
          [
            21854126412662723981022530371960153272591467524068739237857809954054699231507n,
            10n,
          ],
        ],
        destinationChainId: 8453,
        fillDeadline: 1751446638n,
        preClaimOps: [],
        destinationOps: [
          {
            to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            value: "0",
            data: "0xa9059cbb000000000000000000000000f7c012789aac54b5e33ea5b88064ca1f1172de05000000000000000000000000000000000000000000000000000000000000000a",
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
  console.log(
    "actual hash: 0x2816b61cc9f9250eb11815f8f583caa54707c63322f1609a6378657a389b7cb8",
  );

  // const hardcodedMockHash = toViemHashHardcoded(mockIntentOp);
  // console.log("Hardcoded Mock Order Bundle Hash:", hardcodedMockHash);

  // const realHash =
  //   "0x4d0cfac32252459b882d86d7fa984549b94c1099be87b6d8734df212e1c29ed2";
  // console.log("Real Order Bundle Hash:", realHash);
  //
  // const match = mockHash === realHash;
  // console.log("Hash Match:", match);

  // console.log("Order Bundle Hash:", orderBundleHash);
  console.log("Viem Hash:", viemHash);

  // if (orderBundleHash !== viemHash) {
  //   throw new Error("Order Bundle Hash does not match Viem hash");
  // }

  const bundleSignature = await owner.signMessage({
    message: { raw: viemHash },
  });
  // const packedSig = encodePacked(
  //   ["address", "uint8", "bytes"],
  //   [OWNABLE_VALIDATOR_ADDRESS, DEFAULT_CONFIG_ID, bundleSignature],
  // );
  const packedSig = encodePacked(
    ["address", "bytes"],
    [OWNABLE_VALIDATOR_ADDRESS, bundleSignature],
  );

  const signedIntentOp = {
    ...intentOp,
    originSignatures: Array(intentOp.elements.length).fill(packedSig),
    destinationSignature: packedSig,
  };
  return signedIntentOp;
};
