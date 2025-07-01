import {
  Address,
  concat,
  encodeAbiParameters,
  Hex,
  hexToBigInt,
  keccak256,
  toBytes,
} from "viem";
import { Execution, getMandateHash, hash, hashTokenIn } from "./hashing";

type Component = {
  claimant: bigint;
  amount: bigint;
};

type BatchClaimComponent = {
  id: bigint;
  allocatedAmount: bigint;
  portions: Component[];
};

type BatchMultichainClaim = {
  allocatorData: Hex;
  sponsorSignature: Hex;
  sponsor: Address;
  nonce: bigint;
  expires: bigint;
  witness: Hex;
  witnessTypestring: string;
  claims: BatchClaimComponent[];
  additionalChains: Hex[];
};

function toCommitmentsHash({
  claims,
}: {
  claims: BatchClaimComponent[];
}): bigint {
  for (const claim of claims) {
  }

  return 0n;
}

function toMultichainClaimTypehashes({
  claim,
}: {
  claim: BatchMultichainClaim;
}): {
  allocationTypehash: Hex;
  compactTypehash: Hex;
} {
  // compactTypehash is the following
  // string memory fullMultichainString = string(
  //             abi.encodePacked(
  //                 "MultichainCompact(address sponsor,uint256 nonce,uint256 expires,Element[] elements)",
  //                 "Element(address arbiter,uint256 chainId,Lock[] commitments,Mandate mandate)Lock(bytes12 lockTag,address token,uint256 amount)",
  //                 "Mandate(",
  //                 witnessTypestring_,
  //                 ")"
  //             )
  //         );
  //
  //         string memory fullElementString = string(
  //             abi.encodePacked(
  //                 "Element(address arbiter,uint256 chainId,Lock[] commitments,Mandate mandate)Lock(bytes12 lockTag,address token,uint256 amount)",
  //                 "Mandate(",
  //                 witnessTypestring_,
  //                 ")"
  //             )
  //         );
  //
  //         multichainCompactTypehash_ = keccak256(bytes(fullMultichainString));
  //         elementTypehash_ = keccak256(bytes(fullElementString));
  return {
    allocationTypehash: "0x",
    compactTypehash: "0x",
  };
}

function toMultichainClaimHash({
  allocationTypehash,
  compactTypehash,
  commitmentsHash,
}: {
  allocationTypehash: Hex;
  compactTypehash: Hex;
  commitmentsHash: bigint;
}): Hex {
  //bytes32 expectedClaimHash = keccak256(
  //     abi.encode(expectedTypehash, batchClaim.sponsor, batchClaim.nonce, batchClaim.expires, elementsHash)
  // );
  return "0x";
}

export function toClaimHashAndTypehash({
  claim,
}: {
  claim: BatchMultichainClaim;
}): {
  claimHash: Hex;
  compactTypehash: Hex;
} {
  const commitmentsHash = toCommitmentsHash({ claims: claim.claims });
  const { allocationTypehash, compactTypehash } = toMultichainClaimTypehashes({
    claim,
  });
  return {
    claimHash: toMultichainClaimHash({
      allocationTypehash,
      compactTypehash,
      commitmentsHash,
    }),
    compactTypehash,
  };
}

export function toClaimHashAndTypehashFromTest({ intent }: { intent: any }): {
  claimHash: Hex;
  compactTypehash: Hex;
} {
  const notarizedChainElement = intent.elements[0];
  const otherElements = intent.elements
    .filter((_: any, index: number) => index !== 0)
    .map(hash);
  const witness = getMandateHash(notarizedChainElement.mandate);

  // compact logic
  const mandateTypeString =
    "Dest dest,Op[] originOps,Op[] destOps,bytes32 q)Op(address to,uint256 value,bytes data)Dest(address recipient,Token[] tokenOut,uint256 destChain,uint256 fillExpiry,address claimProofer)Token(address token,uint256 amount";
  const fullMultichainString = `MultichainCompact(address sponsor,uint256 nonce,uint256 expires,Element[] elements)Element(address arbiter,uint256 chainId,Lock[] commitments,Mandate mandate)Lock(bytes12 lockTag,address token,uint256 amount)Mandate(${mandateTypeString})`;
  const fullElementString = `Element(address arbiter,uint256 chainId,Lock[] commitments,Mandate mandate)Lock(bytes12 lockTag,address token,uint256 amount)Mandate(${mandateTypeString})`;
  const multichainCompactTypehash = keccak256(toBytes(fullMultichainString));
  const elementTypehash = keccak256(toBytes(fullElementString));
  const thisChainElementHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32", name: "elementTypehash" },
        { type: "address", name: "arbiter" },
        { type: "uint256", name: "chainId" },
        {
          type: "uint256",
          name: "idsAndAmountsHash",
        },
        { type: "bytes32", name: "witness" },
      ],
      [
        elementTypehash,
        notarizedChainElement.arbiter,
        notarizedChainElement.chainId,
        hexToBigInt(hashTokenIn(notarizedChainElement.idsAndAmounts)),
        witness,
      ],
    ),
  );
  let packed: Hex = thisChainElementHash;
  for (const additionalChain of otherElements) {
    packed = concat([packed, additionalChain]) as Hex;
  }
  const elementsHash = keccak256(packed);
  const claimHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32", name: "compactTypehash" },
        { type: "address", name: "sponsor" },
        { type: "uint256", name: "nonce" },
        { type: "uint256", name: "expires" },
        { type: "bytes32", name: "elementsHash" },
      ],
      [
        multichainCompactTypehash,
        intent.sponsor,
        intent.nonce,
        intent.expires,
        elementsHash,
      ],
    ),
  );
  return {
    claimHash,
    compactTypehash: multichainCompactTypehash,
  };
}
