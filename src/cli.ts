import { checkbox, input, confirm, select } from "@inquirer/prompts";
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const collectUserInput = async () => {
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
      "Recipient address for tokens on the target chain, leave blank to use deployment account",
  });

  if (!tokenRecipient) {
    tokenRecipient = privateKeyToAccount(
      process.env.DEPLOYMENT_PRIVATE_KEY! as Hex,
    ).address;
  }

  return {
    targetChain,
    targetTokens: formattedTargetTokens,
    sourceChains,
    sourceTokens,
    tokenRecipient,
  };
};

export const showUserAccount = async (address: string) => {
  console.log(
    `To use your account, you'll need to fund it on the relevant source chain(s). Your account address is ${address}`,
  );
  await confirm({ message: "Continue?" });
};
