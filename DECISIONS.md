# DECISIONS

Running log of non-obvious choices, the reasoning, and the alternative rejected.
Newest phase last.

---

## Phase 0 — Scaffold and prove the pipe

### D0.1 — Toolchain: Anchor installed via `cargo install anchor-cli`, not `avm`

**Chose:** `cargo install anchor-cli --version 1.0.2 --locked`.

**Why:** The documented path (`cargo install --git https://github.com/coral-xyz/anchor avm`)
fails on the spec's pinned Rust 1.89.0 — avm's git HEAD pulls `cargo-platform@0.3.3`,
which requires rustc 1.91. Installing `avm` from crates.io is not an option either:
the `avm` name on crates.io is an unrelated 2016 package (max version 1.0.1), not
Anchor's version manager.

**Rejected:** Upgrading to Rust 1.91 to satisfy avm. That would silently drift from the
spec's pinned 1.89.0 for the actual program build, and the pin is what the MagicBlock
examples are verified against. Installing the CLI directly keeps Rust at 1.89.0.

**Consequence:** No `avm use` to switch Anchor versions later. If a future phase needs a
different Anchor, reinstall `anchor-cli` at that version.

### D0.2 — Base-layer RPC is `rpc.magicblock.app/devnet`, not `api.devnet.solana.com`

**Chose:** `https://rpc.magicblock.app/devnet` as the base-layer endpoint.

**Why:** SPEC.md §2 lists `api.devnet.solana.com`, but the MagicBlock dev skill's
`resources.md` specifies `rpc.magicblock.app/devnet` for devnet base-layer work.
Practically decisive: `api.devnet.solana.com` airdrops were rate-limited to complete
failure, while the MagicBlock RPC funded the wallet on the first try. Per spec rule 2,
docs win over the spec.

**Rejected:** Fighting the public faucet. Both endpoints serve the same devnet cluster, so
there is no correctness difference — only reliability.

### D0.3 — Phase 0 proof lives in its own workspace, not in `programs/solpoker`

**Chose:** `phase0-private-counter/` as a self-contained Anchor workspace.

**Why:** The private-counter reproduction is a throwaway probe of the TEE pipe. Keeping it
separate lets `programs/solpoker` start clean in Phase 2, while the probe stays in-repo as
a regression test for the permission API across SDK upgrades.

**Rejected:** Building the probe directly into the poker program and deleting it later —
that leaves permission-flow scar tissue in the account layout we most care about.

### D0.4 — Phase 0 tests the `Deck` permission shape, which upstream never does

**Chose:** Added a `set_deck_privacy` instruction (`is_private = true`, `members = []`)
beyond the upstream example, plus a test asserting that **even the authority is denied**.

**Why:** This is the spec's own nominated riskiest assumption (§8.3). The upstream
`private-counter` only ever exercises `is_private = true` with the authority retained as a
member — the `HoleCards` shape. The `Deck` shape (empty member list) is a *different*
configuration that the example never covers, so reproducing the example alone would not
actually validate SolPoker's most important account.

The PER access-control docs state: *"If members field is set to empty list, the permissioned
account is fully restricted and private. Only the owner of permissioned account can modify
the permission."* That reads as dealer-only secrecy, but it is a documentation claim about
an untested-by-us configuration — Phase 0 turns it into an empirical result.

**Liveness note:** "Only the owner can modify" means the *permissioned account* (the PDA),
which signs via program seeds. So the program can always update the permission even when
`members = []`. We can never brick the account — the test asserts this by flipping privacy
back off after full lockdown.

### D0.5 — SDK versions: Rust 0.16.2, TypeScript 0.14.3 (intentionally mismatched)

**Chose:** Rust `ephemeral-rollups-sdk` 0.16.2 with features `["anchor", "access-control"]`;
npm `@magicblock-labs/ephemeral-rollups-sdk` 0.14.3; npm `@coral-xyz/anchor` 0.32.1.

**Why:** These are the versions the current upstream `private-counter/anchor` example
actually pins, and the skill's guidance is to preserve a working example's version line
rather than chase latest. The npm SDK is at 0.16.2 too, but the example is verified on
0.14.3 and it exports everything we need (`getAuthToken`, `verifyTeeRpcIntegrity`,
`permissionPdaFromAccount`). The TS `@coral-xyz/anchor` client deliberately stays on 0.32.1
even though the program is built with Anchor 1.0.2 — the skill notes the IDL/client are
compatible and warns against bumping the npm package to 1.x.

