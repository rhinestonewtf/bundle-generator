import { checkbox, input, confirm, select } from "@inquirer/prompts";
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Intent } from "./types.js";
import * as fs from "fs";
import path from "path";

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

  const sourceAssets = sourceChains.map(chain => `${chain.slice(0, 3).toLowerCase()}.${sourceTokens.map(token => token).join(`, ${chain.slice(0, 3).toLowerCase()}.`)}`).join(', ');
  const targetAssets = `${formattedTargetTokens.map((token) => `${targetChain.slice(0, 3).toLowerCase()}.${token.symbol}`).join(',')}`;
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 13);

  const filename = await input({
    message: "Enter the .json filename to save the intent to, or 'no' / 'n' to not save\n(Note: You can continually add more intents to an existing file)",
    default: `${sourceAssets} to ${targetAssets} ${timestamp}`
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
  if (!fs.existsSync("intents")) {
    console.error("Error: 'intents' folder not found.");
    process.exit(1);
  }

  const files = fs.readdirSync("intents").filter((file) => file.endsWith(".json"));
  const intentsList = files.map(file => {
    const data = JSON.parse(fs.readFileSync(path.join("intents", file), "utf-8"));
    return { file, count: data.intentList ? data.intentList.length : 0 };
  });

  const isAll = await select({
    message: "Do you want to replay all intents?",
    choices: [
      { name: "Yes", value: true },
      { name: "No", value: false },
    ],
  });

  let intentsToReplay: string[] = [];
  let totalIntentsSelected = 0;

  if (isAll) {
    intentsToReplay = files;
    totalIntentsSelected = files.reduce((total, file) => {
      const data = JSON.parse(fs.readFileSync(path.join("intents", file), "utf-8"));
      return total + (data.intentList ? data.intentList.length : 0);
    }, 0);
  } else {
    const selectedFiles = await checkbox({
      message: "Select intents to replay",
      choices: intentsList.map(({ file, count }) => ({
        name: `${file} (${count} intents)`,
        value: file,
      })),
    });
    const uniqueFiles = new Set(selectedFiles);
    intentsToReplay = Array.from(uniqueFiles).flatMap(file => {
      const data = JSON.parse(fs.readFileSync(path.join("intents", file), "utf-8"));
      totalIntentsSelected += data.intentList ? data.intentList.length : 0;
      return data.intentList ? [file] : [];
    });
  }

  console.log(`Total intents selected: ${totalIntentsSelected}`);

  let asyncMode = false;
  let delay = "2500";
  if (totalIntentsSelected > 1) {
    asyncMode = await select({
      message: "Do you want to replay intents in parallel / asynchronously?",
      choices: [
        { name: "Yes", value: true },
        { name: "No", value: false },
      ],
    });

    if (asyncMode) {
      delay = await input({
        message: "Enter milliseconds delay between each intent (default is 2500)",
        default: "2500",
      });
    }
  }

  return {
    isAll,
    intentsToReplay,
    asyncMode,
    msBetweenBundles: parseInt(delay, 10),
  };
};
