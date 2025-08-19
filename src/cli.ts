import { checkbox, input, confirm, select } from "@inquirer/prompts";
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Intent } from "./types.js";
import * as fs from "fs";
import path from "path";

export const collectUserInput = async (): Promise<{
  intent: Intent;
  saveAsFileName?: string;
  simulate?: boolean;
}> => {
  const simulate =
    process.argv.includes("--simulate") || process.argv.includes("-s");
  const isDevMode = process.env.DEV_CONTRACTS === "true";
  const isTestnetMode = process.env.TESTNET_MODE === "true";
  const useTestnetNetworks = isDevMode || isTestnetMode;

  const getModeLabel = () => {
    if (isDevMode) return " (dev contracts + testnet)";
    if (isTestnetMode) return " (testnet mode)";
    return "";
  };

  const targetChain = await select({
    message: `Select a target chain${getModeLabel()}`,
    choices: [
      {
        name: useTestnetNetworks ? "Ethereum (Sepolia)" : "Ethereum",
        value: "Ethereum",
      },
      {
        name: useTestnetNetworks ? "Base (Base Sepolia)" : "Base",
        value: "Base",
      },
      {
        name: useTestnetNetworks ? "Arbitrum (Arbitrum Sepolia)" : "Arbitrum",
        value: "Arbitrum",
      },
      {
        name: useTestnetNetworks ? "Optimism (OP Sepolia)" : "Optimism",
        value: "Optimism",
      },
      {
        name: useTestnetNetworks ? "ZkSync (Sepolia fallback)" : "ZkSync",
        value: "ZkSync",
      },
      {
        name: useTestnetNetworks ? "Polygon (Sepolia fallback)" : "Polygon",
        value: "Polygon",
      },
    ],
  });

  const targetTokens = await checkbox({
    message: "Select tokens to transfer on the target chain",
    choices: [
      { name: "ETH", value: "ETH" },
      { name: "WETH", value: "WETH" },
      { name: "USDC", value: "USDC" },
      { name: "USDT", value: "USDT" },
    ],
    validate: (choices) => {
      if (
        targetChain === "Polygon" &&
        choices.some(({ value }) => value === "ETH")
      ) {
        return "ETH is not acceptable for Polygon target";
      }

      return true;
    },
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
    message: `Select source chains (optional)${getModeLabel()}`,
    choices: [
      {
        name: useTestnetNetworks ? "Ethereum (Sepolia)" : "Ethereum",
        value: "Ethereum",
      },
      { name: useTestnetNetworks ? "Base (Base Sepolia)" : "Base", value: "Base" },
      {
        name: useTestnetNetworks ? "Arbitrum (Arbitrum Sepolia)" : "Arbitrum",
        value: "Arbitrum",
      },
      {
        name: useTestnetNetworks ? "Optimism (OP Sepolia)" : "Optimism",
        value: "Optimism",
      },
      {
        name: useTestnetNetworks ? "Polygon (Sepolia fallback)" : "Polygon",
        value: "Polygon",
      },
    ],
  });

  const sourceTokens = await checkbox({
    message: "Select source tokens to use (optional)",
    choices: [
      { name: "ETH", value: "ETH" },
      { name: "WETH", value: "WETH" },
      { name: "USDC", value: "USDC" },
      { name: "USDT", value: "USDT" },
    ],
    validate: (choices) => {
      if (
        sourceChains.length === 1 &&
        sourceChains[0] === "Polygon" &&
        choices.some(({ value }) => value === "ETH")
      ) {
        return "Polygon being the only sorce and having ETH as a token is not valid";
      }

      return true;
    },
  });

  let tokenRecipient = await input({
    message: "Recipient address for tokens on the target chain",
    default:
      process.env.DEFAULT_TOKEN_RECIPIENT ??
      privateKeyToAccount(process.env.DEPLOYMENT_PRIVATE_KEY! as Hex).address,
  });

  const sourceAssets = sourceChains
    .map((chain) => {
      const chainPrefix = chain.slice(0, 3).toLowerCase();
      const filteredTokens =
        chain === "Polygon"
          ? sourceTokens.filter((token) => token !== "ETH")
          : sourceTokens;
      return `${chainPrefix}.${filteredTokens.join(`, ${chainPrefix}.`)}`;
    })
    .join(", ");
  const targetAssets = `${formattedTargetTokens
    .map((token) => `${targetChain.slice(0, 3).toLowerCase()}.${token.symbol}`)
    .join(",")}`;
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 13);

  const filename = await input({
    message:
      "Enter the .json filename to save the intent to, or 'no' / 'n' to not save\n(Note: You can continually add more intents to an existing file)",
    default: `${sourceAssets} to ${targetAssets} ${timestamp}`,
  });

  const sanitizedFilename = filename.replace(/\.json$/, "");
  const saveAsFileName = `${sanitizedFilename}.json`;

  if (simulate) {
    console.log(
      "Simulation mode enabled - transaction will be simulated but not executed"
    );
  }

  return {
    intent: {
      targetChain,
      targetTokens: formattedTargetTokens,
      sourceChains,
      sourceTokens,
      tokenRecipient,
    },
    saveAsFileName,
    simulate,
  };
};

export const showUserAccount = async (address: string) => {
  console.log(
    `To use your account, you'll need to fund it on the relevant source chain(s). Your account address is ${address}`
  );
  await confirm({ message: "Continue?" });
};
export const getReplayParams = async () => {
  if (!fs.existsSync("intents")) {
    console.error("Error: 'intents' folder not found.");
    process.exit(1);
  }

  const files = fs
    .readdirSync("intents")
    .filter((file) => file.endsWith(".json"));
  const intentsList = files.map((file) => {
    const data = JSON.parse(
      fs.readFileSync(path.join("intents", file), "utf-8")
    );
    return { file, count: data.intentList ? data.intentList.length : 0 };
  });

  const autoAll = process.argv.includes("--all");

  const isAll = autoAll
    ? true
    : await select({
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
      const data = JSON.parse(
        fs.readFileSync(path.join("intents", file), "utf-8")
      );
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
    intentsToReplay = Array.from(uniqueFiles).flatMap((file) => {
      const data = JSON.parse(
        fs.readFileSync(path.join("intents", file), "utf-8")
      );
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
        message:
          "Enter milliseconds delay between each intent (default is 2500)",
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
