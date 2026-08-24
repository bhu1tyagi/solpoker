#!/usr/bin/env node
/**
 * Does USDC custody actually work, and does the allowlist actually hold?
 *
 * Six checks against a live cluster, in the order they matter:
 *   1. a buy moves exactly chips x rate, wallet -> vault
 *   2. the ledger credits exactly that many chips
 *   3. a sell pays exactly the same back
 *   4. a sell still works when the seller has closed their token account
 *   5. a mint we print ourselves cannot buy chips
 *   6. ...and cannot sell them either
 *
 * Five and six are the point. Opening a token account is permissionless, so
 * without the allowlist anyone could fund the vault's account for a token they
 * mint at will and cash the resulting chips out as real dollars. This proves
 * the door is shut from both sides.
 *
 *   node scripts/usdc-smoke.mjs            # devnet
 *   RPC=<url> node scripts/usdc-smoke.mjs  # anywhere else
 */
import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
} from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha256";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const P = new PublicKey("Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker");
const USDC_MINT = new PublicKey(
  /devnet|localhost/i.test(RPC)
    ? "CzZoUHtyZkarrnRbsjPVEge6UANgCYrq8Bb8ambjjTxq"
    : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);
const MICRO_USDC_PER_CHIP = 100_000;

const enc = (s) => new TextEncoder().encode(s);
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, P)[0];
const D = (name) => Buffer.from(sha256(`global:${name}`)).subarray(0, 8);
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const log = (...a) => console.log(...a);

const conn = new Connection(RPC, "confirmed");
const authority = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8")),
  ),
);

const VAULT = pda(enc("vault"));
const vaultAta = getAssociatedTokenAddressSync(USDC_MINT, VAULT, true);

const failures = [];
const check = (ok, what) => {
  log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

async function send(ixs, signers, label) {
  const tx = new Transaction().add(...ixs);
  const bh = await conn.getLatestBlockhash();
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = bh.blockhash;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize());
  const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (conf.value.err) throw new Error(`${label}: ${JSON.stringify(conf.value.err)}`);
  return sig;
}

/** The token balance at an address, where "no account" reads as zero. */
async function tokenAmount(ata) {
  const info = await conn.getAccountInfo(ata);
  return info ? Number(info.data.readBigUInt64LE(64)) : 0;
}

async function chipsOf(owner) {
  const info = await conn.getAccountInfo(pda(enc("player"), owner.toBuffer()));
  return info ? Number(info.data.readBigUInt64LE(40)) : 0;
}

