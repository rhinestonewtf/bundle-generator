#!/usr/bin/env node

import { config } from "dotenv";
config();

import { privateKeyToAccount } from "viem/accounts";
import {
  encodeFunctionData,
  erc20Abi,
  Hex,
  createPublicClient,
  http,
} from "viem";
import { createRhinestoneAccount, getTokenAddress } from "@rhinestone/sdk";
import { Account } from "viem";
import { getEnvironment } from "./utils/environments.js";
import { getChain } from "./utils/chains.js";
import { convertTokenAmount } from "./utils/tokens.js";
import { Token, TokenSymbol } from "./types.js";

// condig
const TEST_CONFIG = {
  testAmount: "0.001",
  approvalAmount: "1000",
  maxRetries: 3,
  retryDelay: 5000,
};
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

interface TestResult {
  success: boolean;
  error?: string;
  transactionHash?: string;
  intentId?: string;
  executionTime?: number;
  steps: {
    accountCreation: boolean;
    rhinestoneAccountCreation: boolean;
    balanceCheck: boolean;
    allowanceCheck: boolean;
    approval?: boolean;
    transaction: boolean;
  };
}

class EoaPermit2Tester {
  private account!: Account;
  private rhinestoneAccount: any;
  private environment: any;
  private targetChain: any;
  private publicClient: any;
  private testResult: TestResult;

  constructor(environmentString: string = "dev") {
    this.testResult = {
      success: false,
      steps: {
        accountCreation: false,
        rhinestoneAccountCreation: false,
        balanceCheck: false,
        allowanceCheck: false,
        transaction: false,
      },
    };

    // use existing environment configuration
    this.environment = getEnvironment(environmentString);
    this.targetChain = getChain("Base");
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private stringifyWithBigInt(obj: any, space = 2): string {
    return JSON.stringify(
      obj,
      (key, value) => (typeof value === "bigint" ? value.toString() : value),
      space
    );
  }

  async runTest(): Promise<TestResult> {
    const startTime = Date.now();

    try {
      console.log(
        "------------------ Starting EOA Permit2 Test... -----------"
      );
      console.log(`Environment: ${this.environment.url || "prod"}`, "info");
      console.log(
        `Target Chain: ${this.targetChain.name} (${this.targetChain.id})`,
        "info"
      );

      // Step 1: Create EOA account
      await this.createAccount();

      // Step 2: Create Rhinestone account
      await this.createRhinestoneAccount();

      // Step 3: Check balance
      await this.checkBalance();

      // Step 4: Check and handle Permit2 allowance
      await this.checkAndHandleAllowance();

      // Step 5: Execute Permit2 transaction
      await this.executeTransaction();

      this.testResult.success = true;
      this.testResult.executionTime = Date.now() - startTime;

      console.log(
        `Test completed successfully in ${this.testResult.executionTime}ms!`
      );
    } catch (error: any) {
      this.testResult.error = error.message;
      this.testResult.executionTime = Date.now() - startTime;

      console.log(`Test failed: ${error.message}`);
      console.error("Full error:", error);
    }

    return this.testResult;
  }

  private async createAccount(): Promise<void> {
    console.log("Creating EOA account...");

    // Use the same pattern as the existing codebase
    this.account = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY! as Hex);
    console.log(`EOA address: ${this.account.address}`);

    this.testResult.steps.accountCreation = true;
  }

  private async createRhinestoneAccount(): Promise<void> {
    console.log("Creating Rhinestone account with EOA configuration...");

    // Use eoa field for EOA accounts
    this.rhinestoneAccount = await createRhinestoneAccount({
      eoa: this.account,
      owners: {
        type: "ecdsa" as const,
        accounts: [this.account],
      },
      rhinestoneApiKey: this.environment.apiKey,
      orchestratorUrl: this.environment.url,
    });

    console.log(
      `Rhinestone account address: ${this.rhinestoneAccount.getAddress()}`
    );

    this.testResult.steps.rhinestoneAccountCreation = true;
  }

