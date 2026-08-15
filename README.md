# SolPoker

Real-time on-chain Texas Hold'em on Solana. Built on MagicBlock Ephemeral Rollups for
sub-second play, with Private Ephemeral Rollups (Intel TDX) for hole-card secrecy.

Play money only. Chips come from a faucet and there is no path from real value to chips
or back.

## Status

Phases 0 to 6 are done. Hands play end to end on a devnet rollup with **hidden hole
cards**, a **verifiable shuffle**, a **turn clock that survives disconnects**, and betting
actions signed by session keys instead of a wallet prompt per action.

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

Still to do: the frontend (Phase 7).

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

The accurate claim is "provably fair shuffle, TEE-protected hole cards". Not "provably
fair hole cards", and not "trustless".

One nuance worth knowing: `verifyTeeRpcIntegrity` proves you are talking to genuine TDX
hardware over a fresh challenge, but it does not check what code is running inside the
enclave. [TRUST_MODEL.md](TRUST_MODEL.md) covers this and the rest in full.

## Verifying a hand yourself

Every hand publishes the VRF output, each player's salt, their prior commitment, and the
final seed. Recompute the deck with a script that shares no code with the program:

```bash
node tools/verify-shuffle.mjs hand-history.json
```

Players commit to a salt, everyone reveals, and only then is VRF drawn with a seed derived
from those salts. Nobody can pick a salt after seeing others, steer the draw, or re-request
until they like the answer. Rigging the deck needs the oracle and every seated player to
collude.

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

Betting actions accept a session key, so a player authorises once and then folds, calls
and raises with no prompt. Join, leave and faucet stay wallet-only, so a leaked session
key can play badly at one table and do nothing worse.

Measured over a full hand, 12 session-key actions:

| min | p50 | avg | max |
| ---: | ---: | ---: | ---: |
| 300ms | 362ms | 397ms | 689ms |

That is above the sub-100ms target. The limit is network distance, not rollup block time,
since devnet's only TEE region is in Asia. Closing it is client-side work (optimistic
updates, `processed` commitment) rather than a program change.

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

## Layout

```
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
