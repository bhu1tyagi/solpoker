# Decisions

Non-obvious choices, why, and what was rejected. Newest last.

## Phase 0: prove the TEE pipe

**Anchor via `cargo install anchor-cli`, not avm.** avm's git HEAD needs rustc 1.91 and
the spec pins 1.89.0. The `avm` name on crates.io is an unrelated 2016 package. Rejected
upgrading Rust, since the pin is what the MagicBlock examples are verified against.

**Base RPC is `rpc.magicblock.app/devnet`.** The spec says `api.devnet.solana.com`, but
the dev skill says otherwise and its faucet actually works. Same cluster either way.

**Phase 0 probe lives in its own workspace.** Keeps permission-flow scar tissue out of the
account layout we care about most.

**Tested the Deck permission shape, which upstream never does.** The upstream example only
ever runs `is_private = true` with the authority kept as a member, which is the HoleCards
shape. The Deck shape (empty members) is a different configuration nothing covered, so
reproducing the example alone would have left the most important account untested.

**Result:** measured on devnet with two authenticated wallets.

| Permission state | Owner | Other wallet |
| --- | --- | --- |
| public | reads | reads |
| private, members `[owner]` | reads | denied |
| private, members `[]` | denied | denied |

Denied reads return `null`, not an error. A fully locked permission can still be updated
by the program's PDA-signed CPI, so a table can never be bricked. Verified by flipping
privacy back off after total lockdown.

**`verifyTeeRpcIntegrity` proves hardware, not code.** It verifies a fresh genuine TDX
quote but does not compare measurements against a workload allowlist. So it cannot prove
which validator build is running. `TRUST_MODEL.md` must not claim otherwise.

**Validator pinning uses `DelegateConfig`,** not `remaining_accounts` as the spec says.
The intent (pin it, never let it float) is preserved.

**Measured ER latency was 324ms to 600ms** against a sub-100ms target. Network distance
dominates, not block time. Devnet's only TEE region is in Asia.

**Node 24+ strips types natively and loads `.ts` as ESM,** which breaks Anchor's generated
extensionless imports before ts-node sees them. Tests run with
`NODE_OPTIONS=--no-experimental-strip-types`.

## Phase 1: rules engine

**No lookup tables in the evaluator.** The fast evaluators in the literature trade memory
for speed, and the Two Plus Two table is around 130 MB. Everything here comes from a
13-bit rank mask and a count array. Straight detection is one four-shift AND. Measured 865
CU per hand and 7,075 CU for a full six-player showdown, so no compute budget bump is
needed.

**Hand strength packs into a `u32`,** category in the high bits and five 4-bit tiebreaks
below. Integer comparison is then poker comparison, and equal values are a genuine tie.
Suits never break ties, which falls out for free.

**The all-in-for-less rule needs two per-seat flags, not one.** A player who already acted
still owes the difference so must act again, but may not re-raise. A single "has acted"
bit cannot express that, and collapsing them is how this rule usually breaks.

**Side pots are built level by level** from the original contributions rather than by
peeling off the smallest all-in. The incremental approach is where multi-way all-in bugs
cluster, because eligibility drifts as layers come off.

**`distribute` reports unclaimed chips** instead of dropping them. A property test found
the case: if every contributor to a pot layer folds, that layer has no eligible winner and
chips vanished silently in release builds. Unreachable in a real hand, but unreachable
plus silently-loses-money is worth designing out. Rejected inventing an owner, since that
fabricates a rule poker does not have.

**The shuffle is pinned now** even though the seed arrives in Phase 5, because a public
verifier can only be written against a fixed construction. Fisher-Yates over a SHA-256
counter-mode stream, with rejection sampling rather than modulo so every permutation is
equally likely. SHA-256 specifically so a browser can reproduce it with no dependencies.

**Compute units measured on devnet, not in a simulator.** `sol_remaining_compute_units`
fails to link on the devnet runtime, so the log-based form is used and instrumentation
overhead is subtracted.

## Phase 2: base layer

**Chip custody moves only on the base layer, only while undelegated.** `Player` is never
delegated, so one instruction cannot write both a balance and a delegated seat. Rather
than working around that, it becomes the invariant: during a hand chips move between seats
but the table total cannot change, and no rollup transaction can reach a balance or mint a
chip. Enforced by account ownership, not a flag that could go stale.

**Seat creation is its own instruction.** Initialising six seats alongside the table
overflowed the 4KB BPF stack frame (4120 against 4096). Worth knowing the failure mode: it
surfaces as `Access violation reading 8 bytes at address 0x0`, not a clean error.

## Phase 3: rollup, public state

**Delegation is split into small instructions** and seats are delegated paired with their
hole cards. Fifteen accounts in one context is far past the stack frame limit.

**Large accounts are boxed.** `Table` carries a 192-byte seat map, and with six seats
already in context `StartHand` overflowed by 32 bytes.

**Hole cards reach settlement via `remaining_accounts`,** with each PDA re-derived and
checked. Six more `Account<HoleCards>` fields would overflow the frame; raw `AccountInfo`s
cost almost nothing. The trade is losing Anchor's automatic verification, hence the
explicit check.

**Session keys cover betting only.** A wallet popup per action is not a poker client, but
the blast radius should be bounded. A leaked session key can play badly at one table and
nothing worse, because join, leave and faucet stay wallet-only. Session authority is also
additional to application authorisation: the instruction still checks the wallet actually
holds the seat that is to act.

No SPL delegate layer is needed here, unlike the MagicBlock example, because chips are
program state rather than tokens.

**No burn cards.** Burning protects against nothing when the shuffle is committed to a
published seed, and skipping it keeps the deal reproducible by the Phase 5 verifier.

**Measured action latency: 249ms min, 324ms p50, 484ms avg, 1133ms max** over 12
session-key actions. Confirms the Phase 0 finding. The remaining levers are client-side
(`processed` commitment, optimistic updates), so they belong with the frontend.

**`confirmTransaction` resolves for failed transactions.** With `skipPreflight` a broken
instruction looks identical to a working one. The test loop spun 23 times against a hand
that had never started before the harness started checking `conf.value.err`. The actual
bug was a transient devnet `Blockhash not found` that aborted setup, leaving one seat
uncreated.

**Failed deploys leave orphaned buffer accounts** holding full program rent, around 4.9
SOL each at 705KB. `solana program show --buffers` lists them, `solana program close`
refunds. Growing past the current allocation needs `solana program extend` first.

Rejected `opt-level = "z"`: it cut 705KB to 537KB but introduced 4KB-plus stack frames
inside sha2's dependencies. Shipping stack-overflow-capable code to save rent is a bad
trade.

**Open optimisation:** using Solana's sha256 syscall instead of the software one would
drop sha2 from the binary, cut the 18,289 CU shuffle, and remove those frames. Needs the
engine's shuffle to become generic over its hash so the crate stays Solana-free.
