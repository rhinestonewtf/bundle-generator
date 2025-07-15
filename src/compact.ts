import {
  Address,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  Hex,
  keccak256,
  PrivateKeyAccount,
} from "viem";
import { getPublicClientByChainId } from "./utils/clients";
import { getOwnableValidator } from "@rhinestone/module-sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const owner = privateKeyToAccount(generatePrivateKey());

export type ResetPeriod =
  | 0 // OneSecond
  | 1 // FifteenSeconds
  | 2 // OneMinute
  | 3 // TenMinutes
  | 4 // OneHourAndFiveMinutes
  | 5 // OneDay
  | 6 // SevenDaysAndOneHour
  | 7; // ThirtyDays

export type Scope = 0 | 1; // Multichain | ChainSpecific
export const DEFAULT_CONFIG_ID: number = 42;

export const COMPACT_ADDRESS = "0xAbd3388A633758D0Bae01Efb885EF1e87BD519a6";
const ALLOCATOR_ADDRESS = "0xeEef182c81EC267732D3efD0fdeF3b05dF2E05F7";
export const DEFAULT_RESET_PERIOD: ResetPeriod = 6;
export const DEFAULT_SCOPE: Scope = 0;
const EMISSARY_ADDRESS = "0xdd0647716e3c3d709D833717aC5786Ed4f36D20e";

export const DEFAULT_EMISSARY_CONFIG_ID = 42;

