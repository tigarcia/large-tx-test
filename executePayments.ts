import {
  PublicKey,
  Transaction,
  SystemProgram,
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  SendTransactionError,
  TransactionInstruction,
} from "@solana/web3.js";

export function generateTransactions(
  batchSize: number,
  fundingWallet: PublicKey,
  destinationWallet: PublicKey
): Transaction[] {
  let paymentBatches: Transaction[] = [];

  let allInstructions: TransactionInstruction[] = [];
  for (let i = 0; i < batchSize * 5; i++) {
    allInstructions.push(
      SystemProgram.transfer({
        fromPubkey: fundingWallet,
        toPubkey: destinationWallet,
        lamports: 500000,
      })
    );
  }

  const numTransactions = Math.ceil(allInstructions.length / batchSize);
  for (let i = 0; i < numTransactions; i++) {
    let tx = new Transaction();
    let lowerIndex = i * batchSize;
    let upperIndex = (i + 1) * batchSize;
    for (let j = lowerIndex; j < upperIndex; j++) {
      if (allInstructions[j]) {
        tx.add(allInstructions[j]);
      }
    }
    paymentBatches.push(tx);
  }

  return paymentBatches;
}

/**
 * Execute a list of transactions on chain
 *
 * @param connection The connection for which the tx's will be executed
 * @param transactionList A list of transactions to be executed
 * @param payer The payer for the transactions
 * @returns An array of
 */
export async function executeTransactions(
  connection: Connection,
  transactionList: Transaction[],
  publicKey: PublicKey,
  secretKey: Keypair["secretKey"]
): Promise<PromiseSettledResult<string>[]> {
  const TX_INTERVAL = 3500;
  let staggeredTransactions: Promise<string>[] = transactionList.map(
    (transaction, i) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          return sendTransactionWithRetry(
            connection,
            transaction,
            publicKey,
            secretKey
          ).then(resolve);
        }, i * TX_INTERVAL);
      });
    }
  );
  return await Promise.allSettled(staggeredTransactions);
}

/**
 * Sends a transaction and retries `retries` times
 *
 * @param connection
 * @param transaction
 * @param publicKey The public key of the wallet that will be used for funding the transaction
 * @param secretKey The secret key of the wallet that will be used for funding the transaction
 * @param retries The number of times to retry the transaction. Default is 5. If the transaction fails after `retries` attempts, an Error is thrown.
 */
async function sendTransactionWithRetry(
  connection: Connection,
  transaction: Transaction,
  publicKey: PublicKey,
  secretKey: Keypair["secretKey"],
  retries: number = 5
): Promise<string> {
  let i = 0;
  while (i < retries) {
    let signature = "";
    try {
      transaction.recentBlockhash = (
        await connection.getLatestBlockhash()
      ).blockhash;

      signature = await sendAndConfirmTransaction(connection, transaction, [
        { publicKey, secretKey },
      ]);
      return signature;
    } catch (err) {
      if (err instanceof SendTransactionError) {
        // Until we're confident that the transaction failed when SendTransactionError is thrown, log a bunch of stuff and exit

        throw err;
      } else {
        // Any other type of error we're not sure what went wrong, so we don't want to retry in case the transaction actually did land
        throw err;
      }

      i++;
    }
  }
  throw new Error(`Failed to send transaction after ${retries} attempts`);
}
