// TODO: Move to utils/hash.ts and replace current hash functions

// import {
//   Element,
//   Execution,
//   Mandate,
//   Qualifier,
//   Bundle,
//   QualifiedClaim,
//   TokenArrays6909,
//   HashedEIP712Domain,
//   HashedEIP712DomainSansChainId,
// } from "@/types";
//

import {
  Hex,
  Address,
  encodeAbiParameters,
  encodePacked,
  keccak256,
} from "viem";
import { IsTypedData, TypedDataToPrimitiveTypes } from "abitype";
import { COMPACT_ADDRESS } from "../compact";

export const typedData = {
  MultichainCompact: [
    { name: "sponsor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expires", type: "uint256" },
    { name: "elements", type: "Element[]" },
  ],
  Element: [
    { name: "arbiter", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "idsAndAmounts", type: "uint256[2][]" },
    { name: "mandate", type: "Mandate" },
  ],
  Mandate: [
    { name: "recipient", type: "address" },
    { name: "tokenOut", type: "uint256[2][]" },
    { name: "targetChainId", type: "uint256" },
    { name: "fillDeadline", type: "uint256" },
    { name: "preClaimOps", type: "Execution[]" },
    { name: "targetOps", type: "Execution[]" },
    { name: "qualifier", type: "Qualifier" },
  ],
  Qualifier: [{ name: "encodedVal", type: "bytes" }],
  Execution: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
  PreClaimExecution: [
    { name: "gasStipend", type: "uint256" },
    { name: "preClaimExecutions", type: "Execution[]" },
  ],
  QualifiedClaim: [
    { name: "claimHash", type: "bytes32" },
    { name: "qualificationHash", type: "bytes32" },
  ],
  QualificationWitness: [
    { name: "claimHash", type: "bytes32" },
    { name: "targetChainSignatureHash", type: "bytes32" },
    { name: "targetWETHAddress", type: "address" },
    { name: "feeBeneficiaryAndBps", type: "uint256[2][]" },
  ],
  NominalFee: [
    { name: "maxFeeBps", type: "uint256" },
    { name: "fees", type: "uint256[2][]" },
  ],
  MultiChainOrder: [
    { name: "elementIndex", type: "uint256" },
    { name: "otherElements", type: "bytes32[]" },
    { name: "order", type: "Order" },
    { name: "sponsorSignatureNotarizedChain", type: "bytes" },
    { name: "sponsorSignatureTargetChain", type: "bytes" },
  ],
  Order: [
    { name: "sponsor", type: "address" },
    { name: "recipient", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expires", type: "uint256" },
    { name: "fillDeadline", type: "uint256" },
    { name: "notarizedChainId", type: "uint256" },
    { name: "targetChainId", type: "uint256" },
    { name: "tokenIn", type: "uint256[2][]" },
    { name: "tokenOut", type: "uint256[2][]" },
    { name: "preClaimOps", type: "Operation" },
    { name: "targetOps", type: "Operation" },
    { name: "qualifier", type: "bytes" },
  ],
  Operation: [{ name: "data", type: "bytes" }],
  Signatures: [
    { name: "notarizedClaimSig", type: "bytes" },
    { name: "preClaimSig", type: "bytes" },
    { name: "destinationChainSig", type: "bytes" },
  ],
  FillDataSameChain: [
    { name: "order", type: "Order" },
    { name: "userSigs", type: "Signatures" },
    { name: "otherElements", type: "bytes32[]" },
    { name: "allocatorData", type: "bytes" },
    { name: "preClaimGasStipend", type: "uint256" },
  ],
  FillDataAcross: [
    { name: "sponsor", type: "address" },
    { name: "recipient", type: "address" },
    { name: "tokenIn", type: "uint256[2][]" },
    { name: "tokenOut", type: "uint256[2][]" },
    { name: "nonce", type: "uint256" },
    { name: "fillDeadline", type: "uint32" },
    { name: "message", type: "bytes" },
    { name: "originChainId", type: "uint256" },
    { name: "otherElements", type: "bytes32[]" },
    { name: "originChainWETH", type: "address" },
  ],
  ClaimData: [
    { name: "order", type: "Order" },
    { name: "userSigs", type: "Signatures" },
    { name: "elementIndex", type: "uint256" },
    { name: "otherElements", type: "bytes32[]" },
    { name: "allocatorData", type: "bytes" },
    { name: "preClaimGasStipend", type: "uint256" },
  ],
  AtomicFill: [
    { name: "intentFillPayloadArrayKeccak", type: "bytes32" },
    { name: "exclusiveRelayer", type: "address" },
  ],
  ChainNotarization: [
    { name: "originAccount", type: "address" },
    { name: "originModule", type: "address" },
    { name: "notarizedChainId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expires", type: "uint256" },
    { name: "idsAndAmountsTokenInHash", type: "bytes32" },
  ],
  TargetChainAttributes: [
    { name: "recipient", type: "address" },
    { name: "tokenOut", type: "uint256[2][]" },
    { name: "targetWETHAddress", type: "address" },
    { name: "fillDeadline", type: "uint32" },
    { name: "maxFeeBps", type: "uint32" },
    { name: "feeBeneficiaryHash", type: "bytes32" },
  ],
  MultiOriginMessage: [
    { name: "notarization", type: "ChainNotarization" },
    { name: "targetChain", type: "TargetChainAttributes" },
    { name: "otherSegments", type: "bytes32[]" },
    { name: "executions", type: "Execution[]" },
    { name: "userSig", type: "bytes" },
  ],
  SameChainModuleMessage: [
    { name: "sameChainModule", type: "address" },
    { name: "payload", type: "Payload" },
    { name: "otherChainSegments", type: "bytes32[]" },
    { name: "sigs", type: "Signatures" },
    { name: "executions", type: "Execution[]" },
  ],
  SingleOriginMessage: [
    { name: "notarization", type: "ChainNotarization" },
    { name: "targetChain", type: "TargetChainAttributes" },
    { name: "executions", type: "Execution[]" },
    { name: "userSig", type: "bytes" },
  ],
  UserOperationMessage: [
    { name: "targetChain", type: "TargetChainAttributes" },
    { name: "userOp", type: "PackedUserOperation" },
    { name: "originAccount", type: "address" },
    { name: "notarizedChainId", type: "uint256" },
    { name: "idsAndAmountsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "expires", type: "uint256" },
  ],
  UserOperationSameChain: [
    { name: "payload", type: "Payload" },
    { name: "samechainModule", type: "address" },
    { name: "userOp", type: "PackedUserOperation" },
    { name: "otherChainSegments", type: "bytes32[]" },
    { name: "sigs", type: "Signatures" },
  ],
  PackedUserOperation: [
    { name: "sender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "initCode", type: "bytes" },
    { name: "callData", type: "bytes" },
    { name: "accountGasLimits", type: "bytes32" },
    { name: "preVerificationGas", type: "uint256" },
    { name: "gasFees", type: "bytes32" },
    { name: "paymasterAndData", type: "bytes" },
    { name: "signature", type: "bytes" },
  ],
  IntentFillPayload: [
    { name: "segments", type: "ElementData[]" },
    { name: "message", type: "bytes" },
    { name: "orchestratorSig", type: "bytes" },
  ],
  ElementData: [
    { name: "tokenIn", type: "uint256[2][]" },
    { name: "tokenOut", type: "uint256[2][]" },
    { name: "originModule", type: "address" },
    { name: "originWETHAddress", type: "address" },
    { name: "originChainId", type: "uint256" },
    { name: "compactNonce", type: "uint256" },
  ],
  Payload: [
    { name: "account", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expires", type: "uint256" },
    { name: "witness", type: "DepositWitness" },
    { name: "feeBeneficiariesAndBps", type: "uint256[2][]" },
  ],
  DepositWitness: [
    { name: "targetChain", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "fillDeadline", type: "uint32" },
    { name: "tokenIn", type: "uint256[2][]" },
    { name: "tokenOut", type: "uint256[2][]" },
    { name: "targetWETHAddress", type: "address" },
    { name: "maxFeeBps", type: "uint32" },
  ],
  Compact: [
    { name: "arbiter", type: "address" },
    { name: "sponsor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expires", type: "uint256" },
    { name: "id", type: "uint256" },
    { name: "amount", type: "uint256" },
  ],
  EmissaryConfig: [
    { name: "configId", type: "uint8" },
    { name: "allocator", type: "address" },
    { name: "scope", type: "uint8" },
    { name: "resetPeriod", type: "uint8" },
    { name: "validator", type: "address" },
    { name: "validatorConfig", type: "bytes" },
  ],
  EmissaryEnable: [
    { name: "allocatorSig", type: "bytes" },
    { name: "userSig", type: "bytes" },
    { name: "expires", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "allChainIds", type: "uint256[]" },
    { name: "chainIndex", type: "uint256" },
  ],
} as const;

const isTypedData: boolean = typedData as unknown as IsTypedData<
  typeof typedData
>;

// This is a guard that prevents us from creating invalid 712 types
if (!isTypedData) {
  throw new Error("Invalid 712 types");
}

export type types = TypedDataToPrimitiveTypes<typeof typedData>;

export type MultiChainCompact = types["MultichainCompact"];
/// @dev This is the response of the orchestrator to include the settlement layer in the mandate
export type Bundle = Omit<MultiChainCompact, "elements"> & {
  elements: FullElement[];
};

export type Element = types["Element"];
/// @dev This is the response of the orchestrator to include the settlement layer in the mandate
export type FullElement = Omit<Element, "mandate"> & {
  mandate: FullMandate;
};

export type Mandate = types["Mandate"];
/// @dev This is the response of the orchestrator to include the settlement layer in the mandate
export type FullMandate = Omit<Mandate, "qualifier"> & {
  qualifier: SettlementQualifier;
};

export type Qualifier = types["Qualifier"];

export enum SettlementLayer {
  SAME_CHAIN = "SAME_CHAIN",
  ACROSS = "ACROSS",
  // ECO = 'ECO',
  // RELAY = 'RELAY',
}

/// @dev This type is return from the orchestrator instead of the Qualifier, though, only the Qualifier is signed over
export type SettlementQualifier = Qualifier & {
  settlementLayer: SettlementLayer;
};

export type WithChainId = {
  chainId: number;
};

export type Execution = types["Execution"];
export type ChainExec = Execution & WithChainId;
export type PreClaimExecution = types["PreClaimExecution"];

export type QualificationWitness = types["QualificationWitness"];
export type MultiOriginMessage = types["MultiOriginMessage"];
export type IntentFillPayload = types["IntentFillPayload"];
export type ElementData = types["ElementData"];
export type Payload = types["Payload"];
export type Signatures = types["Signatures"];
export type DepositWitness = types["DepositWitness"];
export type UserOperationMessage = types["UserOperationMessage"];
export type TokenArrays6909 = readonly (readonly [bigint, bigint])[];

export type QualifiedClaim = types["QualifiedClaim"];
export type NominalFee = types["NominalFee"];

export type MultiChainOrder = types["MultiChainOrder"];
export type Order = types["Order"];
export type Operation = types["Operation"];
export type FillDataSameChain = types["FillDataSameChain"];
export type FillDataAcross = types["FillDataAcross"];
export type ClaimData = types["ClaimData"];

export type Compact = types["Compact"];
export type SameChainModuleMessage = types["SameChainModuleMessage"];
export type UserOperationSameChain = types["UserOperationSameChain"];
export type EmissaryConfig = types["EmissaryConfig"];
export type EmissaryEnable = types["EmissaryEnable"];

export type BundleEvent = {
  bundleId: bigint;
  type: string;
  targetFillPayload: ChainExec;
  acrossDepositEvents: DepositEvent[];
};

export type DepositEvent = {
  originClaimPayload: ChainExec;
  inputToken: Address; // address
  outputToken: Address; // address
  inputAmount: bigint; // uint256
  outputAmount: bigint; // uint256
  destinationChainId: number;
  depositId: bigint; // uint256 (indexed)
  quoteTimestamp: number; // uint32
  fillDeadline: number; // uint32
  exclusivityDeadline: number; // uint32
  depositor: Address; // address (indexed)
  recipient: Address; // address
  exclusiveRelayer: Address; // address
  message: Hex; // bytes
};

export interface OPGasParameters {
  l1BaseFee: bigint;
  l1BlobBaseFee: bigint;
  baseFeeScalar: bigint;
  blobFeeScalar: bigint;
}

export type HashedEIP712Domain = {
  nameHash: Hex;
  versionHash: Hex;
  verifyingContract: Address;
  chainId: number;
};

export type HashedEIP712DomainSansChainId = Omit<HashedEIP712Domain, "chainId">;

export const COMPACT_TYPEHASH =
  "0x57148f548740ae036cc912a571c25813a2352602b0117dea9256652ad4fdef08";
export const MANDATE_TYPEHASH =
  "0x1f992b7d8bdf0981df19a0513a88584d57c0be9b397fd8eafa65eeb81aff1426";
export const ELEMENT_TYPEHASH =
  "0x3e2dc0c6b991e631e860541a1ac72b28b72af687cd7ebf80678e8818a19f2ed2";
export const QUALIFIER_TYPEHASH =
  "0x76a68ec923fb97f462b8f0abfcfcceb38f4e62169241cf215fec51ab87b2a6da";
export const OPERATION_TYPEHASH =
  "0xe21d36e59bd7a6621212089e9cd43a207e17053bef45c3ffc3a3c16749fc0752";

export const QUALIFICATION_TYPEHASH =
  "0xa002e4a5708d4424abeaa7aa762b36027c1c7eb8604af120ad2ddda6f419c071";

export const EMISSARY_CONFIG_TYPEHASH =
  "0xf93d92d294dff1a0619308be9b3d40a5994c777b227e07b87f07d77637f4c6c8";

/// @dev `keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")`.
export const DOMAIN_TYPEHASH =
  "0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f";

/// @dev `keccak256("EIP712Domain(string name,string version,address verifyingContract)")`
export const DOMAIN_TYPEHASH_SANS_CHAIN_ID =
  "0x91ab3d17e3a50a9d89e63fd30b92be7f5336b03b287bb946787a83a9d62a2766";

//! DOMAIN NAME AND VERSION HASHES //

/// @dev `keccak256(bytes("The Compact"))`
export const COMPACT_DOMAIN_NAME_HASH =
  "0x5e6f7b4e1ac3d625bac418bc955510b3e054cb6cc23cc27885107f080180b292";

/// @dev `keccak256("1")`
export const COMPACT_DOMAIN_VERSION_HASH =
  "0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6";

/// @dev `keccak256("Emissary")`
export const EMISSARY_DOMAIN_NAME_HASH =
  "0x6ea0b95941b5d4a9566ad4be4b65d7961249427fc89dd79e0934e32eea81a8aa";
/// @dev `keccak256("0.0.1")`
export const EMISSARY_DOMAIN_VERSION_HASH =
  "0xae209a0b48f21c054280f2455d32cf309387644879d9acbd8ffc199163811885";

/// @dev `keccak256("Router")`
export const ROUTER_DOMAIN_NAME_HASH =
  "0x3f0593d90c203cedd52beaf1f2e33ef6958a48ee6bc9180eb653d00d34ee618d";
/// @dev `keccak256("v0.0.1")`
export const ROUTER_DOMAIN_VERSION_HASH =
  "0x6bda7e3f385e48841048390444cced5cc795af87758af67622e5f4f0882c4a99";

export enum OpExecType {
  NO_OP = 0,
  EIP712 = 1,
  CALLDATA = 2,
  ERC7579 = 3,
}

//! Constants //

const NO_EXEC_HASH: Hex =
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

//! GENERIC HASH FUNCTION //

// Function overloads for generic hash function
export function hash(element: Element): Hex;
export function hash(mandate: Mandate): Hex;
export function hash(executions: readonly Execution[]): Hex;
export function hash(qualifier: Qualifier): Hex;
export function hash(tokenArrays: TokenArrays6909): Hex;
export function hash(bundle: Bundle): Hex;
export function hash(qualifiedClaim: QualifiedClaim): Hex;
export function hash(elements: Element[]): Hex;
export function hash(domain: HashedEIP712Domain): Hex;
export function hash(
  input:
    | Element
    | Mandate
    | readonly Execution[]
    | Qualifier
    | TokenArrays6909
    | Bundle
    | QualifiedClaim
    | Element[]
    | HashedEIP712Domain,
): Hex {
  // Type guards to determine the input type and dispatch to appropriate function
  if (isElement(input)) {
    return getElementHash(input);
  } else if (isMandate(input)) {
    return getMandateHash(input);
  } else if (isExecutionArray(input)) {
    return getExecutionsHash(input);
  } else if (isQualifier(input)) {
    return qualifierHash(input);
  } else if (isTokenArrays6909(input)) {
    return hashTokenArrays6909(input);
  } else if (isBundle(input)) {
    return getBundleClaimHash(input);
  } else if (isQualifiedClaim(input)) {
    return qualificationHash(input.claimHash, input.qualificationHash);
  } else if (isElementArray(input)) {
    return hashElementArray(input);
  } else if (isHashedEIP712Domain(input)) {
    return hashEIP712DomainSeparator(input);
  }

  throw new Error("Unsupported type for hashing", { cause: input });
}

// Type guard functions
function isElement(input: any): input is Element {
  return (
    input &&
    typeof input.arbiter === "string" &&
    typeof input.chainId === "bigint" &&
    Array.isArray(input.idsAndAmounts) &&
    input.mandate
  );
}

function isMandate(input: any): input is Mandate {
  return (
    input &&
    typeof input.recipient === "string" &&
    Array.isArray(input.tokenOut) &&
    typeof input.targetChainId === "bigint" &&
    typeof input.fillDeadline === "bigint" &&
    Array.isArray(input.preClaimOps) &&
    Array.isArray(input.targetOps) &&
    input.qualifier
  );
}

function isExecutionArray(input: any): input is readonly Execution[] {
  return (
    Array.isArray(input) &&
    (input.length === 0 ||
      (input[0] &&
        typeof input[0].to === "string" &&
        typeof input[0].value === "bigint" &&
        typeof input[0].data === "string"))
  );
}

function isQualifier(input: any): input is Qualifier {
  return input && typeof input.encodedVal === "string";
}

function isTokenArrays6909(input: any): input is TokenArrays6909 {
  return (
    Array.isArray(input) &&
    (input.length === 0 ||
      (Array.isArray(input[0]) &&
        input[0].length === 2 &&
        typeof input[0][0] === "bigint" &&
        typeof input[0][1] === "bigint"))
  );
}

function isBundle(input: any): input is Bundle {
  return (
    input &&
    typeof input.sponsor === "string" &&
    typeof input.nonce === "bigint" &&
    typeof input.expires === "bigint" &&
    Array.isArray(input.elements)
  );
}

function isQualifiedClaim(input: any): input is QualifiedClaim {
  return (
    input &&
    typeof input.claimHash === "string" &&
    typeof input.qualificationHash === "string"
  );
}

function isElementArray(input: any): input is Element[] {
  return (
    Array.isArray(input) &&
    (input.length === 0 ||
      (input[0] &&
        typeof input[0].arbiter === "string" &&
        typeof input[0].chainId === "bigint" &&
        Array.isArray(input[0].idsAndAmounts) &&
        input[0].mandate))
  );
}

function isHashedEIP712Domain(input: any): input is HashedEIP712Domain {
  return (
    input &&
    typeof input.nameHash === "string" &&
    typeof input.versionHash === "string" &&
    typeof input.verifyingContract === "string" &&
    typeof input.chainId === "number"
  );
}

//! HASH FUNCTIONS //

export function getBundleClaimHash(bundle: Bundle): Hex {
  const elementHashes = bundle.elements.map(hash);
  const claimHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32", name: "TYPEHASH_COMPACT" },
        { type: "address", name: "sponsor" },
        { type: "uint256", name: "nonce" },
        { type: "uint256", name: "expires" },
        { type: "bytes32", name: "elementHashes" },
      ],
      [
        COMPACT_TYPEHASH,
        bundle.sponsor,
        bundle.nonce,
        bundle.expires,
        keccak256(encodePacked(["bytes32[]"], [elementHashes])),
      ],
    ),
  );
  return claimHash;
}

export function getElementHash(element: Element): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32", name: "TYPEHASH_COMPACT" },
        { type: "address", name: "arbiter" },
        { type: "uint256", name: "originChainId" },
        { type: "bytes32", name: "idsAndAmountsHash" },
        { type: "bytes32", name: "mandateHash" },
      ],
      [
        COMPACT_TYPEHASH,
        element.arbiter,
        element.chainId,
        hashTokenArrays6909(element.idsAndAmounts),
        getMandateHash(element.mandate),
      ],
    ),
  );
}

