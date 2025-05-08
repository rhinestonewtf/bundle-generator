import { Account, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChain } from "./utils/chains.js";
import { getSmartAccount } from "./account.js";
import { config } from "dotenv";

config();

export const main = async () => {
  const owner: Account = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY! as Hex,
  );
  const targetChain = getChain("Base");
  const targetSmartAccount = await getSmartAccount({
    chain: targetChain,
    owner,
  });

  console.log(`Account address: ${targetSmartAccount.account.address}`);
};

main();
