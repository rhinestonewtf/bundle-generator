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
import intent from "../intent.json";
import { Token } from "./types";
import { getChain } from "./chains";
import { config } from "dotenv";
config();

export const main = async () => {
  const orchestrator = getOrchestrator(process.env.ORCHESTRATOR_API_KEY!);

  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex,
  );

  for (const sourceChain of intent.sourceChains) {
    const chain = getChain(sourceChain);
    const sourceSmartAccount = await getSmartAccount({
      chain,
      owner,
    });

    await deployAccount({ smartAccount: sourceSmartAccount });
  }

  const targetChain = getChain(intent.targetChain);

  const targetSmartAccount = await getSmartAccount({
    chain: targetChain,
    owner,
  });

  const target = intent.tokenRecipient as Address;

  // create the meta intent
  const metaIntent: MetaIntent = {
    targetChainId: targetChain.id,
    tokenTransfers: intent.targetTokens.map((token: Token) => {
      return {
        tokenAddress: getTokenAddress(token.symbol, targetChain.id),
        amount: BigInt(parseInt(token.amount)),
      };
    }),
    targetAccount: targetSmartAccount.account.address,
    targetExecutions: intent.targetTokens.map((token: Token) => {
      return {
        to:
          token.symbol == "ETH"
            ? target
            : getTokenAddress(token.symbol, targetChain.id),
        value: token.symbol == "ETH" ? BigInt(parseInt(token.amount)) : 0n,
        data:
          token.symbol == "ETH"
            ? "0x"
            : encodeFunctionData({
                abi: erc20Abi,
                functionName: "transfer",
                args: [target, BigInt(parseInt(token.amount))],
              }),
      };
    }),
  };

  const orderPath = await orchestrator.getOrderPath(
    metaIntent,
    targetSmartAccount.account.address,
  );

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

  const result = await waitForBundleResult({
    bundleResults,
    orchestrator,
  });

  console.log("Bundle result: ", result);

  return {
    account: targetSmartAccount.account.address,
  };
};

main();