export function getMandateHash(mandate: Mandate): Hex {
  const hash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32", name: "TYPEHASH_COMPACT" },
        { type: "address", name: "recipient" },
        { type: "bytes32", name: "tokenOut" },
        { type: "uint256", name: "targetChainId" },
        { type: "uint256", name: "fillDeadline" },
        { type: "bytes32", name: "preClaimOps" },
        { type: "bytes32", name: "targetOps" },
        { type: "bytes32", name: "qualifierHash" },
      ],
      [
        COMPACT_TYPEHASH,
        mandate.recipient,
        hashTokenArrays6909(mandate.tokenOut),
        mandate.targetChainId,
        mandate.fillDeadline,
        getExecutionsHash(mandate.preClaimOps),
        getExecutionsHash(mandate.targetOps),
        qualifierHash(mandate.qualifier),
      ],
    ),
  );

  return hash;
}

function getExecutionsHash(executions: readonly Execution[]): Hex {
  if (executions.length === 0) {
    return NO_EXEC_HASH;
  } else {
    const executionHashes = executions.map(getExecutionHash);
    return keccak256(
      encodeAbiParameters(
        [{ type: "bytes32[]", name: "executionHashes" }],
        [executionHashes],
      ),
    );
  }
}

function getExecutionHash(execution: Execution): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32", name: "TYPEHASH_COMPACT" },
        { type: "address", name: "to" },
        { type: "uint256", name: "value" },
        { type: "bytes32", name: "data" },
      ],
      [
        OPERATION_TYPEHASH,
        execution.to,
        execution.value,
        keccak256(execution.data),
      ],
    ),
  );
}

