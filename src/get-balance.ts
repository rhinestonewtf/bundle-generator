import { Account, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRhinestoneAccount } from "@rhinestone/sdk";
import { config } from "dotenv";
import { getChainById } from "./utils/chains.js";
import { formatUnits } from "viem";

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

  const address = rhinestoneAccount.getAddress();
  console.log(`Account: ${address}\n`);

  console.log("Portfolio (via Rhinestone SDK):");
  const portfolio = await rhinestoneAccount.getPortfolio();

  if (portfolio.length === 0) {
    console.log("   No tokens found in portfolio");
  } else {
    portfolio.forEach((token) => {
      const totalBalance = token.balances.locked + token.balances.unlocked;
      const formattedBalance = formatUnits(totalBalance, token.decimals);
      console.log(
        `   ${token.symbol}: ${formattedBalance} (${token.chains.length} chains)`
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
