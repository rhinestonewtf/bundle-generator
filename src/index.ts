const { getHookAddress } = require("@rhinestone/orchestrator-sdk");
import {
  getOrchestrator,
  getTokenAddress,
  type Execution,
  type MetaIntent,
  type PostOrderBundleResult,
  type TokenTransfer,
} from "@rhinestone/orchestrator-sdk";
import {
  Account,
  generatePrivateKey,
  privateKeyToAccount,
} from "viem/accounts";
import {
  Address,
  Chain,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  Hex,
} from "viem";
import { deployAccount, getSmartAccount } from "./account";
import { signOrderBundle } from "./signing";
import { waitForBundleResult } from "./bundleStatus";
import { Token } from "./types";
import { getChain } from "./chains";
import { config } from "dotenv";
import { convertTokenAmount } from "./tokens";
import { collectUserInput, showUserAccount } from "./cli";
config();

export const main = async () => {
  const intent = await collectUserInput();

  const orchestrator = getOrchestrator(process.env.ORCHESTRATOR_API_KEY!);

  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex,
  );

  const targetChain = getChain(intent.targetChain);

  const targetSmartAccount = await getSmartAccount({
    chain: targetChain,
    owner,
  });

  await showUserAccount(targetSmartAccount.account.address);

  for (const sourceChain of intent.sourceChains) {
    const chain = getChain(sourceChain);
    const sourceSmartAccount = await getSmartAccount({
      chain,
      owner,
    });

    await deployAccount({ smartAccount: sourceSmartAccount });
  }

  const target = intent.tokenRecipient as Address;

  // create the meta intent
  const metaIntent: MetaIntent = {
    targetChainId: targetChain.id,
    tokenTransfers: intent.targetTokens.map((token: Token) => {
      return {
        tokenAddress: getTokenAddress(token.symbol, targetChain.id),
        amount: convertTokenAmount({ token }),
      };
    }),
    targetAccount: targetSmartAccount.account.address,
    targetExecutions: intent.targetTokens.map((token: Token) => {
      return {
        to:
          token.symbol == "ETH"
            ? target
            : getTokenAddress(token.symbol, targetChain.id),
        value: token.symbol == "ETH" ? convertTokenAmount({ token }) : 0n,
        data:
          token.symbol == "ETH"
            ? "0x"
            : encodeFunctionData({
                abi: erc20Abi,
                functionName: "transfer",
                args: [target, convertTokenAmount({ token })],
              }),
      };
    }),
  };

  console.log("Intent generated");

  const orderPath = await orchestrator.getOrderPath(
    metaIntent,
    targetSmartAccount.account.address,
  );

  console.log("Bundle generated: " + orderPath[0].orderBundle.nonce);

  orderPath[0].orderBundle.segments[0].witness.execs = [
    ...orderPath[0].injectedExecutions.filter(
      (e: any) => e.to !== getHookAddress(targetChain.id),
    ),
    ...metaIntent.targetExecutions,
  ];

  const signedOrderBundle = await signOrderBundle({
    orderPath,
    owner,
  });

  console.log("Order bundle signed");

  // send the signed bundle
  const bundleResults: PostOrderBundleResult =
    await orchestrator.postSignedOrderBundle([
      {
        signedOrderBundle,
        initCode: encodePacked(
          ["address", "bytes"],
          [targetSmartAccount.factory, targetSmartAccount.factoryData],
        ),
      },
    ]);

  console.log("Bundle sent");

  const result = await waitForBundleResult({
    bundleResults,
    orchestrator,
  });

  console.log("Bundle result: ", result);
};

main();
