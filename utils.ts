import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Reads a Solana keypair from a JSON file on disk
 *
 * @param keypairPath Path to the keypair JSON file
 * @returns A Keypair instance
 * @throws Error if the file cannot be read or parsed
 */
export function loadKeypairFromFile(keypairPath: string): Keypair {
  try {
    // Resolve the path (handles both absolute and relative paths)
    const resolvedPath = path.resolve(keypairPath);

    // Read the file synchronously
    const keypairData = fs.readFileSync(resolvedPath, "utf-8");

    // Parse the JSON (Solana keypair files are JSON arrays of numbers)
    const secretKey: number[] = JSON.parse(keypairData);

    // Convert to Uint8Array
    const secretKeyUint8Array = Uint8Array.from(secretKey);

    // Create and return the Keypair
    return Keypair.fromSecretKey(secretKeyUint8Array);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to load keypair from ${keypairPath}: ${error.message}`
      );
    }
    throw error;
  }
}