**Note:** SPEC.md §2 says `ephemeral-rollups-sdk` "v0.14+"; the `access-control` feature flag
is required for the PER CPIs and is not mentioned in the spec.

**Resolved build versions:** `anchor-lang` declared as `1.0.2` resolves to **1.1.2** under
cargo's caret semantics (the upstream example behaves identically). The Anchor *CLI* is
pinned at 1.0.2. Worth knowing when reading compiler errors — the API surface in play is
1.1.2's. Concretely, `CpiContext::new` takes a `Pubkey` as its first argument in this line,
not an `AccountInfo`; passing `.to_account_info()` is a compile error.

### D0.6 — `verifyTeeRpcIntegrity` is attestation of *genuineness*, not of *code identity*

**Finding, not a choice — but it constrains what TRUST_MODEL.md may claim.**

The dev skill's `security.md` is explicit: `verifyTeeRpcIntegrity` "verifies a fresh genuine
TDX quote bound to its challenge, but it does not compare MRTD, RTMR, or configuration values
to an expected workload allowlist... do not claim that the helper proves which code is
running."

So calling it proves we are talking to a real Intel TDX enclave over a fresh challenge. It
does **not** prove that the enclave is running the MagicBlock validator build we think it is.
Establishing that requires a separate measurement-allowlist check we have not implemented.

**Consequence for Phase 4:** `TRUST_MODEL.md` must not say "attestation proves the validator
code." The honest claim is narrower: genuine TDX hardware, unverified workload identity.
Whether to add an MRTD/RTMR allowlist check is an open question to raise with the user.

### D0.7 — Spec drift: validator pinning is via `DelegateConfig`, not `remaining_accounts`

**Chose:** Pass the TEE validator as an `Option<UncheckedAccount>` in the delegate context and
forward it as `DelegateConfig { validator: ... }`.

**Why:** SPEC.md §6 says "Pin one ER validator via `remaining_accounts` in the delegate
instruction." Both the current dev-skill delegation reference and the upstream example use
`DelegateConfig` instead. Docs win.

**Still true:** the underlying intent from the spec — pin the validator explicitly, never let
it float — is correct and preserved.

### D0.8 — RESULT: the `Deck` permission model is empirically confirmed

Measured on devnet TEE (`https://devnet-tee.magicblock.app`), program
`E8bXPBMRqxoWys8TkZrAj4z4LNSkfndqGW2tgmkGZfzt`, two independently authenticated wallets:

| permission state                       | owner reads | eavesdropper reads |
| -------------------------------------- | ----------- | ------------------ |
| `is_private=false` (public)            | ALLOW       | ALLOW              |
| `is_private=true`, members=`[owner]`   | ALLOW       | **DENY**           |
| `is_private=true`, members=`[]`        | **DENY**    | **DENY**           |

Denied reads return `null` from `getAccountInfo` over the authenticated TEE RPC — not an
error, just invisibility.

**Therefore:** `HoleCards` (private + owner member) and `Deck` (private + empty members) both
behave as SPEC.md §4 assumes. No architecture change needed. The spec's nominated riskiest
assumption is resolved in its favour.

Recovery from full lockdown was also verified: with `members=[]`, the program's PDA-signed
`UpdateEphemeralPermissionCpi` still succeeds, so the table can never be bricked.

### D0.9 — CONCERN: measured ER latency is ~6x the spec's target

Measured ER action round-trip (build → sign → `sendAndConfirm` at `confirmed`), from this
machine to the devnet TEE: **min 324ms, avg ~600ms**, over two runs.

SPEC.md §5 Phase 3 targets **<100ms perceived** action latency. The raw ER block time
(10–50ms) is not the binding constraint here — network distance and confirmation wait are.
The devnet TEE region resolves to `devnet-tee-as` (Asia) per the MagicBlock status API, so a
non-Asia client pays a large RTT.

**Not resolved in Phase 0** — flagged for Phase 3. Likely levers, in order of expected effect:
send at `processed` rather than `confirmed`; optimistic client-side UI updates so perceived
latency decouples from confirmation; and checking whether a nearer TEE region exists by then
(currently `tee` is the only TEE region devnet exposes).

### D0.10 — Test runner must disable Node's native TypeScript stripping

**Chose:** run mocha as `NODE_OPTIONS=--no-experimental-strip-types mocha --require ts-node/register`.

**Why:** This machine has Node v25.2.1 (spec baseline is 24.10.0). Node 24+ strips types
natively and loads `.ts` as **ESM**, which enforces extensioned import specifiers. That breaks
`import { PrivateCounter } from "../target/types/private_counter"` — the standard Anchor-
generated import — before `ts-node` ever runs. Upstream's plain `ts-mocha` invocation fails
here for that reason.

