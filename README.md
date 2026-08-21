# SolPoker

Real-time on-chain Texas Hold'em on Solana. Built on MagicBlock Ephemeral Rollups for
sub-second play, with Private Ephemeral Rollups (Intel TDX) for hole-card secrecy.

Chips are bought with SOL and sold back for SOL at a fixed rate, backed one to one by a
program vault. The house takes 2.5% of a pot that sees a flop, capped at three big
blinds; a hand won before the flop is never raked. Devnet only, so the SOL involved is test currency; see TRUST_MODEL.md for
what would have to change before that could ever be otherwise.

## Status

All seven phases are done. Hands play end to end on a devnet rollup with **hidden hole
cards**, a **verifiable shuffle**, a **turn clock that survives disconnects**, and a web
client where a whole hand runs without a single wallet prompt.

Measured on devnet:

| Check | Result |
| --- | --- |
| Deck read by the table creator, a seated player, an outsider | denied to all three |
| Your own hole cards | allowed |
| An opponent's hole cards | denied |
| Base layer during a live hand | no card data |
| Base layer after the hand | no unrevealed cards |
| Published history reproduces the deal | verified |
| 100-hand session, 6 seats, 141 forced timeouts | 0 stalls, chips conserved |
| Two clients playing a hand through the web app | settled, verified, chips conserved |
| Shuffle seed readable during a live hand | no, it lives on the private deck |
| Undelegating mid-hand to expose cards | refused by the program |
| Two browsers, two wallets, a real hand through the UI | passes |

See [SPEC.md](SPEC.md) for the phase plan, [TRUST_MODEL.md](TRUST_MODEL.md) for what is
and is not guaranteed, and [DECISIONS.md](DECISIONS.md) for the decision log.

## Why this design

On-chain poker has three hard problems:

| Problem | Why it is hard | What we do |
| --- | --- | --- |
| Hidden cards | All Solana account data is world-readable | Card PDAs delegated to a TEE validator, gated by `EphemeralPermission` |
| Real-time play | 400ms blocks and a wallet popup per action | Ephemeral Rollup plus session keys |
| Fair shuffle | Clock and slot seeds are trivially biased | VRF combined with per-player commit-reveal salts |

Mental poker is the cryptographically pure answer to the first problem, and it is why no
on-chain poker product has shipped at scale. Every card reveal needs a multi-party
decryption round trip, and a player who disconnects mid-hand takes their key share with
them, so the hand stalls. Making the enclave the dealer turns a disconnect into an
ordinary auto-fold. That is what makes this buildable.

## Trust model

**This is not trustless.** It trusts Intel TDX and MagicBlock's TEE validator.

Three things follow from that and are enforced rather than assumed. The board's
seed and raw VRF output live on the deck, the one account nobody can read, until
settlement publishes them for the verifier: the board is a deterministic function
of that seed, so a readable seed mid-hand would be the whole board in advance.
The hole cards come from a **second, independent VRF draw that is never
published at all**, which is what keeps a folded hand folded. And undelegation,
which permanently publishes account contents and which anyone may call, refuses
to run on a deck or a hole account that still holds cards or either seed.

The accurate claim is "provably fair shuffle, TEE-protected hole cards". Not "provably
fair hole cards", and not "trustless". Read it precisely: the *board* is provable
by anyone, and the hole cards rest on the enclave. One draw could not do both —
proving a seed was fair means publishing it, and everything derived from it goes
public too.

One nuance worth knowing: `verifyTeeRpcIntegrity` proves you are talking to genuine TDX
hardware over a fresh challenge, but it does not check what code is running inside the
enclave. [TRUST_MODEL.md](TRUST_MODEL.md) covers this and the rest in full.

## Verifying a hand yourself

Every hand publishes the board's VRF output, each player's salt, their prior commitment,
and the final board seed. Recompute the board with a script that shares no code with the
program:

