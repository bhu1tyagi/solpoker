/**
 * SolPoker Phase 0 — prove the MagicBlock Private ER (TEE) pipe.
 *
 * Beyond reproducing the upstream `private-counter` flow, this test answers the
 * one question the whole SolPoker architecture rests on:
 *
 *   Does `is_private = true` with an EMPTY member list actually block EVERY
 *   wallet — including the account's own authority — from reading ER state?
 *
 * That is the `Deck` model. If the authority can still read, the shuffled deck
 * would be readable by the table creator and the design must change.
 *
 * Read matrix this test establishes:
 *
 *   permission state                     | owner reads | eavesdropper reads
 *   -------------------------------------|-------------|-------------------
 *   public (is_private=false)            | ALLOW       | ALLOW
 *   private + members=[owner]  (HoleCards)| ALLOW       | DENY
 *   private + members=[]       (Deck)     | DENY        | DENY
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { PrivateCounter } from "../target/types/private_counter";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  GetCommitmentSignature,
  getAuthToken,
  verifyTeeRpcIntegrity,
  PERMISSION_PROGRAM_ID,
  MAGIC_PROGRAM_ID,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import * as nacl from "tweetnacl";
import { assert } from "chai";

const VAULT_ID = new web3.PublicKey(
  "MagicVau1t999999999999999999999999999999999",
);
const COUNTER_SEED = "counter";
const TEE_VALIDATOR = new web3.PublicKey(
  process.env.VALIDATOR || "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
);

/** Attempt a read of `pubkey` over `connection`; classify as allow/deny. */
async function tryRead(
  connection: anchor.web3.Connection,
  pubkey: web3.PublicKey,
): Promise<{ allowed: boolean; detail: string }> {
  try {
    const info = await connection.getAccountInfo(pubkey);
    if (info === null) {
      return { allowed: false, detail: "null (account not visible)" };
    }
    return {
      allowed: true,
      detail: `${info.data.length} bytes, owner ${info.owner.toBase58()}`,
    };
  } catch (e: any) {
    return { allowed: false, detail: `RPC error: ${e.message ?? e}` };
  }
}

