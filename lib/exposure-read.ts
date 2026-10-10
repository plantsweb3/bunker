/** Reads what one wallet holds, for the exposure check. Public chain data
 * only: a balance, the wallet's token accounts under both token programs,
 * and the mints of its Token-2022 balances.
 *
 * It lives here, outside any page, so that the website's check and the
 * browser extension's check are the same code. What the numbers mean is
 * decided in sdk/exposure.ts; this only fetches. */
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@/sdk/classic-token";
import {
  Exposure,
  ParsedTokenInfo,
  permanentDelegate,
  RAW_TOKEN_BYTES,
  rawTokenInfo,
  TOKEN_2022_PROGRAM_ID,
  summarizeExposure,
} from "@/sdk/exposure";
/** How many Token-2022 mints are looked up for issuer powers (100 per request). */
const MINT_LOOKUPS = 300;
/** The wallet has more token accounts than can be read even in brief. */
export class TooLarge extends Error {}

export async function readExposure(connection: Connection, owner: PublicKey): Promise<Exposure> {
  const tooLarge = (e: unknown) => /502|too large/i.test(e instanceof Error ? e.message : "");
  // Fully parsed first. A wallet with thousands of token accounts is too
  // large to read that way, so it is read again as the first bytes of each
  // account, which is enough to count and classify but not to show amounts.
  const rows = (program: PublicKey) =>
    connection
      .getParsedTokenAccountsByOwner(owner, { programId: program })
      .then((r) =>
        r.value.map((t) => ({
          account: t.pubkey.toBase58(),
          info: t.account.data.parsed?.info as ParsedTokenInfo,
        })),
      )
      .catch(async (e) => {
        if (!tooLarge(e)) throw e;
        const raw = await connection
          .getTokenAccountsByOwner(owner, { programId: program }, {
            dataSlice: { offset: 0, length: RAW_TOKEN_BYTES },
          } as Parameters<typeof connection.getTokenAccountsByOwner>[2])
          .catch((again) => {
            throw tooLarge(again) ? new TooLarge() : again;
          });
        return raw.value.flatMap((t) => {
          const info = rawTokenInfo(t.account.data, (b) => new PublicKey(b).toBase58());
          return info ? [{ account: t.pubkey.toBase58(), info: info as ParsedTokenInfo }] : [];
        });
      });
  const [lamports, classic, token2022] = await Promise.all([
    connection.getBalance(owner),
    rows(TOKEN_PROGRAM_ID),
    rows(new PublicKey(TOKEN_2022_PROGRAM_ID)),
  ]);
  // Token-2022 lets an issuer keep the power to move holders' tokens. That
  // is recorded on the mint, so the mints of the balances held are read.
  const mints = [
    ...new Set(token2022.filter((t) => /^[1-9]/.test(t.info?.tokenAmount?.amount ?? "")).map((t) => t.info.mint)),
  ].slice(0, MINT_LOOKUPS);
  const issuers = new Map<string, string>();
  for (let i = 0; i < mints.length; i += 100) {
    const batch = mints.slice(i, i + 100);
    const found = await connection.getMultipleParsedAccounts(batch.map((m) => new PublicKey(m)));
    found.value.forEach((account, at) => {
      const data = account?.data;
      const delegate = data && "parsed" in data ? permanentDelegate(data.parsed?.info) : null;
      if (delegate) issuers.set(batch[at], delegate);
    });
  }
  return summarizeExposure(lamports, classic, token2022, issuers);
}
