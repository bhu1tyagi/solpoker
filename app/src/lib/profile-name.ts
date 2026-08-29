/**
 * What a player is called, and the message they sign to claim it.
 *
 * Shared by the client that builds the message and the server that rebuilds
 * it. Both sides MUST agree byte for byte — the server verifies a signature
 * over a message it reconstructs from the parts, so a client that formats it
 * differently produces a signature that verifies against nothing.
 *
 * A display name is a label on top of a wallet, never a replacement for it.
 * Names are not unique and every surface that shows one shows the address
 * beside it. Uniqueness would turn names into land to be grabbed, and a name
 * standing alone would let anyone call themselves the treasury.
 */

export const NAME_MAX = 24;

/** C0 and C7 control characters, including the newline. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
/** Bidirectional overrides and isolates. */
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
/** Zero-width and other invisible formatting characters. */
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/;

/**
 * The name as it will be stored, or a reason it cannot be.
 *
 * The newline ban is the security-critical rule and not a formatting
 * preference. The signing message below is line-oriented, so a name
 * containing a newline could render in the wallet's approval dialog as though
 * it were another field — a player asked to sign "Name: bob" would be shown
 * something that reads like a different, larger claim.
 *
 * The other two bans are impersonation defences. A bidirectional override can
 * make a name render as text it does not contain, and a zero-width character
 * makes two visibly identical names different strings, which is how one
 * player passes for another in a list.
 */
export function checkName(raw: string): { name: string } | { problem: string } {
  const name = raw.trim();
  if (name.length === 0) return { problem: "A name needs at least one character." };
  if (name.length > NAME_MAX) {
    return { problem: `Names stop at ${NAME_MAX} characters.` };
  }
  if (CONTROL.test(name)) {
    return { problem: "Line breaks and control characters are not allowed." };
  }
  if (BIDI.test(name)) {
    return { problem: "Text-direction characters are not allowed." };
  }
  if (INVISIBLE.test(name)) {
    return { problem: "Invisible characters are not allowed." };
  }
  return { name };
}

/** How long a signed name change stays good for. */
export const NAME_SIGNATURE_TTL_MS = 10 * 60 * 1000;

/**
 * The exact text the wallet signs.
 *
 * Written to be readable in an approval dialog, because that dialog is the
 * only thing standing between a player and signing something they did not
 * mean to. It names the action, the wallet, and the value, and says plainly
 * that no money moves — a wallet popup full of opaque bytes teaches players to
 * approve without reading, and that habit is what gets them drained somewhere
 * else later.
 */
export function nameMessage(wallet: string, name: string, issuedAt: number): string {
  return [
    "Pokerable — set display name",
    "",
    `Wallet: ${wallet}`,
    `Name: ${name}`,
    `Issued: ${new Date(issuedAt).toISOString()}`,
    "",
    "Signing this changes only what you are called. It moves no chips.",
  ].join("\n");
}