  private async checkBalance(): Promise<void> {
    console.log("Checking USDC balance...");

    // Use the same pattern as get-balance.ts
    const isDevMode = process.env.DEV_CONTRACTS === "true";
    const portfolio = await this.rhinestoneAccount.getPortfolio(isDevMode);
    console.log(`Portfolio: ${this.stringifyWithBigInt(portfolio)}`);

    this.testResult.steps.balanceCheck = true;
  }

  private async checkAndHandleAllowance(): Promise<void> {
    console.log("Checking Permit2 allowance...");

    // Create public client for reading contract state
    this.publicClient = createPublicClient({
      chain: this.targetChain,
      transport: http(
        `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
      ),
    });

    // Get USDC address using the SDK method
    const usdcAddress = getTokenAddress(
      "USDC" as TokenSymbol,
      this.targetChain.id
    );

    const allowance = await this.publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [this.account.address, PERMIT2_ADDRESS],
    });

    console.log(`Current Permit2 allowance: ${allowance.toString()}`);
    this.testResult.steps.allowanceCheck = true;

    // If allowance is 0, approve Permit2
    if (allowance === 0n) {
      await this.approvePermit2(usdcAddress);
    } else {
      console.log("Sufficient Permit2 allowance found");
    }
  }

  private async approvePermit2(usdcAddress: string): Promise<void> {
    console.log("No Permit2 allowance found. Approving Permit2...");

    // Convert approval amount using the existing utility
    const approvalToken: Token = {
      symbol: "USDC",
      amount: TEST_CONFIG.approvalAmount,
    };
    const approvalAmount = convertTokenAmount({ token: approvalToken });

    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [PERMIT2_ADDRESS, approvalAmount],
    });

    try {
      // Use the same transaction flow as the existing codebase
      const calls = [{ to: usdcAddress, data: approveData, value: 0n }];
      const tokenRequests = [{
        address: usdcAddress,
        amount: approvalAmount,
      }];

      // Prepare the transaction
      console.log("Preparing approval transaction...");
      const preparedTransaction = await this.rhinestoneAccount.prepareTransaction({
        targetChain: this.targetChain,
        calls,
        tokenRequests,
        sponsored: false,
      });

      // Sign the transaction
      console.log("Signing approval transaction...");
      const signedTransaction = await this.rhinestoneAccount.signTransaction(preparedTransaction);

      // Submit the transaction
      console.log("Submitting approval transaction...");
      const transactionResult = await this.rhinestoneAccount.submitTransaction(signedTransaction);

      // Wait for execution
      console.log("Waiting for approval transaction to be mined...");
      const result = await this.rhinestoneAccount.waitForExecution(transactionResult);

      const txHash = result?.txHash ?? result?.hash ?? "";
      console.log(`Approval transaction: ${txHash}`);

      this.testResult.steps.approval = true;
    } catch (error: any) {
      throw new Error(`Approval failed: ${error.message}`);
    }
  }

  private async executeTransaction(): Promise<void> {
    console.log("Executing EOA Permit2 transaction...");

    const recipient = this.account.address; // Send to self for test

    // Convert test amount using the existing utility
    const testToken: Token = { symbol: "USDC", amount: TEST_CONFIG.testAmount };
    const testAmount = convertTokenAmount({ token: testToken });

    // Get USDC address using the SDK method
    const usdcAddress = getTokenAddress(
      "USDC" as TokenSymbol,
      this.targetChain.id
    );

    const transferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, testAmount],
    });

    try {
      // Use the same transaction flow as the existing codebase
      const calls = [{ to: usdcAddress, data: transferData, value: 0n }];
      const tokenRequests = [{
        address: usdcAddress,
        amount: testAmount,
      }];

      // Prepare the transaction
      console.log("Preparing transaction...");
      const preparedTransaction = await this.rhinestoneAccount.prepareTransaction({
        targetChain: this.targetChain,
        calls,
        tokenRequests,
        sponsored: false,
      });

      // Sign the transaction
      console.log("Signing transaction...");
      const signedTransaction = await this.rhinestoneAccount.signTransaction(preparedTransaction);

      // Submit the transaction
      console.log("Submitting transaction...");
      const transactionResult = await this.rhinestoneAccount.submitTransaction(signedTransaction);

      // Wait for execution
      console.log("Waiting for execution...");
      const result = await this.rhinestoneAccount.waitForExecution(transactionResult);

      const txHash = result?.txHash ?? result?.hash ?? "";
      this.testResult.transactionHash = txHash;

      console.log("Transaction successful!");
      console.log(`Transaction hash: ${txHash}`);
      console.log(`Transaction type: ${result?.type ?? "unknown"}`);

      if (result?.type === "intent") {
        this.testResult.intentId = result.id;
        console.log(`Intent ID: ${result.id}`);
        console.log(`Target chain: ${result.targetChain}`);
      }

      this.testResult.steps.transaction = true;
    } catch (error: any) {
      throw new Error(`Transaction failed: ${error.message}`);
    }
  }

  // Utility method to run multiple test iterations
  async runMultipleTests(iterations: number = 3): Promise<TestResult[]> {
    const results: TestResult[] = [];

    console.log(`Running ${iterations} test iterations...`);

    for (let i = 1; i <= iterations; i++) {
      console.log(`\n--- Test Iteration ${i}/${iterations} ---`);

      // Reset test result for each iteration
      this.testResult = {
        success: false,
        steps: {
          accountCreation: false,
          rhinestoneAccountCreation: false,
          balanceCheck: false,
          allowanceCheck: false,
          transaction: false,
        },
      };

      const result = await this.runTest();
      results.push(result);

      // Wait between iterations (except for the last one)
      if (i < iterations) {
        console.log(`Waiting 5 seconds before next iteration...`);
        await this.sleep(5000);
      }
    }

    // Print summary
    this.printTestSummary(results);

    return results;
  }

  private printTestSummary(results: TestResult[]): void {
    console.log("\nTest Summary:");
    console.log(`Total tests run: ${results.length}`);

    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;

    console.log(`Successful: ${successful}`);
    console.log(`Failed: ${failed}`);

    if (results.length > 0) {
      const avgTime =
        results.reduce((sum, r) => sum + (r.executionTime || 0), 0) /
        results.length;
      console.log(`Average execution time: ${Math.round(avgTime)}ms`);
    }

    // Show step success rates
    const stepStats = {
      accountCreation: results.filter((r) => r.steps.accountCreation).length,
      rhinestoneAccountCreation: results.filter(
        (r) => r.steps.rhinestoneAccountCreation
      ).length,
      balanceCheck: results.filter((r) => r.steps.balanceCheck).length,
      allowanceCheck: results.filter((r) => r.steps.allowanceCheck).length,
      approval: results.filter((r) => r.steps.approval).length,
      transaction: results.filter((r) => r.steps.transaction).length,
    };

    console.log("\nStep Success Rates:");
    Object.entries(stepStats).forEach(([step, count]) => {
      const percentage = Math.round((count / results.length) * 100);
      console.log(`${step}: ${count}/${results.length} (${percentage}%)`);
    });
  }
}

// Main execution function
async function runEoaPermit2Test(environmentString: string = "dev", iterations: number = 1) {
  try {
    const tester = new EoaPermit2Tester(environmentString);

    if (iterations > 1) {
      const results = await tester.runMultipleTests(iterations);
      const allSuccessful = results.every((r) => r.success);
      process.exit(allSuccessful ? 0 : 1);
    } else {
      const result = await tester.runTest();
      process.exit(result.success ? 0 : 1);
    }
  } catch (error: any) {
    console.error(`Test execution failed: ${error.message}`);
    console.error("Full error:", error);
    process.exit(1);
  }
}

// Run the test if this file is executed directly
if (process.argv[1] && process.argv[1].endsWith("eoa-permit2-test.ts")) {
  const environment = process.argv[2] || "dev";
  const iterations = parseInt(process.argv[3]) || 1;

  runEoaPermit2Test(environment, iterations).catch((error) => {
    console.error("Test execution failed:", error?.message || error);
    process.exit(1);
  });
}

export { EoaPermit2Tester, runEoaPermit2Test };
