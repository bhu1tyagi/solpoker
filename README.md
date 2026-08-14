# SolPoker

Real-time, fully on-chain Texas Hold'em on Solana — built on MagicBlock Ephemeral
Rollups for sub-second gameplay and **Private** Ephemeral Rollups (Intel TDX TEE) for
hole-card secrecy.

> **Status: Phases 0 and 1 complete.** The TEE privacy pipe is proven end to end on
> devnet, and the chain-agnostic rules engine is built and property-tested. Nothing is
> wired together yet — that starts at Phase 2. See [SPEC.md](SPEC.md) for the phase plan
> and [DECISIONS.md](DECISIONS.md) for the running decision log.

## Why this architecture

On-chain poker has three hard problems. All Solana account data is world-readable, so
hole cards can't just live in a PDA. Poker needs sub-second actions and turn clocks,
which base-layer Solana can't give you without a wallet popup per action. And the
shuffle must be verifiable, so no clock- or slot-derived seed will do.

The answers here are, respectively: card accounts delegated to a TEE validator and gated
by per-player `EphemeralPermission`; an Ephemeral Rollup with session keys; and
MagicBlock VRF combined with per-player commit-reveal salts.

### Why a TEE instead of mental poker

Mental poker (threshold ElGamal with ZK shuffle proofs) is the cryptographically pure
answer, and it's also why no on-chain poker product has shipped at scale. Every card
reveal needs a multi-party decryption round-trip, and if a player disconnects mid-hand
their key share is needed to continue — so the hand **stalls**.

Making the enclave the dealer turns a disconnect into an ordinary auto-fold. That single
property is what makes this buildable.

## Trust model — read this before believing anything

**This is not trustless.** It trusts Intel TDX and MagicBlock's TEE validator.

The accurate claim is *"provably fair shuffle, TEE-protected hole cards"* — not
"provably fair hole cards", and not "trustless". One nuance already surfaced in Phase 0:
`verifyTeeRpcIntegrity` proves you are talking to genuine TDX hardware over a fresh
challenge, but it does **not** verify which code is running inside the enclave. A full
`TRUST_MODEL.md` lands in Phase 4.

**Chips are play-money only** — non-purchasable and non-redeemable, with no path between
real value and chips in either direction.

## Phase 0 result

The whole design rests on one assumption: that an `EphemeralPermission` with
`is_private = true` and an **empty** member list makes an account readable by nobody,
so the shuffled deck is known only to program logic inside the enclave.

That is now measured, not assumed. Against two independently authenticated wallets on
devnet TEE:

| Permission state | Account owner | Unrelated wallet |
| --- | --- | --- |
| public | reads | reads |
| private, members `[owner]` — the **HoleCards** model | reads | **denied** |
| private, members `[]` — the **Deck** model | **denied** | **denied** |

Denied reads return `null` over the authenticated TEE RPC. Crucially, the program's
PDA-signed CPI can still update a fully-locked permission, so a table can never be
bricked — verified by flipping privacy back off after total lockdown.

## The rules engine

`crates/poker-engine` is plain deterministic Rust with **no Solana dependencies**, so
it can be property-tested and fuzzed off-chain at full speed and then linked into the
program unchanged. Its types mirror the on-chain account layouts, so no conversion
layer is needed.

The hand evaluator uses **no lookup tables**. The usual fast evaluators buy speed with
memory — the Two Plus Two table is ~130 MB — which is a non-starter on chain. This one
derives every category from a 13-bit rank mask and a count array using bit tricks;
straight detection is a single four-shift AND.

Measured on devnet inside the SBF VM:

| Operation | CU | Share of the 200,000 default budget |
| --- | ---: | ---: |
| Evaluate one 7-card hand | 865 | 0.43% |
| Six-player showdown, side pots and payout included | 7,075 | 3.54% |
| 52-card deterministic shuffle | 18,289 | 9.14% |

Showdown settlement fits about 28 times over, so no compute budget increase is needed.

Three invariants are enforced by property tests rather than examples: chips are
conserved across any legal action sequence, hand ranking is a total order that agrees
with brute-force search over all 21 five-card subsets, and side pots always sum to
total contributions.

```bash
cd crates/poker-engine
cargo test                                  # 48 unit + 8 property tests
cargo run --example three_way_side_pot      # worked multi-way all-in
```

## Repo layout

```
crates/poker-engine/      Chain-agnostic rules engine (Phase 1)
  src/card.rs             Card encoding, deck, deterministic shuffle
  src/eval.rs             Table-free 7-card evaluator
  src/betting.rs          Betting state machine and legal-action rules
  src/pots.rs             Main and side pot construction and payout
crates/cu-bench/          Throwaway SBF program that measures on-chain CU
phase0-private-counter/   Phase 0 TEE proof (deployed on devnet)
  programs/               Anchor program: delegation + permission lifecycle
  tests/                  Adversarial two-wallet privacy tests
SPEC.md                   Full build spec and phase gates
DECISIONS.md              Every non-obvious choice, with rejected alternatives
```

## Running the Phase 0 proof

Requires Rust 1.89.0, Solana CLI 3.1.9, Anchor CLI 1.0.2, and a funded devnet wallet at
`~/.config/solana/id.json`.

```bash
cd phase0-private-counter
npm install
anchor build
npm run deploy
npm test
```

The test suite is idempotent — re-running it reuses the existing delegation.

## Stack

| Component | Version |
| --- | --- |
| Rust | 1.89.0 |
| Solana CLI | 3.1.9 |
| Anchor CLI | 1.0.2 |
| `ephemeral-rollups-sdk` (Rust) | 0.16.2 — features `anchor`, `access-control` |
| `@magicblock-labs/ephemeral-rollups-sdk` (npm) | 0.14.3 |

Devnet TEE endpoint `https://devnet-tee.magicblock.app`, validator identity
`MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`.

## License

MIT
