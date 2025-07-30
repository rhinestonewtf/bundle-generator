import {
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
  keccak256,
  parseEther,
  toHex,
} from "viem";
import { deployAccount, getSmartAccount } from "./account.js";
import { getElementTypeHash, signOrderBundle } from "./utils/signing.js";
import { waitForBundleResult } from "./utils/bundleStatus.js";
import { Intent, Token } from "./types.js";
import { getChain } from "./utils/chains.js";
import { convertTokenAmount } from "./utils/tokens.js";
import { fundAccount } from "./funding.js";
import axios from "axios";
import { setEmissary } from "./compact.js";

export function ts() {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
}

function convertBigIntFields(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "bigint") {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map(convertBigIntFields);
  }

  if (typeof obj === "object") {
    const result: any = {};
    for (const key in obj) {
      if (Object.hasOwn(obj, key)) {
        result[key] = convertBigIntFields(obj[key]);
      }
    }
    return result;
  }

  return obj;
}

function parseCompactResponse(response: any): any {
  const parseOp = (op: any) => {
    return {
      to: op.to as Address,
      value: BigInt(op.value),
      data: op.data as Hex,
    };
  };

  return {
    sponsor: response.sponsor as Address,
    nonce: BigInt(response.nonce),
    expires: BigInt(response.expires),
    elements: response.elements.map((element: any) => {
      return {
        arbiter: element.arbiter as Address,
        chainId: BigInt(element.chainId),
        idsAndAmounts: element.idsAndAmounts.map((idsAndAmount: any) => {
          return [BigInt(idsAndAmount[0]), BigInt(idsAndAmount[1])];
        }),
        beforeFill: element.beforeFill,
        smartAccountStatus: element.smartAccountStatus,
        mandate: {
          recipient: element.mandate.recipient as Address,
          tokenOut: element.mandate.tokenOut.map((tokenOut: any) => {
            return [BigInt(tokenOut[0]), BigInt(tokenOut[1])];
          }),
          destinationChainId: BigInt(element.mandate.destinationChainId),
          fillDeadline: element.mandate.fillDeadline,
          destinationOps: element.mandate.destinationOps.map(parseOp),
          preClaimOps: element.mandate.preClaimOps.map(parseOp),
          qualifier: element.mandate.qualifier,
        },
      };
    }),
    serverSignature: response.serverSignature,
    signedMetadata: response.signedMetadata,
  };
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

    // await depositToCompact(sourceSmartAccount, chain.id, parseEther("0.0001"));
    // await setEmissary(chain.id, sourceSmartAccount);

    // await deployAccount({ smartAccount: sourceSmartAccount, chain });
  }

  // await setEmissary(targetChain.id, targetSmartAccount);

  // await deployAccount({ smartAccount: targetSmartAccount, chain: targetChain });

  const target = intent.tokenRecipient as Address;

  const startTime = new Date().getTime();

  const destinationGasUnits = 500_000n;
  // create the meta intent
  const metaIntent: any = {
    destinationChainId: targetChain.id,
    tokenTransfers: intent.targetTokens.map((token: Token) => {
      return {
        tokenAddress: getTokenAddress(token.symbol, targetChain.id),
        amount: convertTokenAmount({ token }),
      };
    }),
    account: {
      address: targetSmartAccount.account.address,
      accountType: "ERC7579",
      setupOps: [
        {
          to: targetSmartAccount.factory,
          data: targetSmartAccount.factoryData,
        },
      ],
      // eip7702Delegation: {
      //   chainId: 0,
      //   nonce: 0n,
      //   contractAddress: "0x0000000071727de22e5e9d8baf0edac6f37da032",
      //   r: keccak256("0x"),
      //   s: keccak256("0x"),
      //   yParity: 0,
      // },
    },
    destinationExecutions: intent.targetTokens.map((token: Token) => {
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
    destinationGasUnits,
    options: {
      // settlementLayers: ["ECO"],
      // sponsorSettings: {
      //   gasSponsored: true,
      //   bridgeFeesSponsored: true,
      //   swapFeesSponsored: true,
      // },
    },
  };

  if (intent.sourceChains.length > 0) {
    if (intent.sourceTokens.length === 0) {
      metaIntent.accountAccessList = {
        chainIds: [],
      };
      for (const sourceChain of intent.sourceChains) {
        const chain = getChain(sourceChain);
        metaIntent.accountAccessList.chainIds.push(chain.id);
      }
    } else {
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
  }

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
          .toLowerCase()}.${token.symbol.toLowerCase()}`,
    )
    .join(", ");

  const recipientLabel = intent.tokenRecipient.slice(0, 6);

  const bundleLabel = `${sourceAssetsLabel} > ${targetAssetsLabel} to ${recipientLabel}`;

  console.log(`${ts()} Bundle ${bundleLabel}: Generating Intent`);

  const BEARER_TOKEN = process.env.ORCHESTRATOR_BEARER_TOKEN;

  // const { data: orderCost } = await axios.post(
  //   `${process.env.ORCHESTRATOR_API_URL}/intents/cost`,
  //   {
  //     ...convertBigIntFields({
  //       ...metaIntent,
  //       tokenTransfers: metaIntent.tokenTransfers.map(
  //         (transfer: TokenTransfer) => ({
  //           tokenAddress: transfer.tokenAddress,
  //         }),
  //       ),
  //     }),
  //   },
  //   {
  //     headers: {
  //       "x-api-key": process.env.ORCHESTRATOR_API_KEY!,
  //       Authorization: `Bearer ${BEARER_TOKEN}`,
  //     },
  //   },
  // );

  // console.dir(orderCost, { depth: null });

  // const orderPath = await orchestrator.getOrderPath(
  //   metaIntent,
  //   targetSmartAccount.account.address,
  // );
  //

  const { data: orderResponse } = await axios.post(
    `${process.env.ORCHESTRATOR_API_URL}/intents/route`,
    {
      ...convertBigIntFields(metaIntent),
    },
    {
      headers: {
        "x-api-key": process.env.ORCHESTRATOR_API_KEY!,
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
    },
  );

  const intentOp = parseCompactResponse(orderResponse.intentOp);
  // const orderPath = response.data.orderBundles.map((orderPath: any) => {
  //   return {
  //     orderBundle: parseCompactResponse(orderPath.orderBundle),
  //     injectedExecutions: orderPath.injectedExecutions.map((exec: any) => {
  //       return {
  //         ...exec,
  //         value: BigInt(exec.value),
  //       };
  //     }),
  //     intentCost: parseOrderCost(orderPath.intentCost),
  //   };
  // });

  console.log(
    `${ts()} Bundle ${bundleLabel}: Generated ${intentOp.nonce} in ${
      new Date().getTime() - startTime
    }ms`,
  );

  // orderPath[0].orderBundle.segments[0].witness.execs = [
  //   ...orderPath[0].injectedExecutions.filter(
  //     (e: any) => e.to !== getHookAddress(targetChain.id),
  //   ),
  //   ...metaIntent.targetExecutions,
  // ];

  const signedIntentOp = await signOrderBundle({
    intentOp,
    owner,
  });

  // console.dir(orderResponse, { depth: null });
  // console.dir(signedIntentOp, { depth: null });

  console.log(
    `${ts()} Bundle ${bundleLabel}: Signed in ${
      new Date().getTime() - startTime
    }ms`,
  );

  // send the signed bundle
  // const bundleResults: PostOrderBundleResult =
  //   await orchestrator.postSignedOrderBundle([
  //     {
  //       signedOrderBundle,
  //       // initCode: encodePacked(
  //       //   ["address", "bytes"],
  //       //   [targetSmartAccount.factory, targetSmartAccount.factoryData],
  //       // ),
  //     },
  //   ]);

  if (process.env.SIMULATE === "true") {
    const response = await axios.post(
      `${process.env.ORCHESTRATOR_API_URL}/intent-operations/simulate`,
      {
        signedIntentOp: convertBigIntFields(signedIntentOp),
      },
      {
        headers: {
          "x-api-key": process.env.ORCHESTRATOR_API_KEY!,
          Authorization: `Bearer ${BEARER_TOKEN}`,
        },
      },
    );

    const bundleResult = {
      simulations: response.data.result.simulations,
      result: response.data.result.result,
      id: BigInt(response.data.result.id),
    };

    console.log(
      `${ts()} Bundle ${bundleLabel}: Simulation result after ${new Date().getTime() - startTime} ms`,
      {
        ...bundleResult,
      },
    );

    if (bundleResult.simulations?.length > 0) {
      console.dir(bundleResult.simulations, { depth: null });
    }
  } else {
    try {
      const response = await axios.post(
        `${process.env.ORCHESTRATOR_API_URL}/intent-operations`,
        {
          signedIntentOp: convertBigIntFields(signedIntentOp),
        },
        {
          headers: {
            "x-api-key": process.env.ORCHESTRATOR_API_KEY!,
            Authorization: `Bearer ${BEARER_TOKEN}`,
          },
        },
      );

      console.dir(response.data, { depth: null });

      const bundleResult = {
        ...response.data,
        id: BigInt(response.data.result.id),
      };

      console.log(
        `${ts()} Bundle ${bundleLabel}: Sent in ${new Date().getTime() - startTime}ms`,
      );

      const result = await waitForBundleResult({
        bundleResult,
        orchestrator,
        bundleLabel,
        processStartTime: startTime,
        bearerToken: BEARER_TOKEN,
      });

      console.log(
        `${ts()} Bundle ${bundleLabel}: Result after ${new Date().getTime() - startTime} ms`,
        {
          status: result.status,
          claims: result.claims,
          destinationChainId: result.destinationChainId,
          fillTransactionHash: result.fillTransactionHash,
          fillTimestamp: result.fillTimestamp,
        },
      );

      if (process.env.FEE_DEBUG === "true") {
        // const fees = await handleFeeAnalysis({
        //   result,
        //   orderPath,
        //   targetGasUnits,
        // });
        //
        // console.log(`${ts()} Bundle ${bundleLabel}: Fees`, fees);
      }
    } catch (error) {
      console.log(error);
      // @ts-ignore
      console.dir(error?.response?.data, { depth: null });
    }
  }
};
