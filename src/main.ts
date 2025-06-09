import {
  getHookAddress,
  getOrchestrator,
  getTokenAddress,
  type Execution,
  type MetaIntent,
  type PostOrderBundleResult,
  type TokenTransfer,
} from "@rhinestone/sdk/orchestrator";
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
import { deployAccount, getSmartAccount } from "./account.js";
import { signOrderBundle } from "./utils/signing.js";
import { waitForBundleResult } from "./utils/bundleStatus.js";
import { Intent, Token } from "./types.js";
import { getChain } from "./utils/chains.js";
import { convertTokenAmount } from "./utils/tokens.js";
import { fundAccount } from "./funding.js";
import { handleFeeAnalysis } from "./fees.js";

export function ts() {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
}

export const processIntent = async (intent: Intent) => {
  const orchestrator = getOrchestrator(
    process.env.ORCHESTRATOR_API_KEY!,
    process.env.ORCHESTRATOR_API_URL,
  );

  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex,
  );

  const targetChain = getChain(intent.targetChain);

  const targetSmartAccount = await getSmartAccount({
    chain: targetChain,
    owner,
  });

  for (const sourceChain of intent.sourceChains) {
    const chain = getChain(sourceChain);
    const sourceSmartAccount = await getSmartAccount({
      chain,
      owner,
    });

    await fundAccount({
      account: sourceSmartAccount.account.address,
      sourceChains: intent.sourceChains,
      sourceTokens: intent.sourceTokens,
    });

    await deployAccount({ smartAccount: sourceSmartAccount });
  }

  const target = intent.tokenRecipient as Address;

  const startTime = new Date().getTime();

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

  await new Promise((resolve) => {
    if (intent.sourceChains.length > 0 && intent.sourceTokens.length > 0) {
      metaIntent.accountAccessList = [];
      for (const sourceChain of intent.sourceChains) {
        const chain = getChain(sourceChain);
        for (const sourceToken of intent.sourceTokens) {
          metaIntent.accountAccessList.push({
            chainId: chain.id,
            tokenAddress: getTokenAddress(sourceToken, chain.id),
          });
        }
      }
    }
    resolve(metaIntent);
  });

  const sourceAssetsLabel = intent.sourceChains
    .map((chain) =>
      intent.sourceTokens
        .map((token) => `${chain.slice(0, 3).toLowerCase()}.${token}`)
        .join(", "),
    )
    .join(" | ");

  const targetAssetsLabel = intent.targetTokens
    .map(
      (token) =>
        `${token.amount} ${intent.targetChain.slice(0, 3).toLowerCase()}.${token.symbol.toLowerCase()}`,
    )
    .join(", ");

  const recipientLabel = intent.tokenRecipient.slice(0, 6);

  const bundleLabel = `${sourceAssetsLabel} > ${targetAssetsLabel} to ${recipientLabel}`;

  console.log(`${ts()} Bundle ${bundleLabel}: Generating Intent`);

  const orderPath = await orchestrator.getOrderPath(
    metaIntent,
    targetSmartAccount.account.address,
  );

  console.log(
    `${ts()} Bundle ${bundleLabel}: Generated ${orderPath[0].orderBundle.nonce} in ${new Date().getTime() - startTime}ms`,
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

  console.log(
    `${ts()} Bundle ${bundleLabel}: Signed in ${new Date().getTime() - startTime}ms`,
  );

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

  console.log(
    `${ts()} Bundle ${bundleLabel}: Sent in ${new Date().getTime() - startTime}ms`,
  );

  const result = await waitForBundleResult({
    bundleResults,
    orchestrator,
    bundleLabel,
    processStartTime: startTime,
  });

  console.log(
    `${ts()} Bundle ${bundleLabel}: Result after ${new Date().getTime() - startTime} ms`,
    result,
  );

  if (process.env.FEE_DEBUG === "true") {
    const fees = await handleFeeAnalysis({
      result,
      orderPath,
    });

    console.log(`${ts()} Bundle ${bundleLabel}: Fees`, fees);
  }
};
