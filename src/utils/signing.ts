import {
  getOwnableValidator,
  getOwnableValidatorSignature,
} from "@rhinestone/module-sdk";
import {
  Address,
  encodePacked,
  hashStruct,
  hashTypedData,
  keccak256,
  LocalAccount,
  slice,
  toHex,
  zeroAddress,
} from "viem";
import { COMPACT_ADDRESS, DEFAULT_EMISSARY_CONFIG_ID } from "../compact";

function getClaimProofer(settlementLayer: string): Address {
  switch (settlementLayer) {
    case "SAME_CHAIN":
      return zeroAddress;
    case "ACROSS":
      return "0x1636b30481Db91Bbc5818e65d3962838BdCd5569";
    case "ECO":
      return "0x0746dc2CdcbF6270c9C53D1C4923604448cf3e94";
    default:
      throw new Error(
        `Unsupported settlement system: ${settlementLayer}. Supported systems are: SAME_CHAIN, ACROSS, ECO.`,
      );
  }
}

function toSignatureHash(intentOp: any) {
  const notarizedChainElement = intentOp.elements[0];
  const settlementSystem =
    notarizedChainElement.mandate.qualifier.settlementSystem;
  return hashTypedData({
    domain: {
      name: "The Compact",
      version: "1",
      chainId: notarizedChainElement.chainId,
      verifyingContract: COMPACT_ADDRESS,
    },
    types: {
      MultichainCompact: [
        { name: "sponsor", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "expires", type: "uint256" },
        { name: "elements", type: "Element[]" },
      ],
      Element: [
        { name: "arbiter", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "commitments", type: "Lock[]" },
        { name: "mandate", type: "Mandate" },
      ],
      Lock: [
        { name: "lockTag", type: "bytes12" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      Mandate: [
        { name: "target", type: "Target" },
        { name: "originOps", type: "Op[]" },
        { name: "destOps", type: "Op[]" },
        { name: "q", type: "bytes32" },
      ],
      Target: [
        { name: "recipient", type: "address" },
        { name: "tokenOut", type: "Token[]" },
        { name: "targetChain", type: "uint256" },
        { name: "fillExpiry", type: "uint256" },
        { name: "claimProofer", type: "address" },
      ],
      Token: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      Op: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
      ],
    },
    primaryType: "MultichainCompact",
    message: {
      sponsor: intentOp.sponsor,
      nonce: intentOp.nonce,
      expires: intentOp.expires,
      elements: intentOp.elements.map((element: any) => ({
        arbiter: element.arbiter,
        chainId: element.chainId,
        commitments: element.idsAndAmounts.map((token: any) => ({
          lockTag: slice(toHex(token[0]), 0, 12),
          token: slice(toHex(token[0]), 12, 32),
          amount: token[1],
        })),
        mandate: {
          target: {
            recipient: element.mandate.recipient,
            tokenOut: element.mandate.tokenOut.map((token: any) => ({
              token: slice(toHex(token[0]), 12, 32),
              amount: token[1],
            })),
            targetChain: element.mandate.destinationChainId,
            fillExpiry: element.mandate.fillDeadline,
            claimProofer: getClaimProofer(settlementSystem),
          },
          originOps: element.mandate.preClaimOps.map((op: any) => ({
            to: op.to,
            value: op.value,
            data: op.data,
          })),
          destOps: element.mandate.destinationOps.map((op: any) => ({
            to: op.to,
            value: op.value,
            data: op.data,
          })),
          q: keccak256(element.mandate.qualifier?.encodedVal ?? "0x"),
        },
      })),
    },
  });
}

export const signOrderBundle = async ({
  intentOp,
  owner,
  usingEmissary = false,
}: {
  intentOp: any;
  owner: LocalAccount;
  usingEmissary?: boolean;
}) => {
  const orderBundleHash = toSignatureHash(intentOp);

  console.log("hash to sign", orderBundleHash);
  const OWNABLE_VALIDATOR_ADDRESS =
    "0x0000000000E9E6E96Bcaa3c113187CdB7E38AED9";
  const signature = await owner.signMessage({
    message: { raw: orderBundleHash },
  });
  const ownableValidatorSig = getOwnableValidatorSignature({
    signatures: [signature],
  });
  const encodedSignature = usingEmissary
    ? encodePacked(
      ["address", "uint8", "bytes"],
      [
        OWNABLE_VALIDATOR_ADDRESS,
        DEFAULT_EMISSARY_CONFIG_ID,
        ownableValidatorSig,
      ],
    )
    : encodePacked(
      ["address", "bytes"],
      [OWNABLE_VALIDATOR_ADDRESS, ownableValidatorSig],
    );

  const signedIntentOp = {
    ...intentOp,
    originSignatures: Array(intentOp.elements.length).fill(encodedSignature),
    destinationSignature: encodedSignature,
  };
  return signedIntentOp;
};
