import {
  Address,
  concat,
  CustomSource,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  Hex,
  parseAbi,
  SignedAuthorization,
  zeroAddress,
} from "viem";
import { getOwnableValidator } from "@rhinestone/module-sdk";

const INTENT_EXECUTOR_ADDRESS: Address =
  process.env.DEV_CONTRACTS == "true"
    ? "0xbf9b5b917a83f8adac17b0752846d41d8d7b7e17"
    : "0x00000000005aD9ce1f5035FD62CA96CEf16AdAAF";

export const NEXUS = "0xb25556b8F5D202864147DD2052a9BFcb24461fD9";

const NEXUS_BOOTSTRAP = "0x00000000001Cf4667Bfd7be8f67D01d63938784b";

export async function smartAccountSetupCode(eoa: CustomSource): Promise<Hex> {
  const ownableValidator = getOwnableValidator({
    owners: [eoa.address],
    threshold: 1,
  });

  const initData = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }],
    [
      NEXUS_BOOTSTRAP,
      encodeFunctionData({
        abi: parseAbi([
          "struct BootstrapConfig {address module;bytes initData;}",
          "struct BootstrapPreValidationHookConfig {uint256 hookType;address module;bytes data;}",
          "function initNexusWithDefaultValidatorAndOtherModulesNoRegistry(bytes calldata defaultValidatorInitData,BootstrapConfig[] calldata validators,BootstrapConfig[] calldata executors,BootstrapConfig calldata hook,BootstrapConfig[] calldata fallbacks,BootstrapPreValidationHookConfig[] calldata preValidationHooks) external",
        ]),
        functionName: "initNexusWithDefaultValidatorAndOtherModulesNoRegistry",
        args: [
          ownableValidator.initData,
          [],
          [
            {
              module: INTENT_EXECUTOR_ADDRESS,
              initData: "0x",
            },
          ],
          {
            module: zeroAddress,
            initData: "0x",
          },
          [],
          [],
        ],
      }),
    ]
  );

  const encodedData = getEncodedData(initData);

  const signature = await eoa.signTypedData({
    domain: {
      name: "Nexus",
      version: "1.2.0",
    },
    types: {
      Initialize: [
        { name: "nexus", type: "address" },
        { name: "chainIds", type: "uint256[]" },
        { name: "initData", type: "bytes" },
      ],
    },
    primaryType: "Initialize",
    message: {
      nexus: NEXUS,
      chainIds: [0n],
      initData,
    },
  });

  const accountFullData = concat([signature, encodedData]);
  const accountInitCallData = encodeFunctionData({
    abi: [
      {
        type: "function",
        inputs: [
          {
            type: "bytes",
            name: "initData",
          },
        ],
        outputs: [],
        stateMutability: "nonpayable",
        name: "initializeAccount",
      },
    ],
    functionName: "initializeAccount",
    args: [accountFullData],
  });

  return accountInitCallData;
}

function getEncodedData(initData: Hex): Hex {
  const chainIds = [0n]; // uint256[] with single element 0
  const encodedData = encodePacked(
    ["uint256", "uint256", "uint256[]", "bytes"],
    [0n, 1n, chainIds, initData]
  );
  return encodedData;
}

export async function signDelegation(
  acc: CustomSource,
  chain: number,
  nonce: number,
  delegatedContract: Address
): Promise<SignedAuthorization> {
  return await acc.signAuthorization!({
    chainId: chain,
    nonce,
    address: delegatedContract,
  });
}
