import {
  Account,
  Address,
  Chain,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  Hex,
  http,
  keccak256,
  parseAbi,
  slice,
  zeroAddress,
} from "viem";
import { getPublicClient, getPublicClientByChainId } from "./utils/clients.js";
import {
  getOwnableValidator,
  RHINESTONE_ATTESTER_ADDRESS,
} from "@rhinestone/module-sdk";
import {
  getHookAddress,
  getSameChainModuleAddress,
  getTargetModuleAddress,
} from "@rhinestone/sdk/orchestrator";
import { privateKeyToAccount } from "viem/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { entryPoint07Address } from "viem/account-abstraction";
import {
  toSafeSmartAccount,
  ToSafeSmartAccountParameters,
} from "permissionless/accounts";
import { createSmartAccountClient } from "permissionless";
import { erc7579Actions } from "permissionless/actions/erc7579";

export const moduleAttester: Address =
  "0x6D0515e8E499468DCe9583626f0cA15b887f9d03";

export const INTENT_EXECUTOR_ADDRESS: Address =
  "0x0530Ff05cf0F7e44db6F33Fc2D10C2838e38ec79";

export const getSmartAccount = async ({
  chain,
  owner,
}: {
  chain: Chain;
  owner: Account;
}) => {
  const ownableValidator = getOwnableValidator({
    owners: [owner.address],
    threshold: 1,
  });

  // create the target clients
  const targetPublicClient = createPublicClient({
    chain,
    transport: http(),
  });

  const targetPimlicoClient = createPimlicoClient({
    transport: http(
      `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
    ),
    entryPoint: {
      address: entryPoint07Address,
      version: "0.7",
    },
  });

  const smartAccountConfig: ToSafeSmartAccountParameters<
    "0.7",
    "0x7579011aB74c46090561ea277Ba79D510c6C00ff"
  > = {
    saltNonce: 5n,
    // address: accountAddress,
    client: targetPublicClient,
    owners: [owner],
    version: "1.4.1",
    entryPoint: {
      address: entryPoint07Address,
      version: "0.7",
    },
    safe4337ModuleAddress: "0x7579EE8307284F293B1927136486880611F20002",
    erc7579LaunchpadAddress: "0x7579011aB74c46090561ea277Ba79D510c6C00ff",
    attesters: [
      RHINESTONE_ATTESTER_ADDRESS, // Rhinestone Attester
      moduleAttester, // Mock attester for omni account
    ],
    attestersThreshold: 1,
    validators: [
      {
        address: ownableValidator.address,
        context: ownableValidator.initData,
      },
    ],
    executors: [
      {
        address: INTENT_EXECUTOR_ADDRESS,
        context: "0x",
      },
    ],
    hooks: [],
    fallbacks: [
      {
        address: INTENT_EXECUTOR_ADDRESS,
        context: encodeAbiParameters(
          [
            { name: "selector", type: "bytes4" },
            { name: "flags", type: "bytes1" },
            { name: "data", type: "bytes" },
          ],
          ["0x3a5be8cb", "0x00", "0x"],
        ),
      },
    ],
  };

  const targetSafeAccount = await toSafeSmartAccount({
    ...smartAccountConfig,
    client: targetPublicClient,
  });

  const targetSmartAccountClient = createSmartAccountClient({
    account: targetSafeAccount,
    chain,
    bundlerTransport: http(
      `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
    ),
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await targetPimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  }).extend(erc7579Actions());

  return targetSmartAccountClient;
};

