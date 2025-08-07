import { config } from "dotenv";
config();

import { Account, Hex } from "viem";
import { collectUserInput, showUserAccount } from "./cli.js";
import { privateKeyToAccount } from "viem/accounts";
import { createRhinestoneAccount } from "@rhinestone/sdk";
import { processIntent } from "./main.js";
import * as fs from "fs";

export const main = async () => {
  const { intent, saveAsFileName } = await collectUserInput();

  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex
  );

  const rhinestoneAccount = await createRhinestoneAccount({
    owners: {
      type: "ecdsa",
      accounts: [owner],
    },
    rhinestoneApiKey: process.env.ORCHESTRATOR_API_KEY!,
  });

  const address = await rhinestoneAccount.getAddress();
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
      JSON.stringify({ intentList: existingData }, null, 2)
    );
  }

  await processIntent(intent);
};

main();
