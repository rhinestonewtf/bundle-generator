import {
  Account,
  Address,
  Chain,
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
import { getPublicClient } from "./utils/clients.js";
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

export const getSmartAccount = async ({
  chain,
  owner,
}: {
  chain: Chain;
  owner: Account;
}) => {
  const publicClient = getPublicClient(chain);

  const ownableValidator = getOwnableValidator({
    owners: [owner.address],
    threshold: 1,
  });

  const samechainModuleAddress = process.env.DEV_CONTRACTS
    ? "0x7e57c096c750b120de3fea6bcbfaab82be7503e8"
    : getSameChainModuleAddress();
  const targetModuleAddress = process.env.DEV_CONTRACTS
    ? "0x7e570e72420ac51f4fb57af8b6d991d0a94d87ba"
    : getTargetModuleAddress();
  const hookAddress = process.env.DEV_CONTRACTS
    ? "0x7e571edd525ecda47bd79605304a8d2037f68a1b"
    : getHookAddress();

  const initializer = encodeFunctionData({
    abi: parseAbi([
      "function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment, address paymentReceiver) external",
    ]),
    functionName: "setup",
    args: [
      [owner.address],
      BigInt(1),
      "0x7579011aB74c46090561ea277Ba79D510c6C00ff",
      encodeFunctionData({
        abi: parseAbi([
          "struct ModuleInit {address module;bytes initData;}",
          "function addSafe7579(address safe7579,ModuleInit[] calldata validators,ModuleInit[] calldata executors,ModuleInit[] calldata fallbacks, ModuleInit[] calldata hooks,address[] calldata attesters,uint8 threshold) external",
        ]),
        functionName: "addSafe7579",
        args: [
          "0x7579EE8307284F293B1927136486880611F20002",
          [
            {
              module: ownableValidator.address,
              initData: ownableValidator.initData,
            },
          ],
          [
            {
              module: samechainModuleAddress,
              initData: "0x",
            },
            {
              module: targetModuleAddress,
              initData: "0x",
            },
            {
              module: hookAddress,
              initData: "0x",
            },
          ],
          [
            {
              module: targetModuleAddress,
              initData: encodeAbiParameters(
                [
                  { name: "selector", type: "bytes4" },
                  { name: "flags", type: "bytes1" },
                  { name: "data", type: "bytes" },
                ],
                ["0x3a5be8cb", "0x00", "0x"],
              ),
            },
          ],
          [],
          [
            RHINESTONE_ATTESTER_ADDRESS, // Rhinestone Attester
            "0x6D0515e8E499468DCe9583626f0cA15b887f9d03", // Mock attester for omni account
          ],
          1,
        ],
      }),
      "0x7579EE8307284F293B1927136486880611F20002",
      zeroAddress,
      BigInt(0),
      zeroAddress,
    ],
  });

  const proxyFactory: Address = "0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67";
  const saltNonce = 234n;
  const factoryData = encodeFunctionData({
    abi: parseAbi([
      "function createProxyWithNonce(address singleton,bytes calldata initializer,uint256 saltNonce) external payable returns (address)",
    ]),
    functionName: "createProxyWithNonce",
    args: [
      "0x29fcb43b46531bca003ddc8fcb67ffe91900c762",
      initializer,
      saltNonce,
    ],
  });

  const salt = keccak256(
    encodePacked(["bytes32", "uint256"], [keccak256(initializer), saltNonce]),
  );
  const hash = keccak256(
    encodePacked(
      ["bytes1", "address", "bytes32", "bytes32"],
      [
        "0xff",
        proxyFactory,
        salt,
        "0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee",
      ],
    ),
  );

  const safeAccountAddress = getAddress(slice(hash, 12, 32));

  return {
    address: safeAccountAddress,
    factory: proxyFactory,
    factoryData,
    // backwards compat
    chain: chain,
    account: {
      address: safeAccountAddress,
    },
  };
};

export const deployAccount = async ({
  smartAccount,
}: {
  smartAccount: any;
}) => {
  const publicClient = getPublicClient(smartAccount.chain);

  const code = await publicClient.getCode({
    address: smartAccount.account.address,
  });

  if (!!code && code !== "0x") {
    return;
  }

  const deploymentAccount: Account = privateKeyToAccount(
    process.env.DEPLOYMENT_PRIVATE_KEY! as Hex,
  );

  const walletClient = createWalletClient({
    chain: smartAccount.chain,
    transport: http(),
  });

  const deploymentTxHash = await walletClient.sendTransaction({
    chain: smartAccount.chain,
    account: deploymentAccount,
    to: smartAccount.factory,
    data: smartAccount.factoryData,
  });

  await publicClient.waitForTransactionReceipt({
    hash: deploymentTxHash,
  });
};