**Rejected:** Adding `.ts` extensions to imports (diverges from Anchor's generated convention
and from every MagicBlock example), and downgrading Node to 24.10.0 (heavier, and the same
stripping behaviour exists in 24).

---

## Phase 1 — Poker engine (pure Rust)

### D1.1 — The hand evaluator uses no lookup tables at all

**Chose:** Derive every category from a 13-bit rank-occupancy mask plus a per-rank
count array, using bit tricks. Straight detection is a four-shift AND:
`s = m & (m>>1) & (m>>2) & (m>>3) & (m>>4)`, where a set bit at position `p` means a
straight with high card `p+4`.

**Why:** The fast evaluators in the literature buy speed with memory — the Two Plus
Two evaluator is a ~130 MB table, and even Cactus Kev needs perfect-hash tables. On
Solana that table has to live in the program binary and be walked with expensive
memory reads. A table-free evaluator sidesteps the problem completely.

**Measured:** 865 CU for a 7-card evaluation, 7,075 CU for a full six-player showdown
including side pots and payout. That is 3.5% of the default 200,000 CU budget, so
**no compute budget increase is needed** — the concern SPEC.md §5 raised does not
materialise.

**Rejected:** Porting Cactus Kev or 2+2. Both are faster in wall-clock terms on a
desktop, but the binary-size and memory-read cost makes them worse on chain, and
neither is needed when the budget has ~28x headroom.

### D1.2 — Hand strength is a packed `u32` so integer comparison *is* poker comparison

**Chose:** `HandRank(u32)` laid out as category in bits 23-20 and five 4-bit tiebreak
ranks below it, descending in significance.

**Why:** Comparison, tie detection, and "best hand at the table" all reduce to
ordinary integer operations. Two hands tie exactly when the integers are equal, which
is the correct Hold'em rule since suits never break ties. It also stores in two bytes
less than any struct-based alternative and needs no custom `Ord`.

### D1.3 — The all-in-for-less rule needs a per-seat `may_raise` flag, not a single "has acted" bit

**Chose:** Track `needs_action` and `may_raise` separately per seat.

**Why:** When a player shoves for more than the current bet but less than a full raise
increment, the betting is *not* reopened. Opponents who already acted still owe the
difference — so they must act again — but they may only call or fold. A single
"has acted" flag cannot express "must act, but may not raise", and collapsing the two
is the classic way this rule gets implemented wrongly. Players who had not yet acted
keep full rights, which is why the flag is per seat rather than global.

**Verified:** `all_in_for_less_than_a_full_raise_does_not_reopen_betting` asserts the
engine actually rejects the re-raise, and `a_full_reraise_restores_the_right_to_raise`
asserts the right comes back.

### D1.4 — Side pots are built level-by-level, not incrementally

**Chose:** Take every distinct contribution amount as a band boundary, then for each
band sum what each seat put into it and compute eligibility independently.

**Why:** The incremental approach — repeatedly peel off the smallest all-in and
subtract — is the common one and is where multi-way all-in bugs cluster, because the
bookkeeping of who remains eligible drifts as layers are removed. Computing each band
from the original contributions makes every layer independently checkable and makes
conservation obvious by construction.

Adjacent layers with identical eligibility are merged, so the output is the minimal
correct list. That matters for the case where a folded short stack would otherwise
create a phantom side pot nobody can win.

### D1.5 — `distribute` reports unclaimed chips instead of silently dropping them

**Chose:** Return `Distribution { payouts, unclaimed }` rather than a bare payout array.

**Why:** A property test found the case: if *every* contributor to a pot layer folded,
that layer has no eligible winner and the chips had nowhere to go. The original code
would have silently lost them in release builds, since the guard was a `debug_assert`.

The situation is unreachable in a real hand — a hand always ends with at least one
unfolded player — but "unreachable" plus "silently loses money" is exactly the
combination worth designing out. Reporting the residue lets the on-chain settle
instruction assert `unclaimed == 0` and refuse to proceed otherwise.

**Rejected:** Inventing an owner (awarding to the lowest-indexed seat, or splitting
among folded contributors). Both conserve chips but fabricate a rule that does not
exist in poker, which is worse than surfacing the anomaly.

### D1.6 — The deterministic shuffle is specified now, though the seed arrives in Phase 5

**Chose:** Fisher-Yates driven by a SHA-256 counter-mode stream — block `i` is
`SHA256(seed || i as u64 le)` — with **rejection sampling** rather than modulo to pick
each swap index.

