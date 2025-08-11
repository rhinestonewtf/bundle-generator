import { createRhinestoneAccount, getTokenAddress } from "@rhinestone/sdk";
import { Account, privateKeyToAccount } from "viem/accounts";
import { Address, encodeFunctionData, erc20Abi, Hex } from "viem";
import { Intent, Token } from "./types.js";
import { getChain } from "./utils/chains.js";
import { convertTokenAmount } from "./utils/tokens.js";
import { fundAccount } from "./funding.js";

export function ts() {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
}

export const processIntent = async (intent: Intent) => {
  // Validate intent configuration
  if (intent.sourceChains.length > 0 && intent.sourceTokens.length === 0) {
    throw new Error(
      `Invalid intent configuration: You specified source chains (${intent.sourceChains.join(
        ", "
      )}) but no source tokens. ` +
        `Please specify which tokens on the source chains should be used to obtain the target tokens.`
    );
  }

  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex
  );

  // Create RhinestoneAccount using the new SDK
  const rhinestoneAccount = await createRhinestoneAccount({
    owners: {
      type: "ecdsa",
      accounts: [owner],
    },
    rhinestoneApiKey: process.env.ORCHESTRATOR_API_KEY!,
  });

  const targetChain = getChain(intent.targetChain);
  const sourceChains =
    intent.sourceChains.length > 0 ? intent.sourceChains.map(getChain) : [];

  // Handle funding for the account
  const accountAddress = await rhinestoneAccount.getAddress();
  await fundAccount({
    account: accountAddress,
    sourceChains: intent.sourceChains,
    sourceTokens: intent.sourceTokens,
  });

  const target = intent.tokenRecipient as Address;
  const startTime = new Date().getTime();

  // Prepare calls for the target chain
  const calls = intent.targetTokens.map((token: Token) => {
    return {
      to:
        token.symbol == "ETH"
          ? target
          : getTokenAddress(token.symbol, targetChain.id),
      value: token.symbol == "ETH" ? convertTokenAmount({ token }) : 0n,
      data:
        token.symbol == "ETH"
          ? ("0x" as Hex)
          : encodeFunctionData({
              abi: erc20Abi,
              functionName: "transfer",
              args: [target, convertTokenAmount({ token })],
            }),
    };
  });

  // Prepare token requests
  const tokenRequests = intent.targetTokens.map((token: Token) => ({
    address: getTokenAddress(token.symbol, targetChain.id),
    amount: convertTokenAmount({ token }),
  }));

  const sourceAssetsLabel =
    intent.sourceChains.length > 0
      ? intent.sourceChains
          .map((chain) => {
            if (!intent.sourceTokens || intent.sourceTokens.length === 0) {
              return `${chain.slice(0, 3).toLowerCase()}.*`;
            }
            return intent.sourceTokens
              .map((token) => `${chain.slice(0, 3).toLowerCase()}.${token}`)
              .join(", ");
          })
          .join(" | ")
      : (intent.sourceTokens || []).join(", ");

  const targetAssetsLabel = intent.targetTokens
    .map(
      (token) =>
        `${token.amount} ${intent.targetChain
          .slice(0, 3)
          .toLowerCase()}.${token.symbol.toLowerCase()}`
    )
    .join(", ");

  const recipientLabel = intent.tokenRecipient.slice(0, 6);

  const bundleLabel = `${sourceAssetsLabel} > ${targetAssetsLabel} to ${recipientLabel}`;

  console.log(`${ts()} Bundle ${bundleLabel}: Starting transaction process`);

  // Phase 1: Prepare transaction
  const prepareStartTime = new Date().getTime();
  console.log(`${ts()} Bundle ${bundleLabel}: [1/3] Preparing transaction...`);

  // Transaction preparation happens internally in sendTransaction
  // but we can time the overall prepare+sign+submit phase
  const transaction = await rhinestoneAccount.sendTransaction({
    sourceChains: sourceChains.length > 0 ? sourceChains : undefined,
    targetChain,
    calls,
    tokenRequests,
  });

  const transactionSubmittedTime = new Date().getTime();
  console.log(
    `${ts()} Bundle ${bundleLabel}: [2/3] Transaction prepared and submitted in ${
      transactionSubmittedTime - prepareStartTime
    }ms`
  );

  // Phase 3: Wait for execution
  console.log(`${ts()} Bundle ${bundleLabel}: [3/3] Waiting for execution...`);
  const executionStartTime = new Date().getTime();

  const result = await rhinestoneAccount.waitForExecution(transaction);

  const executionEndTime = new Date().getTime();
  console.log(
    `${ts()} Bundle ${bundleLabel}: Execution completed in ${
      executionEndTime - executionStartTime
    }ms`
  );

  console.log(
    `${ts()} Bundle ${bundleLabel}: Total time: ${
      executionEndTime - startTime
    }ms ` +
      `(Submit: ${transactionSubmittedTime - prepareStartTime}ms, Execute: ${
        executionEndTime - executionStartTime
      }ms)`
  );

  console.dir(result, { depth: null });
};
