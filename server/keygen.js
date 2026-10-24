// Prints a new Solana keypair for the treasury. Put the secret in Railway → Variables as TREASURY_SECRET.
import { newKeypair } from "./lib/solana.js";
const k = newKeypair();
console.log("address:", k.address);
console.log("TREASURY_SECRET=" + k.secret);
