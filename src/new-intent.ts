import { config } from "dotenv";
config();

import { Account, Hex } from "viem";
import { collectUserInput, showUserAccount } from "./cli.js";
import { privateKeyToAccount } from "viem/accounts";
import { getChain } from "./utils/chains.js";
import { getSmartAccount } from "./account.js";
import { processIntent } from "./main.js";
import * as fs from "fs";
import * as path from "path";


export const main = async () => {
  const { intent, saveAsFileName } = await collectUserInput();

  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex,
  );
  const targetChain = getChain(intent.targetChain);
  const targetSmartAccount = await getSmartAccount({
    chain: targetChain,
    owner,
  });

  await showUserAccount(targetSmartAccount.account.address);

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
    fs.writeFileSync(filePath, JSON.stringify({ intentList: existingData }, null, 2));
  }

  await processIntent(intent);
};

main();
