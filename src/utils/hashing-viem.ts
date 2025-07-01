import { hashTypedData, slice, toHex, zeroAddress, zeroHash } from "viem";

export function toViemHash(intentOp: any) {
  const notarizedChainElement = intentOp.elements[0];
  return hashTypedData({
    domain: {
      name: "The Compact",
      version: "1",
      chainId: notarizedChainElement.chainId,
      verifyingContract: "0xa2E6C7Ba8613E1534dCB990e7e4962216C0a5d58",
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
            claimProofer: zeroAddress,
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
          // q: element.mandate.qualifier.encodedVal,
          q: zeroHash,
        },
      })),
    },
  });
}

export function toViemHashHardcoded(intentOp: any) {
  const notarizedChainElement = intentOp.elements[0];
  return hashTypedData({
    domain: {
      name: "The Compact",
      version: "1",
      chainId: notarizedChainElement.chainId,
      verifyingContract: "0xa2E6C7Ba8613E1534dCB990e7e4962216C0a5d58",
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
      sponsor: "0x0000000000000000000000000000000000000006",
      nonce: 1n,
      expires: 2000n,
      elements: [
        {
          arbiter: "0x0000000000000000000000000000000000000004",
          chainId: 1n,
          commitments: [
            {
              lockTag: "0x100000000000000000000000",
              token: "0x0000000000000000000000000000000000000005",
              amount: 50n,
            },
          ],
          mandate: {
            target: {
              recipient: "0x0000000000000000000000000000000000000001",
              tokenOut: [
                {
                  token: "0x0000000000000000000000000000000000000003",
                  amount: 100n,
                },
              ],
              targetChain: 1n,
              fillExpiry: 1000n,
              claimProofer: "0x0000000000000000000000000000000000000002",
              // claimProofer: zeroAddress,
            },
            originOps: [
              {
                to: "0x0000000000000000000000000000000000000001",
                value: 0n,
                data: "0x",
              },
            ],
            destOps: [
              {
                to: "0x0000000000000000000000000000000000000002",
                value: 0n,
                data: "0x",
              },
            ],
            // q: element.mandate.qualifier.encodedVal,
            q: zeroHash,
          },
        },
      ],
    },
  });
}