**Why:** Phase 5 needs a public verifier that reproduces a published hand's deck from
the seed. That is only possible if the shuffle is fixed and precisely documented, so
it is pinned here rather than invented later. SHA-256 was chosen over ChaCha20 or a
small PRNG specifically because a JavaScript verifier can reproduce it with
`crypto.subtle` and no dependencies.

Rejection sampling matters for fairness, not pedantry: modulo reduction would make
some permutations very slightly likelier than others, and "the shuffle is provably
uniform" is the one genuinely provable claim this product has.

**Cost:** 18,289 CU for a 52-card shuffle, the most expensive engine operation by far
(9.1% of the default budget). Still comfortable, but it is the thing to watch if the
deal path grows.

**Open for Phase 5:** how the seed is combined (`VRF_output XOR salt_1 XOR ...`) is
the user's call and is not yet implemented.

### D1.7 — Compute units are measured on devnet, not in a simulator

**Chose:** A throwaway SBF program (`crates/cu-bench`) deployed to devnet, bracketing
work with `sol_log_compute_units()` and reading consumption from transaction logs.

**Why:** The gate asks for a CU benchmark, and native nanosecond timings do not answer
that question. Measuring on a real cluster is also a stronger claim than a simulator's
estimate. Instrumentation overhead (101 CU per reading) is measured and subtracted, so
the reported figures are engine work alone.

**Blocked:** `sol_remaining_compute_units()` — which returns the value directly and
would be tidier — **fails to link on the devnet runtime**. Deploying a program that
calls it is rejected with `ELF error: Unresolved symbol (sol_remaining_compute_units)`.
The log-based form is used instead.

**Rejected:** `litesvm` and `mollusk-svm`. Both are good tools, but they would have
required matching solana-sdk versions against the existing toolchain, and devnet was
already working.

---

## Phase 2 — Base-layer program

### D2.1 — Chip custody moves only on the base layer, only while undelegated

**Chose:** `join_table` and `leave_table` are the sole instructions that move chips
between a [`Player`] balance and a seat stack, and both are base-layer-only. The ER
never touches a player balance.

**Why:** `Player` is never delegated, so a single instruction physically cannot write
both a player balance and a delegated seat — they live on different layers. Rather than
work around that, it becomes the security model: while a hand runs on the rollup, chips
move *between seats* but the total at the table is invariant, and no rollup transaction
can reach a player's balance or mint a chip.

This is enforced by ownership rather than a flag. Delegated accounts are owned by the
delegation program on the base layer, so Anchor's owner check rejects `join_table`
outright; on the ER the same instruction fails because `Player` cannot be written there.

**Rejected:** Delegating `Player` too. That would put chip custody inside a rollup and
make the trust story much worse for no gameplay benefit.

### D2.2 — Seat creation is its own instruction, not part of `create_table`

**Chose:** `create_table` creates config/table/hand/deck; `create_seat` and `create_hole`
each create one PDA.

**Why:** Initialising all six seats alongside the table overflowed the **4KB BPF stack
frame** in Anchor's generated `try_accounts` — 4120 bytes against a 4096 limit. The
failure mode is worth recording: it does not surface as a clean error but as
`Access violation reading 8 bytes at address 0x0`, a null-pointer dereference at runtime.
The build does emit a warning, but only if you are looking for it.

**Cost:** Seven transactions to set up a table instead of one. Worth it.

---

## Phase 3 — Ephemeral Rollup, public state

### D3.1 — Delegation is split into small instructions and the validator is always pinned

**Chose:** `delegate_core` (table/hand/deck) plus `delegate_seat` per seat (seat + hole
cards together). Same split for undelegation.

**Why:** Fifteen delegated accounts in one context is far past the stack frame limit, and
smaller transactions keep each one well inside its compute budget. Seat and hole-card
accounts are delegated as a pair because they always move together.

The ER validator is passed explicitly through `DelegateConfig` on every call. Letting it
float would mean the rollup a table lands on could change between hands.

### D3.2 — Large accounts are `Box`ed to fit the stack frame

**Chose:** `Box<Account<'info, Table>>` and friends in `StartHand` and `SettleHand`.

**Why:** `Table` carries a 192-byte seat map, and with six seat accounts already in the
context these instructions overflowed the stack frame by 32 bytes. Boxing moves the
deserialised struct to the heap. This is the standard Anchor remedy and costs nothing
meaningful at runtime.

### D3.3 — Hole cards reach settlement through `remaining_accounts`

