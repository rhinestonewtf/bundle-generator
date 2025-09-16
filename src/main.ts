import {
  createRhinestoneAccount,
  getTokenAddress,
  IntentData,
} from "@rhinestone/sdk";
import { Account, privateKeyToAccount } from "viem/accounts";
import {
  Address,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  hashStruct,
  Hex,
  keccak256,
  numberToHex,
  serializeSignature,
  slice,
  toBytes,
  zeroAddress,
} from "viem";
import { Intent, Token, TokenSymbol } from "./types.js";
import { getChain } from "./utils/chains.js";
import { convertTokenAmount } from "./utils/tokens.js";
import { fundAccount } from "./funding.js";
import { getEnvironment } from "./utils/environments.js";
import { secp256k1 } from "@noble/curves/secp256k1";

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
  });

  // get the target address
  const target = intent.tokenRecipient as Address;

  // prepare the calls for the target chain
  const calls =
    intent.destinationOps == false
      ? []
      : intent.targetTokens.length
        ? intent.targetTokens.map((token: Token) => {
            return {
              to:
                token.symbol == "ETH"
                  ? target
                  : getTokenAddress(
                      token.symbol as TokenSymbol,
                      targetChain.id,
                    ),
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
          })
        : [
            {
              to: zeroAddress,
              data: "0x69696969",
            },
          ];

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

  const bundleLabel = `${sourceAssetsLabel} > ${targetAssetsLabel}${intent.settlementLayers?.length ? " via " + intent.settlementLayers.join() : ""}${intent.sponsored ? " sponsored" : ""} to ${recipientLabel}`;

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

  // console.dir(preparedTransaction.data as IntentData, { depth: null });

  // sign the transaction with signTransaction method
  console.log(`${ts()} Bundle ${bundleLabel}: [2/4] Signing transaction...`);
  // const signedTransaction =
  //   await rhinestoneAccount.signTransaction(preparedTransaction);

  function getPermit2BatchTransfer(
    tokens: any,
    nonce: bigint,
    deadline: bigint,
  ): {
    permit: any;
    tokenPermissions: any[];
    transferDetails: any[];
  } {
    const [tokenPermissions, transferDetails] = tokens.reduce(
      ([permissions, details], [id, amountIn]) => {
        const token = toToken(BigInt(id));
        const amount = BigInt(amountIn);
        const permission: any = { token, amount };
        const transfer: any = {
          to: zeroAddress, // Per `permit2_hashBatchWithWitness` in Hasher.sol's implementation
          requestedAmount: amount,
        };
        return [
          [...permissions, permission],
          [...details, transfer],
        ];
      },
      [[], []] as [any[], any[]],
    );

    const permit: any = {
      permitted: tokenPermissions,
      nonce,
      deadline,
    };
    return { permit, tokenPermissions, transferDetails };
  }

  const PERMIT_BATCH_WITNESS_TRANSFER_TYPEHASH =
    "0x8de80e276fe90b2123aed4e87fbe4ddaf72222e8dc7ac83631ebeae5d3908a89";

  function asSanitizedAddress(accountValue: bigint): string {
    return (
      "0x" + (accountValue & ((1n << 160n) - 1n)).toString(16).padStart(40, "0")
    );
  }

  function toToken(id: bigint): Address {
    return asSanitizedAddress(BigInt(id)) as Address;
  }

  function getMandateHash(mandate: any): Hex {
    return hashStruct({
      types: {
        Mandate: [
          { name: "target", type: "Target" },
          { name: "originOps", type: "Op[]" },
          { name: "destOps", type: "Op[]" },
          { name: "q", type: "bytes32" },
        ],
        Target: [
          { name: "recipient", type: "address" },
          { name: "tokenOut", type: "Token[]" },
          { name: "targetChain", type: "uint256" },
          { name: "fillExpiry", type: "uint256" },
        ],
        Token: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        Op: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
      primaryType: "Mandate",
      data: {
        target: {
          recipient: mandate.recipient,
          tokenOut: mandate.tokenOut.map((token: any) => ({
            token: toToken(token[0]),
            amount: token[1],
          })),
          targetChain: mandate.destinationChainId,
          fillExpiry: BigInt(mandate.fillDeadline),
        },
        originOps: mandate.preClaimOps,
        destOps: mandate.destinationOps,
        q: keccak256(mandate.qualifier.encodedVal),
      },
    });
  }

  const TOKEN_PERMISSIONS_TYPEHASH =
    "0x618358ac3db8dc274f0cd8829da7e234bd48cd73c4a740aede1adec9846d06a1";

  function hashTokenPermission(tokenPermission: any): Hex {
    return keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32", name: "TOKEN_PERMISSIONS_TYPEHASH" },
          { type: "address", name: "token" },
          { type: "uint256", name: "amount" },
        ],
        [
          TOKEN_PERMISSIONS_TYPEHASH,
          tokenPermission.token,
          tokenPermission.amount,
        ],
      ),
    );
  }

  function hashPermit2(
    nonce: bigint,
    deadline: bigint,
    arbiter: Address,
    element: any,
  ) {
    const { permit, tokenPermissions } = getPermit2BatchTransfer(
      element.idsAndAmounts,
      nonce,
      deadline,
    );
    const mandateHash = getMandateHash(element.mandate);
    const tokenPermissionHashes = tokenPermissions.map(hashTokenPermission);

    return keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32", name: "PERMIT_BATCH_WITNESS_TRANSFER_TYPEHASH" },
          { type: "bytes32", name: "tokenPermissionHash" },
          { type: "address", name: "arbiter" },
          { type: "uint256", name: "nonce" },
          { type: "uint256", name: "deadline" },
          { type: "bytes32", name: "mandate" },
        ],
        [
          PERMIT_BATCH_WITNESS_TRANSFER_TYPEHASH,
          keccak256(encodePacked(["bytes32[]"], [tokenPermissionHashes])),
          arbiter,
          permit.nonce,
          permit.deadline,
          mandateHash,
        ],
      ),
    );
  }
  const structHash = hashPermit2(
    BigInt((preparedTransaction.data as IntentData).intentRoute.intentOp.nonce),
    BigInt(
      (preparedTransaction.data as IntentData).intentRoute.intentOp.expires,
    ),
    (preparedTransaction.data as IntentData).intentRoute.intentOp.elements[0]
      .arbiter,
    (preparedTransaction.data as IntentData).intentRoute.intentOp.elements[0],
  );
  const PERMIT2_DOMAIN_NAME_HASH =
    "0x9ac997416e8ff9d2ff6bebeb7149f65cdae5e32e2b90440b566bb3044041d36a";
  function getPermit2DomainSeparator(chainId: number): any {
    return {
      nameHash: PERMIT2_DOMAIN_NAME_HASH,
      chainId,
      verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3",
    };
  }
  const permit2DomainSeparator = getPermit2DomainSeparator(
    Number(
      (preparedTransaction.data as IntentData).intentRoute.intentOp.elements[0]
        .chainId,
    ),
  );
  const DOMAIN_TYPEHASH_SANS_VERSION =
    "0x8cad95687ba82c2ce50e74f7b754645e5117c3a5bec8151c0726d5857980a866";
  function hashEIP712DomainSeparatorSansVersion(domain: any): Hex {
    const { nameHash, chainId, verifyingContract } = domain;
    return keccak256(
      encodeAbiParameters(
        [
          { name: "typehash", type: "bytes32" },
          { name: "name", type: "bytes32" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        [
          DOMAIN_TYPEHASH_SANS_VERSION,
          nameHash,
          BigInt(chainId),
          verifyingContract,
        ],
      ),
    );
  }
  const TYPE_HASH_PREFIX = "\x19\x01";
  function hashTypedData(domain: any, structHash: Hex): Hex {
    let domainSeparator: Hex;

    if ("chainId" in domain && "versionHash" in domain) {
      domainSeparator = "0x";
    } else if ("chainId" in domain && !("versionHash" in domain)) {
      domainSeparator = hashEIP712DomainSeparatorSansVersion(domain);
    } else if ("versionHash" in domain && !("chainId" in domain)) {
      domainSeparator = "0x";
    } else {
      throw new Error();
    }

    return keccak256(
      encodePacked(
        ["string", "bytes32", "bytes32"],
        [TYPE_HASH_PREFIX, domainSeparator, structHash],
      ),
    );
  }
  const digest = hashTypedData(permit2DomainSeparator, structHash);

  const { r, s, recovery } = secp256k1.sign(
    (digest as Hex).slice(2),
    (process.env.OWNER_PRIVATE_KEY as Hex).slice(2),
    {
      lowS: true,
    },
  );
  const sig = {
    r: numberToHex(r, { size: 32 }),
    s: numberToHex(s, { size: 32 }),
    v: recovery ? 28n : 27n,
    yParity: recovery,
  };
  const signature = serializeSignature({ ...sig });
  const formattedSig = encodePacked(
    ["address", "bytes"],
    [zeroAddress, signature],
  );
  const signedTransaction = { ...preparedTransaction, signature: formattedSig };
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

      (simulationResult as any).label = bundleLabel;

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
      (result as any).label = bundleLabel;
      console.dir(result, { depth: null });
    } catch (error: any) {
      console.error(
        `${ts()} Bundle ${bundleLabel}: Submission/Execution failed`,
        error?.response?.data ?? error,
      );
    }
  }
};
