import { Account, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRhinestoneAccount } from "@rhinestone/sdk";
import { config } from "dotenv";

config();

export const main = async () => {
  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex
  );

  const rhinestoneAccount = await createRhinestoneAccount({
    owners: {
      type: "ecdsa",
      accounts: [owner],
    },
    rhinestoneApiKey: process.env.ORCHESTRATOR_API_KEY!,
    useDev: process.env.DEV_CONTRACTS == "true",
  });

  const address = await rhinestoneAccount.getAddress();
  console.log(`Account address: ${address}`);
};

main();
