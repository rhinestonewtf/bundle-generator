import { checkbox, input, confirm, select } from "@inquirer/prompts";
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Intent } from "./types";
import * as fs from "fs";

export const collectUserInput = async (): Promise<{ intent: Intent; saveAsFileName?: string }> => {
  const targetChain = await select({
    message: "Select a target chain",
    choices: [
      {
        name: "Ethereum",
        value: "Ethereum",
      },
      {
        name: "Base",
        value: "Base",
      },
      {
        name: "Arbitrum",
        value: "Arbitrum",
      },
      {
        name: "Optimism",
        value: "Optimism",
      },
      {
        name: "Polygon",
        value: "Polygon",
        disabled: "(polygon available soon)",
      },
    ],
  });

  const targetTokens = await checkbox({
    message: "Select tokens to transfer on the target chain",
    choices: [
      { name: "ETH", value: "ETH" },
      { name: "WETH", value: "WETH" },
      { name: "USDC", value: "USDC" },
    ],
    required: true,
  });

  const formattedTargetTokens = targetTokens.map((symbol) => {
    return {
      symbol,
      amount: "0",
    };
  });

  for (const token of formattedTargetTokens) {
    const amount = await input({
      message: `Amount of ${token.symbol}`,
    });
    token.amount = amount;
  }

  const sourceChains = await checkbox({
    message: "Select source chains (optional)",
    choices: [
      { name: "Ethereum", value: "Ethereum" },
      { name: "Base", value: "Base" },
      { name: "Arbitrum", value: "Arbitrum" },
      { name: "Optimism", value: "Optimism" },
      {
        name: "Polygon",
        value: "Polygon",
        disabled: "(polygon available soon)",
      },
    ],
  });

  const sourceTokens = await checkbox({
    message: "Select source tokens to use (optional)",
    choices: [
      { name: "ETH", value: "ETH" },
      { name: "WETH", value: "WETH" },
      { name: "USDC", value: "USDC" },
    ],
  });

  let tokenRecipient = await input({
    message:
      "Recipient address for tokens on the target chain",
      default: process.env.DEFAULT_TOKEN_RECIPIENT ?? privateKeyToAccount(
        process.env.DEPLOYMENT_PRIVATE_KEY! as Hex,
      ).address
  });

  const chainsPart = sourceChains.map(chain => chain.slice(0, 3)).join(',');
  const tokensPart = sourceTokens.join(',');
  const targetPart = targetChain.slice(0, 3);
  const symbolsPart = formattedTargetTokens.map(token => token.symbol).join(',');
  const amountsPart = formattedTargetTokens.map(token => token.amount).join(',');
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 13);

  const filename = await input({
    message: "Enter the .json filename to save the intent to, or 'no' / 'n' to not save\n(Note: You can continually add more intents to an existing file)",
    default: `${chainsPart}.${tokensPart} > ${targetPart}.${symbolsPart} ${amountsPart} ${timestamp}`
  });

  const sanitizedFilename = filename.replace(/\.json$/, '')
  const saveAsFileName = `${sanitizedFilename}.json`;
  
  return {
    intent: {
      targetChain,
      targetTokens: formattedTargetTokens,
      sourceChains,
      sourceTokens,
      tokenRecipient,
    },
    saveAsFileName,
  };
};

export const showUserAccount = async (address: string) => {
  console.log(
    `To use your account, you'll need to fund it on the relevant source chain(s). Your account address is ${address}`,
  );
  await confirm({ message: "Continue?" });
};

export const getReplayParams = async () => {
  const isAll = await select({
    message: "Do you want to replay all intents?",
    choices: [
      { name: "Yes", value: true },
      { name: "No", value: false },
    ],
  });

  let intentsToReplay: string[] = [];
  if (!isAll) {
    intentsToReplay = await checkbox({
      message: "Select intents to replay",
      choices: fs
        .readdirSync("intents")
        .filter((file) => file.endsWith(".json"))
        .map((file) => ({
          name: file,
          value: file,
        })),
    });
  }

  const isSequential = await select({
    message: "Do you want to replay intents in sequence?",
    choices: [
      { name: "Yes", value: true },
      { name: "No", value: false },
    ],
  });

  return {
    isAll,
    intentsToReplay,
    isSequential,
  };
};