```bash
node tools/verify-shuffle.mjs hand-history.json
```

Players commit to a salt, everyone reveals, and only then is VRF drawn with a seed derived
from those salts. Nobody can pick a salt after seeing others, steer the draw, or re-request
until they like the answer. Rigging the deck needs the oracle and every player who
contributed a salt to collude.

The program requires two revealed salts rather than one per seated player, so a player who
does not reveal is not protected by a salt of their own. TRUST_MODEL.md explains why the
threshold is where it is and what has to happen before it moves.

## Phase 0 result

The whole design rests on one assumption: that an `EphemeralPermission` with
`is_private = true` and an empty member list makes an account readable by nobody, so the
deck is known only to program logic inside the enclave.

That is now measured rather than assumed, against two independently authenticated wallets
on devnet:

| Permission state | Account owner | Unrelated wallet |
| --- | --- | --- |
| public | reads | reads |
| private, members `[owner]` (the HoleCards shape) | reads | denied |
| private, members `[]` (the Deck shape) | denied | denied |

Denied reads come back as `null` over the authenticated TEE RPC. A fully locked account
can still be updated by the program's PDA-signed CPI, so a table can never be bricked.

## The rules engine

`crates/poker-engine` is plain deterministic Rust with no Solana dependencies, so it can
be property-tested off-chain at full speed and linked into the program unchanged.

The evaluator uses no lookup tables. The usual fast evaluators buy speed with memory (the
Two Plus Two table is around 130 MB), which does not survive a Solana compute budget. This
one works from a 13-bit rank mask and a count array; straight detection is a single
four-shift AND.

Measured inside the SBF VM on devnet:

| Operation | CU | Share of the 200k budget |
| --- | ---: | ---: |
| Evaluate one 7-card hand | 865 | 0.43% |
| Six-player showdown with side pots and payout | 7,075 | 3.54% |
| 52-card deterministic shuffle | 18,289 | 9.14% |

Showdown fits about 28 times over, so no compute budget increase is needed.

Three invariants are covered by property tests rather than examples: chips are conserved
across any legal action sequence, hand ranking is a total order matching brute-force
search over all 21 five-card subsets, and side pots always sum to contributions.

```bash
cd crates/poker-engine
cargo test                                  # 48 unit + 8 property tests
cargo run --example three_way_side_pot      # worked multi-way all-in
```

## The game on-chain

Where each account lives is the security model, not a detail:

| Account | Layer |
| --- | --- |
| `Player` (chip balance), `TableConfig` | base layer, never delegated |
| `Table`, `Seat`, `Hand`, `Deck`, `HoleCards` | delegated to the rollup |

Chips move between a player's balance and a seat stack only on the base layer, and only
while the table is undelegated. So during a hand chips move between seats but the table
total cannot change, and no rollup transaction can reach a player's balance or mint a
chip. Account ownership enforces this, not a flag that could go stale.

Betting and the per-hand salt exchange accept a session key, so a player authorises once
and then plays a whole hand with no prompt. Join, leave, buy and sell stay wallet-only,
so a leaked session key can play badly at one table and do nothing worse.

Measured over a full hand, 12 session-key actions:

| min | p50 | avg | max |
| ---: | ---: | ---: | ---: |
| 300ms | 362ms | 397ms | 689ms |

That is above the sub-100ms target. The limit is network distance, not rollup block time,
since devnet's only TEE region is in Asia. The client closes it by reading at `processed`
and rendering your action the moment you press, so the confirmation lands inside the chip
animation rather than after it.

Every hand carries a deadline, and once it passes anyone may call `force_timeout` for the
seat that owes an action. It is permissionless so the table does not depend on a
particular client or a crank staying up. A player facing no bet is checked down rather
than folded, so going absent only costs a pot they had already paid into.

That is the concrete thing mental poker cannot do. A player who vanishes takes nothing
with them, because they never held a key share.

