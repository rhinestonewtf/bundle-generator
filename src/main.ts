import { createRhinestoneAccount } from "@rhinestone/sdk";
import { Account, privateKeyToAccount } from "viem/accounts";
import { Address, encodeFunctionData, erc20Abi, Hex } from "viem";
import { Intent, Token } from "./types.js";
import { getChain } from "./utils/chains.js";
import { convertTokenAmount, getTokenAddress } from "./utils/tokens.js";
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
  const sourceChain =
    intent.sourceChains.length > 0
      ? getChain(intent.sourceChains[0])
      : targetChain;

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

  console.log(`${ts()} Bundle ${bundleLabel}: Generating Intent`);

  const transaction = await rhinestoneAccount.sendTransaction({
    sourceChains: intent.sourceChains.length > 0 ? [sourceChain] : undefined,
    targetChain,
    calls,
    tokenRequests,
  });

  console.log(
    `${ts()} Bundle ${bundleLabel}: Generated ${
      "hash" in transaction ? transaction.hash : "transaction"
    } in ${new Date().getTime() - startTime}ms`
  );

  console.log(
    `${ts()} Bundle ${bundleLabel}: Sent in ${
      new Date().getTime() - startTime
    }ms`
  );

  // Wait for execution using the new SDK method
  const result = await rhinestoneAccount.waitForExecution(transaction);

  console.log(
    `${ts()} Bundle ${bundleLabel}: Result after ${
      new Date().getTime() - startTime
    } ms`
  );

  console.dir(result, { depth: null });
};
