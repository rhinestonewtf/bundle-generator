import { Account, Hex } from "viem";
import { collectUserInput, showUserAccount } from "./cli";
import { config } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import { getChain } from "./utils/chains";
import { getSmartAccount } from "./account";
import { processIntent } from "./main";
import * as fs from "fs";
import * as path from "path";

config();

export const main = async () => {
  const intent = await collectUserInput();

  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex,
  );
  const targetChain = getChain(intent.targetChain);
  const targetSmartAccount = await getSmartAccount({
    chain: targetChain,
    owner,
  });

  await showUserAccount(targetSmartAccount.account.address);

  if (!fs.existsSync("intents")) {
    fs.mkdirSync("intents", { recursive: true });
  }

  const files = fs.readdirSync("intents");
  const sequentialFiles = files
    .filter((file) => file.endsWith(".json") && /^\d+\./.test(file))
    .map((file) => parseInt(path.basename(file, ".json"), 10))
    .filter((num) => !isNaN(num));

  const highestNumber =
    sequentialFiles.length > 0 ? Math.max(...sequentialFiles) : 0;

  fs.writeFileSync(
    `intents/${highestNumber + 1}.json`,
    JSON.stringify(intent, null, 2),
  );

  await processIntent(intent);
};

main();
