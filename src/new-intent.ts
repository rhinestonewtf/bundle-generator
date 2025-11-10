import { config } from "dotenv";
config();

import { Account, Hex } from "viem";
import { collectUserInput, showUserAccount } from "./cli.js";
import { privateKeyToAccount } from "viem/accounts";
import { RhinestoneSDK } from "@rhinestone/sdk";
import { processIntent } from "./main.js";
import * as fs from "fs";
import { getEnvironment } from "./utils/environments.js";

export const main = async () => {
  const {
    intent,
    saveAsFileName,
    environment: environmentString,
    executionMode,
  } = await collectUserInput();

  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex,
  );

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
  await showUserAccount(address);

  if (saveAsFileName && !saveAsFileName.match(/^(n|no)\.json$/)) {
    if (!fs.existsSync("intents")) {
      fs.mkdirSync("intents", { recursive: true });
    }
    const filePath = `intents/${saveAsFileName}`;
    let existingData = [];
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      existingData = JSON.parse(data).intentList || [];
    }
    existingData.push(intent);
    fs.writeFileSync(
      filePath,
      JSON.stringify({ intentList: existingData }, null, 2),
    );
  }

  await processIntent(intent, environmentString, executionMode);
};

main();