**Chose:** `settle_hand` takes the six `HoleCards` accounts as `remaining_accounts` and
re-derives each PDA to verify it.

**Why:** Six more `Account<HoleCards>` fields on a context that already holds six seats
overflows the stack frame; raw `AccountInfo`s cost almost nothing. The trade is losing
Anchor's automatic verification, which is why each account's PDA is recomputed and
checked explicitly — passing the wrong account fails rather than silently scoring the
wrong hand.

### D3.4 — Session keys cover betting actions only

**Chose:** `player_action` accepts either the player's wallet or a session key. Every
custody path — join, leave, faucet — stays wallet-only.

**Why:** A wallet popup per action is not a poker client, so the hot path needs session
keys. But the blast radius should be bounded: a leaked session key can make bad betting
decisions at the table it was scoped to, and nothing else. It cannot cash out, cannot
move chips to a balance, and cannot join another table.

Session authority is also deliberately *additional* to application authorisation. The
token proves "this key may act for this wallet on this program"; the instruction still
checks that the wallet actually occupies the seat that is to act. A valid session token
for the wrong player is worth nothing.

**Simplification worth noting:** the SPL-token delegate layer that the MagicBlock example
needs does not apply here, because chips are program state rather than tokens. Play money
makes the session-key story strictly simpler.

### D3.5 — No burn cards

**Chose:** Deal straight off the shuffled deck.

**Why:** Burning is traditional but protects against nothing when the shuffle is
committed to a published seed. Skipping it keeps the deal exactly reproducible by the
Phase 5 verifier, which is a property worth more than the tradition.

### D3.6 — MEASURED: action latency is 249-1133ms, well above the sub-100ms target

Twelve session-key-signed actions over a full hand on the devnet TEE ER:

| min | p50 | avg | max |
|----:|----:|----:|----:|
| 249ms | 324ms | 484ms | 1133ms |

This is send → `confirmed` round trip from this machine. It confirms
[D0.9](#d09--concern-measured-er-latency-is-6x-the-specs-target): the binding constraint
is network distance, not ER block time — devnet's only TEE region is in Asia.

**Not addressed in Phase 3.** The levers remain what Phase 0 identified: send at
`processed` instead of `confirmed`, and decouple perceived latency from confirmation with
optimistic client-side updates. A poker client can render an action the instant it is
signed and reconcile on confirmation, which is what the sub-100ms *perceived* target
actually asks for. Neither is a program change, so both belong with the Phase 7 frontend.

### D3.7 — `Hand::dealt_in` bitmask so dealing does not need the seat accounts

**Chose:** Store which seats are in the hand as a `u8` bitmask on `Hand`.

**Why:** `deal_hole_cards` needs to know who is in the hand, but loading six seat accounts
alongside six hole-card accounts blows the stack frame. The bitmask carries exactly the
needed information in one byte.

### D3.8 — Test harness must check `confirmTransaction` for errors

**Finding, not a choice, but it cost real debugging time.**

`connection.confirmTransaction` resolves successfully for transactions that *failed*. With
`skipPreflight: true`, a broken instruction looks exactly like a working one: the test
loop spun 23 times calling `advance_street` against a hand that had never started, and the
logs showed nothing wrong.

The harness now checks `conf.value.err` and pulls the program logs on failure. The actual
bug was mundane once visible — a transient devnet `Blockhash not found` had aborted setup
partway through, so seat 4 was never created — but it was invisible until the harness
stopped hiding it. Base-layer setup calls now retry through transient RPC failures and
assert every account exists before the ER tests begin.

### D3.9 — Deploy operations reclaim orphaned buffers

**Worth recording because it silently ate ~10 SOL.**

Each failed `anchor deploy` leaves a buffer account holding the full rent for the program
binary (~4.9 SOL at 705KB). They are not cleaned up automatically. `solana program show
--buffers` lists them and `solana program close <address>` refunds the rent.

Growing the program past its allocation also needs `solana program extend` first;
otherwise deploy fails with `ProgramData account not large enough`.

**Rejected:** `opt-level = "z"` to shrink the binary. It did cut 705KB to 537KB, but
introduced >4KB stack frames inside `sha2`'s `crypto-common` dependency. Shipping a
program with stack-overflow-capable code to save rent is a bad trade.

**Open optimisation:** replacing the software SHA-256 in the shuffle with Solana's
`sha256` syscall would remove the `sha2` crate from the binary entirely, cut the shuffle's
18,289 CU substantially, and eliminate those stack frames. It needs `poker-engine`'s
shuffle to become generic over its hash function so the crate stays Solana-free. Not done;
worth doing before mainnet.
