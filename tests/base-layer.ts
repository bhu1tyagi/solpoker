/**
 * Phase 2 gate, base layer only, no ephemeral rollup.
 *
 * Creates a table, seats three funded players, then has them leave, asserting
 * throughout that chips are conserved. Chips only ever move between a player's
 * balance and their seat stack, so the system-wide total must never change.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { Solpoker } from "../target/types/solpoker";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { assert } from "chai";

const MAX_SEATS = 6;
const FAUCET_AMOUNT = 10_000;

const SMALL_BLIND = new BN(5);
const BIG_BLIND = new BN(10);
const MIN_BUY_IN = new BN(200);
const MAX_BUY_IN = new BN(2_000);

describe("SolPoker Phase 2, base layer", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Solpoker as Program<Solpoker>;
  const connection = provider.connection;

  // Three independent player wallets, funded with SOL for rent and fees.
  const players = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const buyIns = [new BN(500), new BN(1_000), new BN(2_000)];

  // Unique per run so repeated runs never collide on an existing table PDA.
  const tableId = new BN(Math.floor(Date.now() / 1000));

  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), tableId.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const [table] = PublicKey.findProgramAddressSync(
    [Buffer.from("table"), tableId.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const seatPdas = Array.from(
    { length: MAX_SEATS },
    (_, i) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("seat"), table.toBuffer(), Buffer.from([i])],
        program.programId,
      )[0],
  );
  const [handPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("hand"), table.toBuffer()],
    program.programId,
  );
  const [deckPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("deck"), table.toBuffer()],
    program.programId,
  );
  const playerPda = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("player"), owner.toBuffer()],
      program.programId,
    )[0];

  /** Chips in balances plus chips in seat stacks, the system-wide total. */
  async function totalChips(): Promise<number> {
    let total = 0;
    for (const p of players) {
      const acct = await program.account.player.fetch(playerPda(p.publicKey));
      total += acct.chips.toNumber();
    }
    for (const s of seatPdas) {
      const acct = await program.account.seat.fetch(s);
      total += acct.stack.toNumber();
    }
    return total;
  }

  before(async function () {
    this.timeout(180_000);
    console.log("Program:  ", program.programId.toBase58());
    console.log("Table id: ", tableId.toString());

    // Fund each player wallet with SOL for rent/fees (not chips).
    for (const p of players) {
      const sig = await connection.requestAirdrop(
        p.publicKey,
        0.05 * LAMPORTS_PER_SOL,
      );
      await connection.confirmTransaction(sig, "confirmed");
    }
  });

  it("initializes players and grants the faucet allowance", async () => {
    for (const p of players) {
      await program.methods
        .initPlayer()
        .accounts({ authority: p.publicKey })
        .signers([p])
        .rpc({ commitment: "confirmed" });

      await program.methods
        .claimFaucet()
        .accountsPartial({
          player: playerPda(p.publicKey),
          authority: p.publicKey,
        })
        .signers([p])
        .rpc({ commitment: "confirmed" });

      const acct = await program.account.player.fetch(playerPda(p.publicKey));
      assert.equal(acct.chips.toNumber(), FAUCET_AMOUNT);
      assert.isAbove(acct.lastFaucetTs.toNumber(), 0);
    }
    console.log(`  three players funded with ${FAUCET_AMOUNT} chips each`);
  });

  it("refuses a second faucet claim inside the cooldown", async () => {
    try {
      await program.methods
        .claimFaucet()
        .accountsPartial({
          player: playerPda(players[0].publicKey),
          authority: players[0].publicKey,
        })
        .signers([players[0]])
        .rpc({ commitment: "confirmed" });
      assert.fail("second claim should have been rejected");
    } catch (e: any) {
      assert.include(e.toString(), "FaucetOnCooldown");
    }
  });

  it("creates a table with six seat PDAs", async () => {
    await program.methods
      .createTable(tableId, SMALL_BLIND, BIG_BLIND, MIN_BUY_IN, MAX_BUY_IN, new BN(30))
      .accountsPartial({
        config,
        table,
        hand: handPda,
        deck: deckPda,
        creator: provider.wallet.publicKey,
      })
      .rpc({ commitment: "confirmed" });

    // Seats are created individually: doing all six alongside the table blew the
    // 4KB BPF stack frame in Anchor's generated account resolution.
    for (let i = 0; i < MAX_SEATS; i++) {
      await program.methods
        .createSeat(i)
        .accountsPartial({
          table,
          seat: seatPdas[i],
          payer: provider.wallet.publicKey,
        })
        .rpc({ commitment: "confirmed" });
    }

    const cfg = await program.account.tableConfig.fetch(config);
    assert.equal(cfg.smallBlind.toNumber(), 5);
    assert.equal(cfg.bigBlind.toNumber(), 10);
    assert.equal(cfg.maxSeats, MAX_SEATS);

    const t = await program.account.table.fetch(table);
    assert.equal(t.handNumber.toNumber(), 0);
    assert.isFalse(t.delegated);
    assert.deepEqual(Object.keys(t.state)[0], "waiting");

    for (let i = 0; i < MAX_SEATS; i++) {
      const s = await program.account.seat.fetch(seatPdas[i]);
      assert.equal(s.seatIndex, i);
      assert.equal(s.stack.toNumber(), 0);
      assert.equal(s.table.toBase58(), table.toBase58());
    }
    console.log("  table + hand + deck + 6 seat PDAs created");
  });

  it("seats three players, moving chips from balance to stack", async () => {
    const before = await totalChips();

    for (let i = 0; i < players.length; i++) {
      await program.methods
        .joinTable(i, buyIns[i])
        .accountsPartial({
          config,
          table,
          seat: seatPdas[i],
          player: playerPda(players[i].publicKey),
          authority: players[i].publicKey,
        })
        .signers([players[i]])
        .rpc({ commitment: "confirmed" });

      const seat = await program.account.seat.fetch(seatPdas[i]);
      const player = await program.account.player.fetch(
        playerPda(players[i].publicKey),
      );
      assert.equal(seat.stack.toNumber(), buyIns[i].toNumber());
      assert.equal(seat.occupant.toBase58(), players[i].publicKey.toBase58());
      assert.equal(
        player.chips.toNumber(),
        FAUCET_AMOUNT - buyIns[i].toNumber(),
        "buy-in must come out of the balance",
      );
      console.log(
        `  seat ${i}: bought in for ${buyIns[i].toString()}, ` +
          `${player.chips.toString()} left in balance`,
      );
    }

    const t = await program.account.table.fetch(table);
    assert.equal(t.seats.filter((s) => !s.equals(PublicKey.default)).length, 3);

    assert.equal(await totalChips(), before, "chips must be conserved");
  });

  it("rejects a buy-in outside the table limits", async () => {
    const p = Keypair.generate();
    const sig = await connection.requestAirdrop(
      p.publicKey,
      0.05 * LAMPORTS_PER_SOL,
    );
    await connection.confirmTransaction(sig, "confirmed");
    await program.methods
      .initPlayer()
      .accounts({ authority: p.publicKey })
      .signers([p])
      .rpc({ commitment: "confirmed" });
    await program.methods
      .claimFaucet()
      .accountsPartial({ player: playerPda(p.publicKey), authority: p.publicKey })
      .signers([p])
      .rpc({ commitment: "confirmed" });

    // Above max_buy_in.
    try {
      await program.methods
        .joinTable(3, new BN(9_000))
        .accountsPartial({
          config,
          table,
          seat: seatPdas[3],
          player: playerPda(p.publicKey),
          authority: p.publicKey,
        })
        .signers([p])
        .rpc({ commitment: "confirmed" });
      assert.fail("over-max buy-in should have been rejected");
    } catch (e: any) {
      assert.include(e.toString(), "BuyInOutOfRange");
    }
  });

  it("rejects taking an occupied seat", async () => {
    const p = Keypair.generate();
    const sig = await connection.requestAirdrop(
      p.publicKey,
      0.05 * LAMPORTS_PER_SOL,
    );
    await connection.confirmTransaction(sig, "confirmed");
    await program.methods
      .initPlayer()
      .accounts({ authority: p.publicKey })
      .signers([p])
      .rpc({ commitment: "confirmed" });
    await program.methods
      .claimFaucet()
      .accountsPartial({ player: playerPda(p.publicKey), authority: p.publicKey })
      .signers([p])
      .rpc({ commitment: "confirmed" });

    try {
      await program.methods
        .joinTable(0, new BN(500))
        .accountsPartial({
          config,
          table,
          seat: seatPdas[0],
          player: playerPda(p.publicKey),
          authority: p.publicKey,
        })
        .signers([p])
        .rpc({ commitment: "confirmed" });
      assert.fail("taking seat 0 should have been rejected");
    } catch (e: any) {
      assert.include(e.toString(), "SeatOccupied");
    }
  });

  it("rejects sitting at two seats with one wallet", async () => {
    try {
      await program.methods
        .joinTable(4, new BN(500))
        .accountsPartial({
          config,
          table,
          seat: seatPdas[4],
          player: playerPda(players[0].publicKey),
          authority: players[0].publicKey,
        })
        .signers([players[0]])
        .rpc({ commitment: "confirmed" });
      assert.fail("double-seating should have been rejected");
    } catch (e: any) {
      assert.include(e.toString(), "AlreadySeated");
    }
  });

  it("returns the full stack when players leave", async () => {
    const before = await totalChips();

    for (let i = 0; i < players.length; i++) {
      await program.methods
        .leaveTable(i)
        .accountsPartial({
          table,
          seat: seatPdas[i],
          player: playerPda(players[i].publicKey),
          authority: players[i].publicKey,
        })
        .signers([players[i]])
        .rpc({ commitment: "confirmed" });

      const seat = await program.account.seat.fetch(seatPdas[i]);
      const player = await program.account.player.fetch(
        playerPda(players[i].publicKey),
      );
      assert.equal(seat.stack.toNumber(), 0);
      assert.equal(seat.occupant.toBase58(), PublicKey.default.toBase58());
      assert.equal(
        player.chips.toNumber(),
        FAUCET_AMOUNT,
        "leaving must restore the original balance exactly",
      );
    }

    const t = await program.account.table.fetch(table);
    assert.equal(
      t.seats.filter((s) => !s.equals(PublicKey.default)).length,
      0,
      "table should be empty",
    );

    const after = await totalChips();
    assert.equal(after, before, "chips must be conserved");
    console.log(
      `  all three left; chip total unchanged at ${after} ` +
        `(3 x ${FAUCET_AMOUNT})`,
    );
  });

  it("conserves chips across the whole run", async () => {
    let sum = 0;
    for (const p of players) {
      const acct = await program.account.player.fetch(playerPda(p.publicKey));
      sum += acct.chips.toNumber();
    }
    assert.equal(
      sum,
      players.length * FAUCET_AMOUNT,
      "every chip minted by the faucet is still accounted for",
    );
    console.log(`  final: ${sum} chips across ${players.length} players`);
  });
});
