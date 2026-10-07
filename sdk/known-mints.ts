/** Labels keyed by mint address, never by on-chain metadata, which anyone can
 * spoof. Each address was checked on mainnet as a classic SPL mint. Anything
 * not listed here is shown by its mint only. */
export const KNOWN_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  So11111111111111111111111111111111111111112: "Wrapped SOL",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "JitoSOL",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "mSOL",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUP",
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "BONK",
};
export const mintLabel = (mint: string): string | null =>
  Object.hasOwn(KNOWN_MINTS, mint) ? KNOWN_MINTS[mint] : null;