function qualifierHash(qualifier: Qualifier): Hex {
  return keccak256(qualifier.encodedVal);
}

function qualificationHash(claimHash: Hex, _qualificationHash: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32", name: "QUALIFICATION_TYPEHASH" },
        { type: "bytes32", name: "claimHash" },
        { type: "bytes32", name: "qualificationHash" },
      ],
      [QUALIFICATION_TYPEHASH, claimHash, _qualificationHash],
    ),
  );
}

function hashElementArray(elements: Element[]): Hex {
  const elementHashes = elements.map(getElementHash);
  return keccak256(encodePacked(["bytes32[]"], [elementHashes]));
}

export function hashTokenArrays6909(tokenArrays6909: TokenArrays6909): Hex {
  return keccak256(encodePacked(["uint256[2][]"], [tokenArrays6909]));
}

export function hashEIP712DomainSeparator(domain: HashedEIP712Domain): Hex {
  const { nameHash, versionHash, verifyingContract, chainId } = domain;
  return keccak256(
    encodeAbiParameters(
      [
        { name: "typehash", type: "bytes32" },
        { name: "name", type: "bytes32" },
        { name: "version", type: "bytes32" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      [
        DOMAIN_TYPEHASH,
        nameHash,
        versionHash,
        BigInt(chainId),
        verifyingContract,
      ],
    ),
  );
}

export function hashEIP712DomainSeparatorSansChainId(
  domain: HashedEIP712DomainSansChainId,
): Hex {
  const { nameHash, versionHash, verifyingContract } = domain;
  return keccak256(
    encodeAbiParameters(
      [
        { name: "typehash", type: "bytes32" },
        { name: "name", type: "bytes32" },
        { name: "version", type: "bytes32" },
        { name: "verifyingContract", type: "address" },
      ],
      [DOMAIN_TYPEHASH_SANS_CHAIN_ID, nameHash, versionHash, verifyingContract],
    ),
  );
}

export function getAdapterDataDigest(adapterData: Hex[]): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes[]" }], [adapterData]));
}

export function encodeExecutions(executions: readonly Execution[]): Hex {
  if (executions.length === 0) {
    return encodePacked(["uint8"], [OpExecType.NO_OP]);
  } else {
    return encodePacked(
      ["uint8", "bytes"],
      [
        OpExecType.ERC7579,
        encodeAbiParameters(
          [
            {
              type: "tuple[]",
              components: [
                { type: "address", name: "to" },
                { type: "uint256", name: "value" },
                { type: "bytes", name: "data" },
              ],
            },
          ],
          [executions],
        ),
      ],
    );
  }
}

export const COMPACT_DOMAIN_SEPARATOR_SANS_CHAIN_ID: HashedEIP712DomainSansChainId =
  {
    nameHash: COMPACT_DOMAIN_NAME_HASH,
    versionHash: COMPACT_DOMAIN_VERSION_HASH,
    verifyingContract: COMPACT_ADDRESS,
  };

export function getCompactDomainSeparator(chainId: number): HashedEIP712Domain {
  return {
    ...COMPACT_DOMAIN_SEPARATOR_SANS_CHAIN_ID,
    chainId,
  };
}