```bash
npm install
anchor build && npm run deploy
npm run test:base           # base layer, chip conservation
npm run test:er             # one hand, privacy and shuffle verification
HANDS=100 npm run test:session   # long session with random disconnects
```

If you forked this, `npm run deploy` will not put your build at
`4f8UE9BfWnAMLpYwpxJCNFD6HEmHwNQLtmQfhKW45tZ9`. That program is owned by an
upgrade authority you do not have, so you need an id of your own:

```bash
solana-keygen new -o target/deploy/solpoker-keypair.json --force
anchor keys sync            # writes the new id into Anchor.toml and lib.rs
anchor build && npm run deploy
cp target/idl/solpoker.json app/src/lib/idl/solpoker.json
cp target/types/solpoker.ts app/src/lib/idl/solpoker.ts
```

Re-vendoring both files is not optional. The program id is baked into the IDL
twice, once as a raw byte array used to derive the delegation PDAs, and it is
deliberately not an environment variable. An id in config that disagreed with
the IDL would let tables be created and joined and then fail every attempt to
start a hand. See `app/.env.example`.

## The client

```bash
cd app
npm install
npm run dev                 # http://localhost:3000
npm test                    # engine ports, verifier, salts
npm run test:devnet         # plays a real hand on devnet through these modules
npm run test:ui             # loads every page in a browser, fails on console errors
npm run gate                # two browsers, two wallets, a real hand through the UI
```

The gate is the one that matters. Everything else passed while the table page
was rendering six empty seats to a player sitting at one, so the app is now
tested by playing it: two browsers, each with its own wallet, sit down, start a
table, play a hand, and check that each player sees their own cards and not the
other's.

There is no game server. Starting a hand, dealing, turning a street, settling and
timing out are all permissionless, so every open client watches the same state and does
whatever is next. Clients wait a moment based on where they sit, so the lowest seat
usually acts and the others step in only if it did not. Two clients that try the same
thing at once are harmless: the loser gets a specific error back and treats it as done.

Hand history is recorded by the client as it plays, because the chain does not keep it.
The accounts holding a hand's salts and seed are reused by the next hand, and only a
digest of each result reaches Solana. That digest is what ties a stored hand to something
the player did not write themselves.

## Layout

```
app/                      Next.js client
  src/lib/                connections, instructions, crank, engine ports, verifier
  src/components/         design system primitives and the table
programs/solpoker/        The game program
  src/state.rs            Account layouts
  src/bridge.rs           Accounts <-> poker-engine
  src/instructions/       player, table, delegation, hand, action, settle,
                          privacy (TEE permissions), shuffle (salts + VRF)
crates/poker-engine/      Rules engine, no Solana deps
crates/cu-bench/          Throwaway SBF program for measuring compute cost
tools/verify-shuffle.mjs  Standalone shuffle verifier, no shared code
phase0-private-counter/   TEE privacy proof, deployed on devnet
```

## Stack

Rust 1.89.0, Solana CLI 3.1.9, Anchor CLI 1.0.2, `ephemeral-rollups-sdk` 0.16.2
(features `anchor`, `access-control`, `vrf`), npm SDK 0.14.3.

Devnet TEE endpoint `https://devnet-tee.magicblock.app`, validator
`MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`.

## License

MIT

<!-- hypertribe:sponsors:start -->
## Sponsors

[![solpoker Sponsors](https://api.tribe.run/tokens/BpqaooSd9YFWfS7XkcpHzdrUr5WWES7GNiuxSoWmaCto/sponsors.svg)](https://tribe.run/token/BpqaooSd9YFWfS7XkcpHzdrUr5WWES7GNiuxSoWmaCto)

Become a sponsor on [Tribe.run](https://tribe.run/token/BpqaooSd9YFWfS7XkcpHzdrUr5WWES7GNiuxSoWmaCto).
<!-- hypertribe:sponsors:end -->
