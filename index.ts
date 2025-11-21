import * as dotenv from "dotenv";
import { executeRawTransactions, generateRawTransactions } from "./executePayments";
import { PublicKey, Connection } from "@solana/web3.js";
import { loadKeypairFromFile } from "./utils";

// Load environment variables from .env file
dotenv.config();

// Get constants from environment variables
export const IX_BATCH_SIZE = parseInt(process.env.IX_BATCH_SIZE || "65");
export const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
export const FUNDING_WALLET_PATH = process.env.FUNDING_WALLET_PATH || "";
export const DESTINATION_WALLET_PUBKEY =
  process.env.DESTINATION_WALLET_PUBKEY || "";

async function main() {
  // Validate required environment variables
  if (!FUNDING_WALLET_PATH) {
    throw new Error("FUNDING_WALLET_PATH is required in .env file");
  }
  if (!DESTINATION_WALLET_PUBKEY) {
    throw new Error("DESTINATION_WALLET_PUBKEY is required in .env file");
  }

  const connection = new Connection(RPC_URL);
  const fundingPrivateKey = loadKeypairFromFile(FUNDING_WALLET_PATH);

  const destinationWallet = new PublicKey(DESTINATION_WALLET_PUBKEY);

  console.log(`Generating ${IX_BATCH_SIZE} transfer instructions per transaction...`);
  const rawTransactionList = await generateRawTransactions(
    IX_BATCH_SIZE,
    fundingPrivateKey,
    destinationWallet,
    connection
  );

  console.log(`Generated ${rawTransactionList.length} raw transactions`);
  console.log(`Transaction sizes: ${rawTransactionList.map(tx => tx.length)} bytes`);

  await executeRawTransactions(
    connection,
    rawTransactionList
  );
}

main();
