import { createRhinestoneAccount, getTokenAddress } from "@rhinestone/sdk";
import { Account, privateKeyToAccount } from "viem/accounts";
import { Address, encodeFunctionData, erc20Abi, Hex } from "viem";
import { Intent, Token, TokenSymbol } from "./types.js";
import { getChain } from "./utils/chains.js";
import { convertTokenAmount } from "./utils/tokens.js";
import { fundAccount } from "./funding.js";
import { getEnvironment } from "./utils/environments.js";

export function ts() {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
}

export const processIntent = async (
  intent: Intent,
  environmentString: string,
  executionMode: string,
) => {
  // create the eoa account
  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex,
  );

  const environment = getEnvironment(environmentString);
  const orchestratorUrl = environment.url;
  const rhinestoneApiKey = environment.apiKey;

  // create the rhinestone account instance
  const rhinestoneAccount = await createRhinestoneAccount({
    owners: {
      type: "ecdsa" as const,
      accounts: [owner],
    },
    rhinestoneApiKey,
    orchestratorUrl,
  });

  // get the target chain and source chains
  const targetChain = getChain(intent.targetChain);
  const sourceChains =
    intent.sourceChains.length > 0
      ? intent.sourceChains.map((chain) => getChain(chain))
      : [];

  // fund the account
  const accountAddress = rhinestoneAccount.getAddress();
  await fundAccount({
    account: accountAddress,
    sourceChains: intent.sourceChains,
    sourceTokens: intent.sourceTokens,
    environment: environmentString,
  });

  // get the target address
  const target = intent.tokenRecipient as Address;

  // prepare the calls for the target chain
  const calls = intent.targetTokens.map((token: Token) => {
    return {
      to:
        token.symbol == "ETH"
          ? target
          : getTokenAddress(token.symbol as TokenSymbol, targetChain.id),
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

  // prepare the token requests
  const tokenRequests = intent.targetTokens.map((token: Token) => ({
    address: getTokenAddress(token.symbol as TokenSymbol, targetChain.id),
    amount: convertTokenAmount({ token }),
  }));

  // prepare the source assets label
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

  // prepare the target assets label
  const targetAssetsLabel = intent.targetTokens
    .map(
      (token) =>
        `${token.amount} ${intent.targetChain
          .slice(0, 3)
          .toLowerCase()}.${token.symbol.toLowerCase()}`,
    )
    .join(", ");

  // prepare the recipient label
  const recipientLabel = intent.tokenRecipient.slice(0, 6);

  const bundleLabel = `${sourceAssetsLabel} > ${targetAssetsLabel} to ${recipientLabel}`;

  console.log(`${ts()} Bundle ${bundleLabel}: Starting transaction process`);

  // ----- Phase 1: Prepare transaction
  const prepareStartTime = new Date().getTime();
  console.log(`${ts()} Bundle ${bundleLabel}: [1/4] Preparing transaction...`);

  // prepare the transaction with prepareTransaction method
  const transactionDetails: any = {
    sourceChains: sourceChains.length > 0 ? sourceChains : undefined,
    targetChain,
    calls,
    tokenRequests,
    sponsored: intent.sponsored,
  };
  if (intent.settlementLayers?.length > 0) {
    transactionDetails.settlementLayers = intent.settlementLayers;
  }
  const preparedTransaction =
    await rhinestoneAccount.prepareTransaction(transactionDetails);

  // check that sponsorship is working correctly
  if (intent.sponsored) {
    // todo: adjust type in sdk
    const sponsorFee =
      // @ts-ignore
      preparedTransaction.data.intentRoute.intentCost.sponsorFee;
    if (sponsorFee == 0) {
      throw new Error("Sponsorship is not supplied as expected");
    }
  }

  const prepareEndTime = new Date().getTime();
  console.log(
    `${ts()} Bundle ${bundleLabel}: [1/4] Prepared in ${
      prepareEndTime - prepareStartTime
    }ms`,
  );

  // sign the transaction with signTransaction method
  console.log(`${ts()} Bundle ${bundleLabel}: [2/4] Signing transaction...`);
  const signedTransaction =
    await rhinestoneAccount.signTransaction(preparedTransaction);
  const signEndTime = new Date().getTime();
  console.log(
    `${ts()} Bundle ${bundleLabel}: [2/4] Signed in ${
      signEndTime - prepareEndTime
    }ms`,
  );

  // ----- Phase 3: Submit or Simulate
  if (executionMode == "simulate") {
    try {
      const simulationStartTime = new Date().getTime();
      console.log(
        `${ts()} Bundle ${bundleLabel}: [3/4] Simulating transaction...`,
      );

      // Simulate the transaction using the SDK
      const simulationResult =
        await rhinestoneAccount.simulateTransaction(signedTransaction);

      const simulationEndTime = new Date().getTime();

      // log the simulation result
      console.log(
        `${ts()} Bundle ${bundleLabel}: [4/4] Simulation result after ${
          simulationEndTime - simulationStartTime
        } ms`,
      );
      console.log(
        `${ts()} Bundle ${bundleLabel}: Total time: ${
          simulationEndTime - prepareStartTime
        }ms ` +
          `(Prepare: ${prepareEndTime - prepareStartTime}ms, Sign: ${
            signEndTime - prepareEndTime
          }ms, Simulation: ${simulationEndTime - signEndTime}ms`,
      );

      console.dir(simulationResult, { depth: null });

      return;
    } catch (error: any) {
      console.error(
        `${ts()} Bundle ${bundleLabel}: [4/4] Simulation failed`,
        error?.response?.data ?? error,
      );
      return;
    }
  } else {
    try {
      const submitStartTime = new Date().getTime();
      console.log(
        `${ts()} Bundle ${bundleLabel}: [3/4] Submitting transaction...`,
      );
      // submit the transaction using the SDK
      const transactionResult =
        await rhinestoneAccount.submitTransaction(signedTransaction);

      const submitEndTime = new Date().getTime();
      console.log(
        `${ts()} Bundle ${bundleLabel}: [3/4] Submitted in ${
          submitEndTime - submitStartTime
        }ms`,
      );

      console.log(
        `${ts()} Bundle ${bundleLabel}: [4/4] Waiting for execution...`,
      );
      const executionStartTime = new Date().getTime();
      const result =
        await rhinestoneAccount.waitForExecution(transactionResult);
      const executionEndTime = new Date().getTime();

      console.log(
        `${ts()} Bundle ${bundleLabel}: [4/4] Execution completed in ${
          executionEndTime - executionStartTime
        }ms`,
      );
      console.log(
        `${ts()} Bundle ${bundleLabel}: Total time: ${
          executionEndTime - prepareStartTime
        }ms ` +
          `(Prepare: ${prepareEndTime - prepareStartTime}ms, Sign: ${
            signEndTime - prepareEndTime
          }ms, Submit: ${submitEndTime - signEndTime}ms, Execute: ${
            executionEndTime - executionStartTime
          }ms)`,
      );
      console.dir(result, { depth: null });
    } catch (error: any) {
      console.error(
        `${ts()} Bundle ${bundleLabel}: Submission/Execution failed`,
        error?.response?.data ?? error,
      );
    }
  }
};
