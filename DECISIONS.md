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