describe("SolPoker Phase 0 — private counter on devnet TEE", () => {
  const baseEndpoint =
    process.env.PROVIDER_ENDPOINT || "https://rpc.magicblock.app/devnet";
  const teeUrl =
    process.env.TEE_PROVIDER_ENDPOINT || "https://devnet-tee.magicblock.app";
  const teeWsUrl =
    process.env.TEE_WS_ENDPOINT || "wss://devnet-tee.magicblock.app";
  const ephemeralRpcEndpoint = teeUrl.replace(/\/$/, "");

  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(baseEndpoint, { commitment: "confirmed" }),
    anchor.Wallet.local(),
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.PrivateCounter as Program<PrivateCounter>;
  const owner = (provider.wallet as anchor.Wallet).payer;

  // Second, unrelated wallet — the "opponent" trying to read our hole cards.
  // Generated fresh per run: it only ever signs an auth-token challenge, so it
  // needs no funding and no persistence.
  const eavesdropper = Keypair.generate();

  const [counterPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED), provider.wallet.publicKey.toBuffer()],
    program.programId,
  );
  const permissionPDA = permissionPdaFromAccount(counterPDA);

  /** ER connection authenticated as the counter's authority. */
  let ownerEr: anchor.AnchorProvider;
  /** ER connection authenticated as an unrelated wallet. */
  let eavesdropperEr: anchor.web3.Connection;

  before(async function () {
    this.timeout(120_000);
    console.log("Base Layer:     ", baseEndpoint);
    console.log("TEE ER:         ", ephemeralRpcEndpoint);
    console.log("Program ID:     ", program.programId.toBase58());
    console.log("Counter PDA:    ", counterPDA.toBase58());
    console.log("Permission PDA: ", permissionPDA.toBase58());
    console.log("Owner:          ", owner.publicKey.toBase58());
    console.log("Eavesdropper:   ", eavesdropper.publicKey.toBase58());
    console.log(
      "Owner balance:  ",
      (await provider.connection.getBalance(owner.publicKey)) /
        LAMPORTS_PER_SOL,
      "SOL",
    );

    // Spec Phase 4 requires attesting the enclave before trusting it with cards.
    // Proving it works here is part of "proving the pipe".
    await verifyTeeRpcIntegrity(ephemeralRpcEndpoint);
    console.log("TEE integrity attestation: OK");

    const ownerToken = await getAuthToken(
      ephemeralRpcEndpoint,
      owner.publicKey,
      (m: Uint8Array) => Promise.resolve(nacl.sign.detached(m, owner.secretKey)),
    );
    ownerEr = new anchor.AnchorProvider(
      new anchor.web3.Connection(`${teeUrl}?token=${ownerToken.token}`, {
        wsEndpoint: `${teeWsUrl}?token=${ownerToken.token}`,
        commitment: "confirmed",
      }),
      anchor.Wallet.local(),
    );

    const eveToken = await getAuthToken(
      ephemeralRpcEndpoint,
      eavesdropper.publicKey,
      (m: Uint8Array) =>
        Promise.resolve(nacl.sign.detached(m, eavesdropper.secretKey)),
    );
    eavesdropperEr = new anchor.web3.Connection(
      `${teeUrl}?token=${eveToken.token}`,
      { commitment: "confirmed" },
    );
    console.log("Both wallets hold valid TEE auth tokens.\n");
  });

  /** Send a transaction to the ER, signed by the owner. */
  async function sendEr(tx: web3.Transaction, label: string) {
    const start = Date.now();
    tx.feePayer = ownerEr.wallet.publicKey;
    tx.recentBlockhash = (
      await ownerEr.connection.getLatestBlockhash()
    ).blockhash;
    const signed = await ownerEr.wallet.signTransaction(tx);
    const sig = await ownerEr.sendAndConfirm(signed, [], {
      skipPreflight: true,
    });
    console.log(`  ${Date.now() - start}ms (ER) ${label}: ${sig}`);
    return sig;
  }

  it("initializes the counter on the base layer", async () => {
    const existing = await provider.connection.getAccountInfo(counterPDA);
    if (existing) {
      console.log("  counter already exists, skipping");
      return;
    }
    const tx = await program.methods
      .initialize()
      .accounts({ authority: provider.wallet.publicKey })
      .transaction();
    const sig = await provider.sendAndConfirm(tx, [owner], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log(`  (Base) initialize: ${sig}`);
  });

  it("delegates the counter to the TEE validator", async () => {
    const acct = await provider.connection.getAccountInfo(counterPDA);
    if (acct && !acct.owner.equals(program.programId)) {
      console.log("  already delegated, skipping");
      return;
    }
    const tx = await program.methods
      .delegate()
      .accountsPartial({
        authority: provider.wallet.publicKey,
        counter: counterPDA,
        validator: TEE_VALIDATOR, // pinned — never let the validator float
      })
      .transaction();
    const sig = await provider.sendAndConfirm(tx, [owner], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log(`  (Base) delegate: ${sig}`);
    await new Promise((r) => setTimeout(r, 3000)); // let delegation propagate
  });

  it("creates the ephemeral permission on the ER (public to start)", async () => {
    const tx = await program.methods
      .initPermission()
      .accountsPartial({
        authority: provider.wallet.publicKey,
        counter: counterPDA,
        permission: permissionPDA,
        magicProgram: MAGIC_PROGRAM_ID,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: VAULT_ID,
      })
      .transaction();
    await sendEr(tx, "init_permission");
  });

  it("increments on the ER and measures latency", async () => {
    const timings: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      const tx = await program.methods
        .increment()
        .accounts({ counter: counterPDA })
        .transaction();
      await sendEr(tx, `increment #${i + 1}`);
      timings.push(Date.now() - start);
    }
    console.log(
      `  ER round-trip: min ${Math.min(...timings)}ms, avg ${Math.round(
        timings.reduce((a, b) => a + b, 0) / timings.length,
      )}ms`,
    );
  });

  it("BASELINE (public): both owner and eavesdropper can read", async () => {
    const o = await tryRead(ownerEr.connection, counterPDA);
    const e = await tryRead(eavesdropperEr, counterPDA);
    console.log(`  owner:       ${o.allowed ? "ALLOW" : "DENY"} — ${o.detail}`);
    console.log(`  eavesdropper:${e.allowed ? "ALLOW" : "DENY"} — ${e.detail}`);
    assert.isTrue(o.allowed, "owner should read a public account");
    assert.isTrue(e.allowed, "eavesdropper should read a public account");
  });

  it("HOLE CARDS model (private, members=[owner]): owner ALLOW, eavesdropper DENY", async () => {
    const tx = await program.methods
      .setPrivacy(true)
      .accountsPartial({
        counter: counterPDA,
        authority: provider.wallet.publicKey,
        permission: permissionPDA,
        magicProgram: MAGIC_PROGRAM_ID,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: VAULT_ID,
      })
      .transaction();
    await sendEr(tx, "set_privacy(true)");
    await new Promise((r) => setTimeout(r, 2000));

    const o = await tryRead(ownerEr.connection, counterPDA);
    const e = await tryRead(eavesdropperEr, counterPDA);
    console.log(`  owner:       ${o.allowed ? "ALLOW" : "DENY"} — ${o.detail}`);
    console.log(`  eavesdropper:${e.allowed ? "ALLOW" : "DENY"} — ${e.detail}`);

    assert.isTrue(o.allowed, "member (card owner) must still read their cards");
    assert.isFalse(e.allowed, "OPPONENT MUST NOT READ HOLE CARDS");
  });

  it("DECK model (private, members=[]): owner DENY and eavesdropper DENY", async () => {
    const tx = await program.methods
      .setDeckPrivacy()
      .accountsPartial({
        counter: counterPDA,
        authority: provider.wallet.publicKey,
        permission: permissionPDA,
        magicProgram: MAGIC_PROGRAM_ID,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: VAULT_ID,
      })
      .transaction();
    await sendEr(tx, "set_deck_privacy()");
    await new Promise((r) => setTimeout(r, 2000));

    const o = await tryRead(ownerEr.connection, counterPDA);
    const e = await tryRead(eavesdropperEr, counterPDA);
    console.log(`  owner:       ${o.allowed ? "ALLOW" : "DENY"} — ${o.detail}`);
    console.log(`  eavesdropper:${e.allowed ? "ALLOW" : "DENY"} — ${e.detail}`);

    assert.isFalse(e.allowed, "nobody may read the deck");
    assert.isFalse(
      o.allowed,
      "EMPTY MEMBER LIST MUST LOCK OUT EVEN THE AUTHORITY — " +
        "if this fails, the Deck design must change (see SPEC.md §4)",
    );
  });

  it("recovers: program can still flip privacy back off (not locked out)", async () => {
    // Critical liveness property: even with members=[], the program's PDA-signed
    // CPI can still update the permission, so we can never brick the account.
    const tx = await program.methods
      .setPrivacy(false)
      .accountsPartial({
        counter: counterPDA,
        authority: provider.wallet.publicKey,
        permission: permissionPDA,
        magicProgram: MAGIC_PROGRAM_ID,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: VAULT_ID,
      })
      .transaction();
    await sendEr(tx, "set_privacy(false)");
    await new Promise((r) => setTimeout(r, 2000));

    const o = await tryRead(ownerEr.connection, counterPDA);
    const e = await tryRead(eavesdropperEr, counterPDA);
    console.log(`  owner:       ${o.allowed ? "ALLOW" : "DENY"} — ${o.detail}`);
    console.log(`  eavesdropper:${e.allowed ? "ALLOW" : "DENY"} — ${e.detail}`);
    assert.isTrue(o.allowed, "reads must be restorable after full lockdown");
    assert.isTrue(e.allowed, "public again means public for everyone");
  });

  it("closes the permission on the ER", async () => {
    const tx = await program.methods
      .closePermission()
      .accountsPartial({
        counter: counterPDA,
        authority: provider.wallet.publicKey,
        permission: permissionPDA,
        magicProgram: MAGIC_PROGRAM_ID,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: VAULT_ID,
      })
      .transaction();
    await sendEr(tx, "close_permission");
  });

  it("commits ER state to the base layer", async () => {
    const tx = await program.methods
      .commit()
      .accountsPartial({
        payer: ownerEr.wallet.publicKey,
        counter: counterPDA,
      })
      .transaction();
    const sig = await sendEr(tx, "commit");
    const commitSig = await GetCommitmentSignature(sig, ownerEr.connection);
    console.log(`  (Base) commitment: ${commitSig}`);
  });

  it("undelegates back to the base layer", async () => {
    const tx = await program.methods
      .undelegate()
      .accountsPartial({
        payer: ownerEr.wallet.publicKey,
        counter: counterPDA,
      })
      .transaction();
    await sendEr(tx, "undelegate");

    let retries = 20;
    while (retries-- > 0) {
      const acct = await provider.connection.getAccountInfo(counterPDA);
      if (acct?.owner.equals(program.programId)) {
        const decoded = await program.account.counter.fetch(counterPDA);
        console.log(`  undelegated. final count = ${decoded.count.toString()}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 750));
    }
    throw new Error("undelegation did not settle on the base layer");
  });
});
