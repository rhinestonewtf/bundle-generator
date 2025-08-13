import axios from "axios";
import { createRhinestoneAccount, getTokenAddress, IntentOp } from "@rhinestone/sdk";
import { Account, privateKeyToAccount } from "viem/accounts";
import { Address, encodeFunctionData, erc20Abi, Hex } from "viem";
import { Intent, Token, TokenSymbol } from "./types.js";
import { getChain } from "./utils/chains.js";
import { convertTokenAmount } from "./utils/tokens.js";
import { fundAccount } from "./funding.js";
import { convertBigIntFields } from "./utils/7702.js";
import { getOrchestratorUrl } from "./utils/config.js";

export function ts() {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
}

export const processIntent = async (intent: Intent) => {
  // create the eoa account
  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex
  );

  // create the rhinestone account instance
  const rhinestoneAccount = await createRhinestoneAccount({
    owners: {
      type: "ecdsa" as const,
      accounts: [owner],
    },
    rhinestoneApiKey: process.env.ORCHESTRATOR_API_KEY!,
  });

  // get the target chain and source chains
  const targetChain = getChain(intent.targetChain);
  const sourceChains =
    intent.sourceChains.length > 0 ? intent.sourceChains.map(getChain) : [];

  // fund the account
  const accountAddress = await rhinestoneAccount.getAddress();
  await fundAccount({
    account: accountAddress,
    sourceChains: intent.sourceChains,
    sourceTokens: intent.sourceTokens,
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
          .toLowerCase()}.${token.symbol.toLowerCase()}`
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
  const preparedTransaction = await rhinestoneAccount.prepareTransaction({
    sourceChains: sourceChains.length > 0 ? sourceChains : undefined,
    targetChain,
    calls,
    tokenRequests,
  });
  const prepareEndTime = new Date().getTime();
  console.log(
    `${ts()} Bundle ${bundleLabel}: [1/4] Prepared in ${
      prepareEndTime - prepareStartTime
    }ms`
  );

  // sign the transaction with signTransaction method
  console.log(`${ts()} Bundle ${bundleLabel}: [2/4] Signing transaction...`);
  const signedTransaction = await rhinestoneAccount.signTransaction(
    preparedTransaction
  );
  const signEndTime = new Date().getTime();
  console.log(
    `${ts()} Bundle ${bundleLabel}: [2/4] Signed in ${
      signEndTime - prepareEndTime
    }ms`
  );

  // extract the signed intent operation for submission
  let intentOp: IntentOp;
  if (preparedTransaction.data.type === "intent") {
    intentOp = preparedTransaction.data.intentRoute.intentOp;
  } else {
    throw new Error("Invalid transaction data");
  }
  const signedIntentOp = {
    ...intentOp,
    originSignatures: Array(intentOp.elements.length).fill(
      signedTransaction.signature
    ),
    destinationSignature: signedTransaction.signature,
  };

  // ----- Phase 3: Submit or Simulate
  if (process.env.SIMULATE === "true") {
    console.log(
      `${ts()} Bundle ${bundleLabel}: Running in simulation mode - will not execute`
    );

    try {
      const simulationStartTime = new Date().getTime();
      console.log(
        `${ts()} Bundle ${bundleLabel}: [3/4] Submitting transaction...`
      );
      // simulate the transaction with the orchestrator
      const response = await axios.post(
        `${getOrchestratorUrl(targetChain.id)}/intent-operations/simulate`,
        {
          signedIntentOp: convertBigIntFields(signedIntentOp),
        },
        {
          headers: {
            "x-api-key": process.env.ORCHESTRATOR_API_KEY!,
          },
        }
      );

      // get the simulation result
      const bundleResult = {
        simulations: response.data.result.simulations,
        result: response.data.result.result,
        id: BigInt(response.data.result.id),
      };

      // log the simulation result
      console.log(
        `${ts()} Bundle ${bundleLabel}: Simulation result after ${
          new Date().getTime() - simulationStartTime
        } ms`,
        {
          ...bundleResult,
        }
      );

      return;
    } catch (error: any) {
      console.error(
        `${ts()} Bundle ${bundleLabel}: Simulation failed`,
        error?.response?.data ?? error
      );
      return;
    }
  } else {
    try {
      const submitStartTime = new Date().getTime();
      console.log(
        `${ts()} Bundle ${bundleLabel}: [3/4] Submitting transaction...`
      );
      const response = await axios.post(
        `${getOrchestratorUrl(targetChain.id)}/intent-operations`,
        {
          signedIntentOp: convertBigIntFields(signedIntentOp),
        },
        {
          headers: {
            "x-api-key": process.env.ORCHESTRATOR_API_KEY!,
          },
        }
      );
      const submitEndTime = new Date().getTime();
      console.log(
        `${ts()} Bundle ${bundleLabel}: [3/4] Submitted in ${
          submitEndTime - submitStartTime
        }ms`
      );

      const transactionResult = {
        type: "intent" as const,
        id: BigInt(response.data.result.id),
        sourceChains: sourceChains.map((c) => c.id),
        targetChain: targetChain.id,
      };

      console.log(
        `${ts()} Bundle ${bundleLabel}: [4/4] Waiting for execution...`
      );
      const executionStartTime = new Date().getTime();
      const result = await rhinestoneAccount.waitForExecution(
        transactionResult
      );
      const executionEndTime = new Date().getTime();

      console.log(
        `${ts()} Bundle ${bundleLabel}: Execution completed in ${
          executionEndTime - executionStartTime
        }ms`
      );
      console.log(
        `${ts()} Bundle ${bundleLabel}: Total time: ${
          executionEndTime - prepareStartTime
        }ms ` +
          `(Prepare: ${prepareEndTime - prepareStartTime}ms, Sign: ${
            signEndTime - prepareEndTime
          }ms, Submit: ${submitEndTime - signEndTime}ms, Execute: ${
            executionEndTime - executionStartTime
          }ms)`
      );
      console.dir(result, { depth: null });
    } catch (error: any) {
      console.error(
        `${ts()} Bundle ${bundleLabel}: Submission/Execution failed`,
        error?.response?.data ?? error
      );
    }
  }
};