const compactABI = [
  {
    type: "function",
    name: "depositERC20",
    inputs: [
      { name: "token", type: "address", internalType: "address" },
      { name: "lockTag", type: "bytes12", internalType: "bytes12" },
      { name: "amount", type: "uint256", internalType: "uint256" },
      { name: "recipient", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "depositNative",
    inputs: [
      { name: "lockTag", type: "bytes12", internalType: "bytes12" },
      { name: "recipient", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "assignEmissary",
    inputs: [
      { name: "lockTag", type: "bytes12", internalType: "bytes12" },
      { name: "emissary", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getEmissaryStatus",
    inputs: [
      { name: "sponsor", type: "address", internalType: "address" },
      { name: "lockTag", type: "bytes12", internalType: "bytes12" },
    ],
    outputs: [
      { name: "status", type: "uint8", internalType: "enum EmissaryStatus" },
      {
        name: "emissaryAssignmentAvailableAt",
        type: "uint256",
        internalType: "uint256",
      },
      { name: "currentEmissary", type: "address", internalType: "address" },
    ],
    stateMutability: "view",
  },
] as const;

const emissaryAbi = [
  {
    type: "function",
    name: "_config",
    inputs: [
      { name: "sponsor", type: "address", internalType: "address" },
      { name: "configId", type: "uint8", internalType: "uint8" },
      { name: "lockTag", type: "bytes12", internalType: "bytes12" },
      {
        name: "validator",
        type: "address",
        internalType: "contract IStatelessValidator",
      },
    ],
    outputs: [{ name: "data", type: "bytes", internalType: "bytes" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setConfig",
    inputs: [
      { name: "account", type: "address", internalType: "address" },
      {
        name: "config",
        type: "tuple",
        internalType: "struct IEmissary.EmissaryConfig",
        components: [
          { name: "configId", type: "uint8", internalType: "uint8" },
          { name: "allocator", type: "address", internalType: "address" },
          { name: "scope", type: "uint8", internalType: "enum Scope" },
          {
            name: "resetPeriod",
            type: "uint8",
            internalType: "enum ResetPeriod",
          },
          {
            name: "validator",
            type: "address",
            internalType: "contract IStatelessValidator",
          },
          { name: "validatorConfig", type: "bytes", internalType: "bytes" },
        ],
      },
      {
        name: "enableData",
        type: "tuple",
        internalType: "struct IEmissary.EmissaryEnable",
        components: [
          { name: "allocatorSig", type: "bytes", internalType: "bytes" },
          { name: "userSig", type: "bytes", internalType: "bytes" },
          { name: "expires", type: "uint256", internalType: "uint256" },
          { name: "nonce", type: "uint256", internalType: "uint256" },
          { name: "allChainIds", type: "uint256[]", internalType: "uint256[]" },
          { name: "chainIndex", type: "uint256", internalType: "uint256" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

function toCompactFlag(allocator: Address): number {
  const addrBytes = Buffer.from(allocator.slice(2), "hex");
  let leadingZeroNibbles = 0;

  for (const byte of addrBytes) {
    if (byte === 0) {
      leadingZeroNibbles += 2;
    } else {
      if (byte >> 4 === 0) leadingZeroNibbles += 1;
      break;
    }
  }

  if (leadingZeroNibbles >= 18) return 15;
  if (leadingZeroNibbles >= 4) return leadingZeroNibbles - 3;
  return 0;
}

export function usingAllocatorId(
  allocator: Address = ALLOCATOR_ADDRESS,
): bigint {
  const compactFlag = BigInt(toCompactFlag(allocator));
  const last88Bits = BigInt("0x" + allocator.slice(-22)); // Extract last 88 bits (11 bytes * 2 hex chars per byte)
  return (compactFlag << 88n) | last88Bits;
}

export function lockTag(
  allocator: Address = ALLOCATOR_ADDRESS,
  resetPeriod: ResetPeriod = DEFAULT_RESET_PERIOD,
  scope: Scope = DEFAULT_SCOPE,
): Hex {
  const allocatorId = usingAllocatorId(allocator);
  const tagBig =
    (BigInt(scope) << 255n) |
    (BigInt(resetPeriod) << 252n) |
    (allocatorId << 160n);
  const hex = tagBig.toString(16).slice(0, 24);
  // return "0x60999ecb8218b5b634707b0b";
  return `0x${hex}` as const;
}

export async function depositToCompact(
  account: {
    account: {
      address: Address;
    };
    sendTransaction: (tx: {
      to: Address;
      data: Hex;
      value: bigint;
    }) => Promise<Hex>;
  },
  chainId: number,
  amount: bigint,
  tokenAddress?: Address,
) {
  if (!account.account?.address) {
    throw new Error("Account not deployed");
  }

  if (tokenAddress) {
    const publicClient = getPublicClientByChainId(chainId);
    const compactAllowance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.account.address, COMPACT_ADDRESS],
    });
    if (compactAllowance < amount) {
      console.log("Approving ERC20 for compact");
      const approvalTx = await account.sendTransaction({
        to: tokenAddress,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [COMPACT_ADDRESS, amount],
        }),
        value: 0n,
      });
      console.log("Approval transaction sent");
      console.log("Transaction hash:", approvalTx);
      await publicClient.waitForTransactionReceipt({
        hash: approvalTx,
      });
    }

    console.log("Depositing ERC20");
    const depositTx = await account.sendTransaction({
      to: COMPACT_ADDRESS,
      data: encodeFunctionData({
        abi: compactABI,
        functionName: "depositERC20",
        args: [tokenAddress, lockTag(), amount, account.account.address],
      }),
      value: 0n,
    });
    console.log("Deposit transaction sent");
    console.log("Transaction hash:", depositTx);
    await publicClient.waitForTransactionReceipt({
      hash: depositTx,
    });
  } else {
    console.log("Depositing native");
    const depositNative = await account.sendTransaction({
      to: COMPACT_ADDRESS,
      data: encodeFunctionData({
        abi: compactABI,
        functionName: "depositNative",
        args: [lockTag(), account.account.address],
      }),
      value: amount,
    });

    console.log("Deposit native transaction sent");
    console.log("Transaction hash:", depositNative);
    await getPublicClientByChainId(chainId).waitForTransactionReceipt({
      hash: depositNative,
    });
  }
}

export async function setEmissary(
  chainId: number,
  account: {
    account: {
      address: Address;
    };
    sendTransaction: (tx: {
      to: Address;
      data: Hex;
      value: bigint;
    }) => Promise<Hex>;
  },
) {
  const publicClient = getPublicClientByChainId(chainId);

  console.log("Lock tag", lockTag());

  const [emissaryStatus, emissaryAssignmentAvailableAt, currentEmissary] =
    await publicClient.readContract({
      address: COMPACT_ADDRESS,
      abi: compactABI,
      functionName: "getEmissaryStatus",
      args: [account.account.address, lockTag()],
    });
  // 0x3050ff4913d663bb1f688507
  // 0x60999ecb8218b5b634707b0b
  if (emissaryStatus === 2) {
    // TODO: check currentEmissary is expected emissary
    console.log("Emissary already assigned");
  } else {
    const setEmissaryTx = await account.sendTransaction({
      to: COMPACT_ADDRESS,
      data: encodeFunctionData({
        abi: compactABI,
        functionName: "assignEmissary",
        args: [lockTag(), EMISSARY_ADDRESS],
      }),
      value: 0n,
    });
    console.log("Emissary assignment transaction sent in tx:", setEmissaryTx);
    await publicClient.waitForTransactionReceipt({
      hash: setEmissaryTx,
    });
  }

  const { address: validator, initData: validatorConfig } = getOwnableValidator(
    {
      owners: [owner.address],
      threshold: 1,
    },
  );

  const emissaryConfig = await publicClient.readContract({
    address: EMISSARY_ADDRESS,
    abi: emissaryAbi,
    functionName: "_config",
    args: [
      account.account.address,
      DEFAULT_EMISSARY_CONFIG_ID,
      lockTag(),
      validator,
    ],
  });
  console.log("Emissary config:", emissaryConfig);
  if (emissaryConfig === "0x") {
    const emissaryEnableConfig = await enableEmissaryConfig(
      owner.address,
      privateKeyToAccount(process.env.OWNER_PRIVATE_KEY as Hex),
      [chainId],
    );

    const setEmissaryConfigTx = await account.sendTransaction({
      to: EMISSARY_ADDRESS,
      data: encodeFunctionData({
        abi: emissaryAbi,
        functionName: "setConfig",
        args: [
          account.account.address,
          emissaryEnableConfig.config,
          emissaryEnableConfig.enable,
        ],
      }),
      value: 0n,
    });
    console.log(
      "Emissary config set transaction sent in tx:",
      setEmissaryConfigTx,
    );
    await publicClient.waitForTransactionReceipt({
      hash: setEmissaryConfigTx,
    });
  }
}

export async function enableEmissaryConfig(
  owner: Address,
  allocatorSigner: PrivateKeyAccount,
  chainIds: number[] = [],
  configId: number = DEFAULT_CONFIG_ID,
): Promise<{
  config: any;
  enable: any;
}> {
  const { address: validator, initData: validatorConfig } = getOwnableValidator(
    {
      owners: [owner],
      threshold: 1,
    },
  );

  const config: any = {
    configId,
    allocator: ALLOCATOR_ADDRESS,
    scope: DEFAULT_SCOPE,
    resetPeriod: DEFAULT_RESET_PERIOD,
    validator,
    validatorConfig,
  };

  const nonce = 1n; //getRandomNonce(owner)
  const enableHash = hashEmissaryConfig(config, owner, nonce, chainIds);
  const allocatorSig = await allocatorSigner.sign({
    hash: enableHash,
  });

  const enable: any = {
    allocatorSig,
    userSig: "0x",
    expires: BigInt(timeNow() + EMISSARY_EXPIRY_TIME),
    nonce,
    allChainIds: chainIds.map(BigInt),
    chainIndex: 0n,
  };

  return { config, enable };
}

export function timeNow(): number {
  return Math.floor(Date.now() / 1_000);
}

const TYPE_HASH_PREFIX = "\x19\x01";

export const DOMAIN_TYPEHASH =
  "0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f";

/// @dev `keccak256("EIP712Domain(string name,string version,address verifyingContract)")`
export const DOMAIN_TYPEHASH_SANS_CHAIN_ID =
  "0x91ab3d17e3a50a9d89e63fd30b92be7f5336b03b287bb946787a83a9d62a2766";

export function hashEIP712DomainSeparator(domain: any): Hex {
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

export function hashEIP712DomainSeparatorSansChainId(domain: any): Hex {
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

export function hashTypedData(domain: any, structHash: Hex): Hex {
  const domainSeparator =
    "chainId" in domain
      ? hashEIP712DomainSeparator(domain)
      : hashEIP712DomainSeparatorSansChainId(domain);

  console.log("Domain Separator:", domainSeparator);

  return keccak256(
    encodePacked(
      ["string", "bytes32", "bytes32"],
      [TYPE_HASH_PREFIX, domainSeparator, structHash],
    ),
  );
}

function hashEmissaryConfig(
  config: any,
  sponsor: Address,
  nonce: bigint,
  chainIds: number[],
) {
  const hash = keccak256(
    encodeAbiParameters(
      [
        { name: "typehash", type: "bytes32" },
        { name: "sponsor", type: "address" },
        { name: "validator", type: "address" },
        { name: "configId", type: "uint256" },
        { name: "lockTag", type: "bytes12" },
        { name: "expires", type: "uint256" },
        { name: "validatorConfig", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "chainIds", type: "bytes32" }, // Hash keccak256 of packed uint256[]
      ],
      [
        EMISSARY_CONFIG_TYPEHASH,
        sponsor,
        config.validator,
        BigInt(config.configId),
        lockTag(),
        BigInt(timeNow() + EMISSARY_EXPIRY_TIME),
        keccak256(config.validatorConfig),
        nonce,
        keccak256(encodePacked(["uint256[]"], [chainIds.map(BigInt)])),
      ],
    ),
  );

  const digest = hashTypedData(EMISSARY_DOMAIN_SEPARATOR_SANS_CHAIN_ID, hash);

  return digest;
}

export const EMISSARY_CONFIG_TYPEHASH =
  "0xf93d92d294dff1a0619308be9b3d40a5994c777b227e07b87f07d77637f4c6c8";

export const EMISSARY_DOMAIN_NAME_HASH =
  "0x6ea0b95941b5d4a9566ad4be4b65d7961249427fc89dd79e0934e32eea81a8aa";
export const EMISSARY_DOMAIN_VERSION_HASH =
  "0xae209a0b48f21c054280f2455d32cf309387644879d9acbd8ffc199163811885";

export const EMISSARY_DOMAIN_SEPARATOR_SANS_CHAIN_ID: any = {
  nameHash: EMISSARY_DOMAIN_NAME_HASH,
  versionHash: EMISSARY_DOMAIN_VERSION_HASH,
  verifyingContract: EMISSARY_ADDRESS,
};