export const deployAccount = async ({
  smartAccount,
  chain,
}: {
  smartAccount: any;
  chain: Chain;
}) => {
  if (await isDeployed({ chain, address: smartAccount.account.address })) {
    console.log("Account already deployed:", smartAccount.account.address);
    return;
  }
  const txHash = await smartAccount.sendTransaction({
    calls: [
      {
        to: zeroAddress,
        data: "0x",
      },
    ],
  });
  console.log("deployment tx hash:", txHash);

  const targetPimlicoClient = createPimlicoClient({
    transport: http(
      `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
    ),
    entryPoint: {
      address: entryPoint07Address,
      version: "0.7",
    },
  });
  await targetPimlicoClient.waitForUserOperationReceipt({
    hash: txHash,
  });

  // const publicClient = getPublicClientByChainId(chain.id);
  //
  // const deploymentAccount: Account = privateKeyToAccount(
  //   process.env.DEPLOYMENT_PRIVATE_KEY! as Hex,
  // );
  //
  // const walletClient = createWalletClient({
  //   chain: smartAccount.chain,
  //   transport: http(),
  // });
  //
  // const fundingTxHash = await walletClient.sendTransaction({
  //   chain: smartAccount.chain,
  //   account: deploymentAccount,
  //   to: smartAccount.factory,
  //   data: smartAccount.factoryData,
  // });
  //
  // console.log("deployment tx hash:", fundingTxHash);
  //
  // await publicClient.waitForTransactionReceipt({
  //   hash: fundingTxHash,
  // });
};

export const isDeployed = async ({
  chain,
  address,
}: {
  chain: Chain;
  address: Address;
}) => {
  const publicClient = getPublicClientByChainId(chain.id);
  const code = await publicClient.getCode({
    address,
  });
  return code && code !== "0x";
};

// const smartAccount = getSmartAccount({
//   chain: baseSepolia,
//   owner: privateKeyToAccount(
//     '0x2c0fa7bd637b26e11cd67bc8fd49678297d5b7af83a839a76d13f006bea66769',
//   ), // 0x821638e3A12b36972FC4A52232B390B7B247E7fA
//   accountType: 'safe',
// })
// deployAccount({ smartAccount, chain: baseSepolia }).then(() => {
//   console.log('Account deployed:', smartAccount.address)
// })

// export const getSmartAccount = async ({
//   chain,
//   owner,
// }: {
//   chain: Chain;
//   owner: Account;
// }) => {
//   const publicClient = getPublicClient(chain);
//
//   const ownableValidator = getOwnableValidator({
//     owners: [owner.address],
//     threshold: 1,
//   });
//
//   const samechainModuleAddress = process.env.DEV_CONTRACTS
//     ? "0x7e57c096c750b120de3fea6bcbfaab82be7503e8"
//     : getSameChainModuleAddress();
//   const targetModuleAddress = process.env.DEV_CONTRACTS
//     ? "0x7e570e72420ac51f4fb57af8b6d991d0a94d87ba"
//     : getTargetModuleAddress();
//   const hookAddress = process.env.DEV_CONTRACTS
//     ? "0x7e571edd525ecda47bd79605304a8d2037f68a1b"
//     : getHookAddress();
//
//   const initializer = encodeFunctionData({
//     abi: parseAbi([
//       "function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment, address paymentReceiver) external",
//     ]),
//     functionName: "setup",
//     args: [
//       [owner.address],
//       BigInt(1),
//       "0x7579011aB74c46090561ea277Ba79D510c6C00ff",
//       encodeFunctionData({
//         abi: parseAbi([
//           "struct ModuleInit {address module;bytes initData;}",
//           "function addSafe7579(address safe7579,ModuleInit[] calldata validators,ModuleInit[] calldata executors,ModuleInit[] calldata fallbacks, ModuleInit[] calldata hooks,address[] calldata attesters,uint8 threshold) external",
//         ]),
//         functionName: "addSafe7579",
//         args: [
//           "0x7579EE8307284F293B1927136486880611F20002",
//           [
//             {
//               module: ownableValidator.address,
//               initData: ownableValidator.initData,
//             },
//           ],
//           [
//             {
//               module: samechainModuleAddress,
//               initData: "0x",
//             },
//             {
//               module: targetModuleAddress,
//               initData: "0x",
//             },
//             {
//               module: hookAddress,
//               initData: "0x",
//             },
//           ],
//           [
//             {
//               module: targetModuleAddress,
//               initData: encodeAbiParameters(
//                 [
//                   { name: "selector", type: "bytes4" },
//                   { name: "flags", type: "bytes1" },
//                   { name: "data", type: "bytes" },
//                 ],
//                 ["0x3a5be8cb", "0x00", "0x"],
//               ),
//             },
//           ],
//           [],
//           [
//             RHINESTONE_ATTESTER_ADDRESS, // Rhinestone Attester
//             "0x6D0515e8E499468DCe9583626f0cA15b887f9d03", // Mock attester for omni account
//           ],
//           1,
//         ],
//       }),
//       "0x7579EE8307284F293B1927136486880611F20002",
//       zeroAddress,
//       BigInt(0),
//       zeroAddress,
//     ],
//   });
//
//   const proxyFactory: Address = "0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67";
//   const saltNonce = 234n;
//   const factoryData = encodeFunctionData({
//     abi: parseAbi([
//       "function createProxyWithNonce(address singleton,bytes calldata initializer,uint256 saltNonce) external payable returns (address)",
//     ]),
//     functionName: "createProxyWithNonce",
//     args: [
//       "0x29fcb43b46531bca003ddc8fcb67ffe91900c762",
//       initializer,
//       saltNonce,
//     ],
//   });
//
//   const salt = keccak256(
//     encodePacked(["bytes32", "uint256"], [keccak256(initializer), saltNonce]),
//   );
//   const hash = keccak256(
//     encodePacked(
//       ["bytes1", "address", "bytes32", "bytes32"],
//       [
//         "0xff",
//         proxyFactory,
//         salt,
//         "0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee",
//       ],
//     ),
//   );
//
//   const safeAccountAddress = getAddress(slice(hash, 12, 32));
//
//   return {
//     address: safeAccountAddress,
//     factory: proxyFactory,
//     factoryData,
//     // backwards compat
//     chain: chain,
//     account: {
//       address: safeAccountAddress,
//     },
//   };
// };
//
// export const deployAccount = async ({
//   smartAccount,
// }: {
//   smartAccount: any;
// }) => {
//   const publicClient = getPublicClient(smartAccount.chain);
//
//   const code = await publicClient.getCode({
//     address: smartAccount.account.address,
//   });
//
//   if (!!code && code !== "0x") {
//     return;
//   }
//
//   const deploymentAccount: Account = privateKeyToAccount(
//     process.env.DEPLOYMENT_PRIVATE_KEY! as Hex,
//   );
//
//   const walletClient = createWalletClient({
//     chain: smartAccount.chain,
//     transport: http(),
//   });
//
//   const deploymentTxHash = await walletClient.sendTransaction({
//     chain: smartAccount.chain,
//     account: deploymentAccount,
//     to: smartAccount.factory,
//     data: smartAccount.factoryData,
//   });
//
//   await publicClient.waitForTransactionReceipt({
//     hash: deploymentTxHash,
//   });
// };
