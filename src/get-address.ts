import { Account, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRhinestoneAccount } from "@rhinestone/sdk";
import { config } from "dotenv";
import { select } from "@inquirer/prompts";
import { getEnvironment } from "./utils/environments";

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
  const rhinestoneAccount = await createRhinestoneAccount({
    owners: {
      type: "ecdsa" as const,
      accounts: [owner],
    },
    rhinestoneApiKey,
    orchestratorUrl,
  });

  const address = await rhinestoneAccount.getAddress();
  console.log(`Account address: ${address}`);
};

main();
