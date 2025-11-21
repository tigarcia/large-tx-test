import {
  PublicKey,
  Transaction,
  SystemProgram,
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  SendTransactionError,
} from "@solana/web3.js";


// NOTE: This implementation is taken from the solana-web3.js source code.

/**
 * Determines the length of the compact u16 encoding for the number of signatures.
 * @param count The number of signatures in the transaction.
 * @returns The number of bytes required for the encoding (1, 2, or 3).
 */
export function getSignatureCountLength(count: number): number {
  if (count < 0x80) {
    // 1-byte encoding: 0xxxxxxx
    return 1;
  }
  if (count < 0x4000) {
    // 2-byte encoding: 1xxxxxxx 0xxxxxxx
    return 2;
  }
  // 3-byte encoding: 1xxxxxxx 1xxxxxxx 0xxxxxxx
  return 3;
}

/**
 * Writes the compact u16 length of a count into the provided buffer.
 * This is used for encoding the signature count in the transaction wire format.
 * @param count The count (number of signatures) to encode.
 * @param array The destination buffer (Uint8Array or Buffer) to write the encoded length to.
 * @param offset The starting position in the buffer to write the length.
 * @returns The number of bytes written to the buffer (1, 2, or 3).
 */
export function encodeLength(
  count: number,
  array: Uint8Array,
  offset: number
): number {
  let rem_len = count;
  let len = 0;

  // Continue looping until all bits of the count are encoded (rem_len === 0)
  for (;;) {
    let elem = rem_len & 0x7f; // Get the lowest 7 bits
    rem_len >>= 7; // Shift the count to process the next 7 bits

    // If there are more bits remaining, set the continuation flag (0x80)
    if (rem_len !== 0) {
      elem |= 0x80;
    }

    // Write the byte and advance the offset
    array[offset + len] = elem;
    len++;

    // Break the loop if there are no more bits left to encode
    if (rem_len === 0) {
      break;
    }
  }

  return len;
}

function customSerializeTransaction(tx: Transaction): Buffer {
  // NOTE: You MUST ensure tx.compileMessage(), getSignatureCountLength(),
  // and encodeLength() are available or correctly implemented.
  // These are internal helper functions in web3.js.

  const message = tx.compileMessage();

  // Assuming the transaction is already fully signed

  const serializedMessage = message.serialize();

  const signatureCount = tx.signatures.length;

  // --- START: Core Serialization Logic (Keep this) ---
  const signatureCountLength = getSignatureCountLength(signatureCount);
  const serializedSignaturesLength = signatureCountLength + signatureCount * 64;
  const transactionSize = serializedSignaturesLength + serializedMessage.length;

  // 🛑 REMOVE THIS SIZE CHECK 🛑
  /*
  if (transactionSize > 1232) {
      throw new Error(
          `Transaction is too large: ${transactionSize} bytes (max: 1232 bytes)`
      );
  }
  */
  // 🛑 END REMOVE 🛑

  const wireTransaction = Buffer.alloc(transactionSize);
  let offset = 0;

  // Write the signature count (compact u16)
  offset += encodeLength(tx.signatures.length, wireTransaction, offset);

  // Write all 64-byte signatures
  for (const signature of tx.signatures) {
      if (!signature.signature) {
          throw new Error('Transaction must be fully signed before serialization');
      }
      wireTransaction.set(signature.signature, offset);
      offset += 64;
  }

  // Write the serialized message data
  wireTransaction.set(serializedMessage, offset);

  return wireTransaction;
  // --- END: Core Serialization Logic (Keep this) ---
}

export async function generateRawTransactions(
  batchSize: number,
  fundingWallet: Keypair,
  destinationWallet: PublicKey,
  connection: Connection
): Promise<Buffer[]> { // 👈 Change return type to an array of raw buffers
  let rawPaymentBatches: Buffer[] = [];

  let allInstructions: any[] = [];
  const fromPubkey = fundingWallet.publicKey;
  // 1. Create all instructions
  for (let i = 0; i < batchSize; i++) {
    allInstructions.push(
      SystemProgram.transfer({
        fromPubkey: fromPubkey,
        toPubkey: destinationWallet,
        lamports: 10_000,
      })
    );
  }

  // Get the latest blockhash
  const { blockhash } = await connection.getLatestBlockhash();

  const numTransactions = Math.ceil(allInstructions.length / batchSize);
  for (let i = 0; i < numTransactions; i++) {
    let tx = new Transaction();
    let lowerIndex = i * batchSize;
    let upperIndex = (i + 1) * batchSize;

    // 2. Add instructions to the Transaction object
    for (let j = lowerIndex; j < upperIndex; j++) {
      if (allInstructions[j]) {
        tx.add(allInstructions[j]);
      }
    }

    // Set the recent blockhash (required before signing)
    tx.recentBlockhash = blockhash;

    // 3. Sign the transaction (Crucial step before custom serialization!)
    // The transaction MUST be signed here before you serialize it.
    // This signature will be part of the final buffer.
    tx.sign(fundingWallet);

    // 4. Use YOUR custom serialization function
    const rawTxBuffer = customSerializeTransaction(tx);
    rawPaymentBatches.push(rawTxBuffer);
  }

  return rawPaymentBatches;
}

/**
 * Create the Solana transactions to be executed on chain
 *
 * @param batchSize The number of transfer instructions per TX
 * @param payments A list of pubkeys and lamport amounts to be paid
 * @param fundingWallet The pubkey of the wallet that will be used for funding
 *                      the payments
 * @returns A list of transactions
 */
export function generateTransactions(
  batchSize: number,
  fundingWallet: PublicKey,
  destinationWallet: PublicKey
): Transaction[] {
  let paymentBatches: Transaction[] = [];

  let allInstructions: any[] = [];
  for (let i = 0; i < batchSize; i++) {
    allInstructions.push(
      SystemProgram.transfer({
        fromPubkey: fundingWallet,
        toPubkey: destinationWallet,
        lamports: 10_000,
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
 * Execute a list of raw transaction buffers on chain
 *
 * @param connection The connection for which the tx's will be executed
 * @param rawTransactionList A list of raw transaction buffers to be executed
 * @returns An array of transaction signatures
 */
export async function executeRawTransactions(
  connection: Connection,
  rawTransactionList: Buffer[]
): Promise<PromiseSettledResult<string>[]> {
  const TX_INTERVAL = 3500;
  let staggeredTransactions: Promise<string>[] = rawTransactionList.map(
    (rawTransaction, i) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          return sendRawTransactionWithRetry(
            connection,
            rawTransaction
          ).then(resolve);
        }, i * TX_INTERVAL);
      });
    }
  );
  return await Promise.allSettled(staggeredTransactions);
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
 * Sends a raw transaction buffer and retries `retries` times
 *
 * @param connection
 * @param rawTransaction The raw transaction buffer
 * @param retries The number of times to retry the transaction. Default is 5. If the transaction fails after `retries` attempts, an Error is thrown.
 */
async function sendRawTransactionWithRetry(
  connection: Connection,
  rawTransaction: Buffer,
  retries: number = 5
): Promise<string> {
  let i = 0;
  while (i < retries) {
    let signature = "";
    try {
      // Send the raw transaction directly
      signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');
      return signature;
    } catch (err) {
      if (err instanceof SendTransactionError) {
        throw err;
      } else {
        throw err;
      }
      i++;
    }
  }
  throw new Error(`Failed to send transaction after ${retries} attempts`);
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
