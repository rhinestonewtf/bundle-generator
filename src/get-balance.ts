import { Account, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RhinestoneSDK } from "@rhinestone/sdk";
import { config } from "dotenv";
import { getChainById } from "./utils/chains.js";
import { formatUnits } from "viem";
import { getEnvironment } from "./utils/environments.js";
import { select } from "@inquirer/prompts";

config();

export const main = async () => {
  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex,
  );

  const environmentString = await select({
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

  const environment = getEnvironment(environmentString);
  const orchestratorUrl = environment.url;
  const rhinestoneApiKey = environment.apiKey;

  // create the rhinestone account instance
  const rhinestone = new RhinestoneSDK({
    apiKey: rhinestoneApiKey,
    endpointUrl: orchestratorUrl,
    useDevContracts: environmentString !== "prod",
  });
  const rhinestoneAccount = await rhinestone.createAccount({
    owners: {
      type: "ecdsa" as const,
      accounts: [owner],
    },
  });

  const address = rhinestoneAccount.getAddress();
  console.log(`Account: ${address}\n`);

  console.log("Portfolio (via Rhinestone SDK):");
  const isDevMode = process.env.DEV_CONTRACTS === "true";
  const portfolio = await rhinestoneAccount.getPortfolio(isDevMode);

  if (portfolio.length === 0) {
    console.log("   No tokens found in portfolio");
  } else {
    portfolio.forEach((token) => {
      const totalBalance = token.balances.locked + token.balances.unlocked;
      const formattedBalance = formatUnits(totalBalance, token.decimals);
      console.log(
        `   ${token.symbol}: ${formattedBalance} (${token.chains.length} chains)`,
      );

      token.chains.forEach((chain) => {
        const chainBalance = chain.locked + chain.unlocked;
        const chainFormatted = formatUnits(chainBalance, token.decimals);
        const chainInfo = getChainById(chain.chain);
        const chainName = chainInfo?.name || `Chain ${chain.chain}`;
        if (chainBalance > 0n) {
          console.log(`     └─ ${chainName}: ${chainFormatted}`);
        }
      });
    });
  }
};

main().catch(console.error);
