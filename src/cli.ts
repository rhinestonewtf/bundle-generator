import { checkbox, input, confirm, select } from "@inquirer/prompts";
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Intent } from "./types.js";
import * as fs from "fs";
import path from "path";

export const collectUserInput = async (): Promise<{
  intent: Intent;
  saveAsFileName?: string;
  environment: string;
  executionMode: string;
}> => {
  const choices = [
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
    },
    {
      name: "Sonic",
      value: "Sonic",
    },
    {
      name: "Sepolia",
      value: "Sepolia",
    },
    {
      name: "Base Sepolia",
      value: "BaseSepolia",
    },
    {
      name: "Arbitrum Sepolia",
      value: "ArbitrumSepolia",
    },
    {
      name: "Optimism Sepolia",
      value: "OptimismSepolia",
    },
  ];

  const targetChain = await select({
    message: `Select a target chain`,
    choices,
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

      if (
        targetChain === "Sonic" &&
        choices.some(({ value }) => value !== "USDC")
      ) {
        return "Sonic just supports USDC for now";
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
    message: `Select source chains (optional)`,
    choices,
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

      if (
        sourceChains.length === 1 &&
        sourceChains[0] === "Sonic" &&
        choices.some(({ value }) => value !== "USDC")
      ) {
        return "Sonic being the only source only allows for USDC";
      }

      return true;
    },
  });

  const settlementLayers = await checkbox({
    message: "Select settlement layers to use (optional)",
    choices: [
      {
        name: "Across",
        value: "ACROSS",
      },
      {
        name: "Eco",
        value: "ECO",
      },
    ],
  });

  const sponsored = await select({
    message: "Do you want to sponsor this intent",
    choices: [
      {
        name: "Yes",
        value: true,
      },
      {
        name: "No",
        value: false,
      },
    ],
  });

  let tokenRecipient = await input({
    message: "Recipient address for tokens on the target chain",
    default:
      process.env.DEFAULT_TOKEN_RECIPIENT ??
      privateKeyToAccount(process.env.DEPLOYMENT_PRIVATE_KEY! as Hex).address,
  });

  const filterTokens = (chain: string, sourceTokens: string[]) => {
    switch (chain) {
      case "Polygon":
        return sourceTokens.filter((token) => token !== "ETH");
      case "Sonic":
        return sourceTokens.filter((token) => token === "USDC");
      default:
        return sourceTokens;
    }
  };

  const sourceAssets = sourceChains
    .map((chain) => {
      const chainPrefix = chain.slice(0, 3).toLowerCase();
      const filteredTokens = filterTokens(chain, sourceTokens);
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

  const environment = await select({
    message: "Select the environments to use",
    choices: [
      {
        name: "Prod",
        value: "prod",
      },
      {
        name: "Dev",
        value: "dev",
      },
      {
        name: "Local",
        value: "local",
      },
    ],
  });

  const executionMode = await select({
    message: "Do you want to execute the intent or simulate it?",
    choices: [
      {
        name: "Execute",
        value: "execute",
      },
      { name: "Simulate", value: "simulate" },
    ],
  });

  return {
    intent: {
      targetChain,
      targetTokens: formattedTargetTokens,
      sourceChains,
      sourceTokens,
      tokenRecipient,
      settlementLayers,
      sponsored,
    },
    saveAsFileName,
    environment,
    executionMode,
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

  const files = fs
    .readdirSync("intents")
    .filter((file) => file.endsWith(".json"));
  const intentsList = files.map((file) => {
    const data = JSON.parse(
      fs.readFileSync(path.join("intents", file), "utf-8"),
    );
    return { file, count: data.intentList ? data.intentList.length : 0 };
  });

  const args = process.argv;
  const autoAll = args.includes("--all");

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
        fs.readFileSync(path.join("intents", file), "utf-8"),
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
        fs.readFileSync(path.join("intents", file), "utf-8"),
      );
      totalIntentsSelected += data.intentList ? data.intentList.length : 0;
      return data.intentList ? [file] : [];
    });
  }

  console.log(`Total intents selected: ${totalIntentsSelected}`);

  const autoAsyncMode = args.includes("--async");
  let autoAsyncDuration;
  if (autoAsyncMode) {
    autoAsyncDuration = args[args.findIndex((arg) => arg === "--async") + 1];
  }

  let asyncMode = autoAsyncMode;
  let delay = autoAsyncDuration || "2500";
  if (totalIntentsSelected > 1 && !asyncMode) {
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

  const isEnvSet = args.includes("--env");
  let environment: string;
  if (isEnvSet) {
    environment = args[args.findIndex((arg) => arg === "--env") + 1];
  } else {
    environment = await select({
      message: "Select the environments to use",
      choices: [
        {
          name: "Prod",
          value: "prod",
        },
        {
          name: "Dev",
          value: "dev",
        },
        {
          name: "Local",
          value: "local",
        },
      ],
    });
  }

  const isExecutionModeSet = args.includes("--mode");
  let executionMode: string;
  if (isExecutionModeSet) {
    executionMode = args[args.findIndex((arg) => arg === "--mode") + 1];
  } else {
    executionMode = await select({
      message: "Do you want to execute the intent or simulate it?",
      choices: [
        {
          name: "Execute",
          value: "execute",
        },
        { name: "Simulate", value: "simulate" },
      ],
    });
  }

  return {
    isAll,
    intentsToReplay,
    asyncMode,
    msBetweenBundles: parseInt(delay, 10),
    environment,
    executionMode,
  };
};