/** Buy or sell, with whichever mint we are testing. */
function tradeIx(kind, owner, mint, chips) {
  return new TransactionInstruction({
    programId: P,
    keys: [
      { pubkey: pda(enc("player"), owner.toBuffer()), isSigner: false, isWritable: true },
      { pubkey: VAULT, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(mint, VAULT, true), isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(mint, owner), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([D(kind === "buy" ? "buy_chips" : "sell_chips"), u64(chips)]),
  });
}

async function main() {
  log(`=== USDC SMOKE — ${RPC} ===`);
  log(`mint ${USDC_MINT.toBase58()}`);
  log(`vault ata ${vaultAta.toBase58()}\n`);

  // A fresh player each run, so nothing depends on leftover state.
  const player = Keypair.generate();
  const playerAta = getAssociatedTokenAddressSync(USDC_MINT, player.publicKey);
  const CHIPS = 100;
  const COST = CHIPS * MICRO_USDC_PER_CHIP;

  log("0. funding a fresh player with SOL for fees and $20 of test USDC");
  await send(
    [
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: player.publicKey,
        lamports: 0.05e9,
      }),
      createAssociatedTokenAccountIdempotentInstruction(
        authority.publicKey,
        playerAta,
        player.publicKey,
        USDC_MINT,
      ),
      createMintToInstruction(USDC_MINT, playerAta, authority.publicKey, 20 * 1e6),
    ],
    [authority],
    "fund",
  );
  log(`  ${player.publicKey.toBase58().slice(0, 8)} funded\n`);

  log("1. buy 100 chips for $10");
  const walletBefore = await tokenAmount(playerAta);
  const vaultBefore = await tokenAmount(vaultAta);
  await send(
    [
      new TransactionInstruction({
        programId: P,
        keys: [
          { pubkey: pda(enc("player"), player.publicKey.toBuffer()), isSigner: false, isWritable: true },
          { pubkey: player.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: D("init_player"),
      }),
      tradeIx("buy", player.publicKey, USDC_MINT, CHIPS),
    ],
    [player],
    "buy",
  );
  const walletAfter = await tokenAmount(playerAta);
  const vaultAfter = await tokenAmount(vaultAta);
  check(walletBefore - walletAfter === COST, `the wallet paid exactly $${COST / 1e6} (paid $${(walletBefore - walletAfter) / 1e6})`);
  check(vaultAfter - vaultBefore === COST, `the vault received exactly $${COST / 1e6} (received $${(vaultAfter - vaultBefore) / 1e6})`);
  check((await chipsOf(player.publicKey)) === CHIPS, `the ledger credited ${CHIPS} chips`);

  log("\n2. sell 40 chips back");
  const sellBefore = await tokenAmount(playerAta);
  await send([tradeIx("sell", player.publicKey, USDC_MINT, 40)], [player], "sell");
  const sellAfter = await tokenAmount(playerAta);
  check(
    sellAfter - sellBefore === 40 * MICRO_USDC_PER_CHIP,
    `the wallet was paid exactly $4 (received $${(sellAfter - sellBefore) / 1e6})`,
  );
  check((await chipsOf(player.publicKey)) === CHIPS - 40, "the ledger debited 40 chips");

  log("\n3. sell with the token account closed — cashing out must not depend on keeping one open");
  // A token account can only be closed at zero, so park the float with the
  // authority first. That also makes the balance check below unambiguous:
  // whatever the account holds afterwards came from the sale.
  await send(
    [
      createAssociatedTokenAccountIdempotentInstruction(
        player.publicKey,
        getAssociatedTokenAddressSync(USDC_MINT, authority.publicKey),
        authority.publicKey,
        USDC_MINT,
      ),
      createTransferCheckedInstruction(
        playerAta,
        USDC_MINT,
        getAssociatedTokenAddressSync(USDC_MINT, authority.publicKey),
        player.publicKey,
        await tokenAmount(playerAta),
        6,
      ),
      createCloseAccountInstruction(playerAta, player.publicKey, player.publicKey),
    ],
    [player],
    "close ata",
  );
  check((await conn.getAccountInfo(playerAta)) === null, "the seller's token account is gone");
  await send([tradeIx("sell", player.publicKey, USDC_MINT, 60)], [player], "sell after close");
  check(
    (await tokenAmount(playerAta)) === 60 * MICRO_USDC_PER_CHIP,
    "the account was recreated and paid $6",
  );
  check((await chipsOf(player.publicKey)) === 0, "the ledger is back to zero chips");

  log("\n4. the attack: a mint we print ourselves");
  const junk = Keypair.generate();
  const junkAta = getAssociatedTokenAddressSync(junk.publicKey, player.publicKey);
  const junkVaultAta = getAssociatedTokenAddressSync(junk.publicKey, VAULT, true);
  await send(
    [
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: junk.publicKey,
        space: MINT_SIZE,
        lamports: await getMinimumBalanceForRentExemptMint(conn),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(junk.publicKey, 6, authority.publicKey, null),
      // Both accounts, created permissionlessly, exactly as an attacker would.
      createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, junkAta, player.publicKey, junk.publicKey),
      createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, junkVaultAta, VAULT, junk.publicKey),
      createMintToInstruction(junk.publicKey, junkAta, authority.publicKey, 1_000 * 1e6),
    ],
    [authority, junk],
    "junk mint",
  );
  log(`  printed 1,000 worthless tokens and opened the vault's account for them`);

  let boughtWithJunk = false;
  try {
    await send([tradeIx("buy", player.publicKey, junk.publicKey, 100)], [player], "junk buy");
    boughtWithJunk = true;
  } catch (e) {
    check(/6045|WrongMint|custom program error/i.test(String(e)), "buying with a printed mint is refused");
  }
  if (boughtWithJunk) check(false, "buying with a printed mint is refused — IT WAS NOT");

  let soldForJunk = false;
  try {
    await send([tradeIx("sell", player.publicKey, junk.publicKey, 1)], [player], "junk sell");
    soldForJunk = true;
  } catch (e) {
    check(/6045|WrongMint|InsufficientChips|custom program error/i.test(String(e)), "selling against a printed mint is refused");
  }
  if (soldForJunk) check(false, "selling against a printed mint is refused — IT WAS NOT");

  log("\n5. returning the float");
  const left = await tokenAmount(playerAta);
  if ((await conn.getAccountInfo(playerAta)) !== null) {
    const home = getAssociatedTokenAddressSync(USDC_MINT, authority.publicKey);
    const ixs = [
      createAssociatedTokenAccountIdempotentInstruction(
        player.publicKey,
        home,
        authority.publicKey,
        USDC_MINT,
      ),
    ];
    // Empty it before closing it: the token program refuses to close an
    // account that still holds anything.
    if (left > 0) {
      ixs.push(
        createTransferCheckedInstruction(playerAta, USDC_MINT, home, player.publicKey, left, 6),
      );
    }
    ixs.push(createCloseAccountInstruction(playerAta, authority.publicKey, player.publicKey));
    await send(ixs, [player], "return");
    log(`  returned $${(left / 1e6).toFixed(2)} and closed the account`);
  }
  const dust = await conn.getBalance(player.publicKey);
  if (dust > 5000) {
    await send(
      [
        SystemProgram.transfer({
          fromPubkey: player.publicKey,
          toPubkey: authority.publicKey,
          lamports: dust - 5000,
        }),
      ],
      [player],
      "dust",
    );
  }
  log("  test wallet drained");

  log(
    failures.length === 0
      ? `\nSMOKE PASSED: all checks green`
      : `\nSMOKE FAILED: ${failures.length} check(s)\n  - ${failures.join("\n  - ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE DIED:", e.message ?? e);
  process.exit(1);
});
