# SolPoker: Build Prompt for Claude Code

> Save this as `SPEC.md` in an empty repo, open Claude Code there, and say:
> **"Read SPEC.md and execute Phase 0. Stop at the Phase 0 gate and report."**
> Then advance one phase at a time. Don't let it run all phases unattended.

---

## 0. Role and operating rules

You are building a real-time, fully on-chain Texas Hold'em poker game on Solana, using MagicBlock Ephemeral Rollups for real-time execution and MagicBlock **Private** Ephemeral Rollups (Intel TDX TEE) for hole-card secrecy.

**Rules for the whole project:**

1. **Install the MagicBlock dev skill before writing any code:**
   ```bash
   npx skills add https://github.com/magicblock-labs/magicblock-dev-skill
   ```
   This gives you MagicBlock-specific patterns for delegation, Magic Actions, cranks, and VRF. Use it as your primary reference.

2. **Verify every MagicBlock API against live docs before use.** This SDK moves fast and my knowledge of it may be stale. Start by fetching `https://docs.magicblock.gg/llms.txt` for the doc index, then read the specific pages you need. If anything in this spec contradicts the current docs, **the docs win**: flag the discrepancy to me and proceed with the docs.

3. **Work in phases. Stop at every gate.** At each gate report: what works, what you verified, what you're unsure about, what's next. Don't proceed past a gate without me saying so.

4. **Test as you go.** Every phase has a definition of done that includes running tests. "It compiles" is not done.

5. **When something is genuinely ambiguous, ask.** Don't invent a design decision on the hidden-information or fund-custody paths and silently move on. Those are the two places where a wrong guess is expensive.

6. **Keep a running `DECISIONS.md`**: every non-obvious choice, the reasoning, and the alternative you rejected.

---

## 1. What we're building, and why this architecture

### The three hard problems in on-chain poker

| Problem | Naive approach | Why it fails | What we do |
|---|---|---|---|
| **Hidden information**: hole cards secret from opponents *and* from anyone reading chain state | Store cards in a PDA | All Solana account data is world-readable | Cards live in PDAs delegated to a **TEE ER validator**, gated by per-player `EphemeralPermission` |
| **Real-time**: poker needs sub-second actions and turn clocks | Base-layer Solana txs | ~400ms/block, fees, wallet popup per action | **Ephemeral Rollup** (10-50ms blocks, gasless) + session keys |
| **Verifiable shuffle**: nobody, including the operator, may know or bias deck order | `Clock` / slot hash as seed | Trivially manipulable | **MagicBlock VRF** seed XOR per-player commit-reveal salts |

### Why TEE and not mental poker

Mental poker (SRA commutative encryption, Barnett-Smart threshold ElGamal with ZK shuffle proofs) is the academically pure answer, and it's the reason no on-chain poker product has ever shipped at scale. Two killers:

- **Latency**: every card reveal needs a multi-party decryption round-trip; the ceremony scales with player count.
- **Liveness**: if a player disconnects mid-hand, their key share is needed to reveal cards. The hand **stalls**. Every real implementation bolts on timeouts and key escrow, which erodes the purity anyway.

The TEE approach makes the enclave the dealer. A disconnect becomes just an auto-fold and the hand continues. That is the single biggest reason this project is buildable at all.

**Be honest about the trust model.** This is *not* trustless. We trust Intel TDX and MagicBlock's TEE validator. You must write `TRUST_MODEL.md` (Phase 4) stating this plainly, including what an enclave compromise would expose. No UI copy may claim "trustless" or "provably fair hole cards." It's "provably fair shuffle, TEE-protected hole cards." That distinction matters.

### Hard constraint: play-money chips

**Chips are non-purchasable and non-redeemable.** No SOL/USDC buy-ins, no path from real money to chips or from chips to anything of value. Implement chips as a `u64` balance in a program-owned account with a faucet granting a fixed daily allowance.

Structure the code so a real-money variant would be a *separate, clearly-gated module*, but don't build it. If you find yourself adding a token transfer into the chip path, stop and ask me.

---

## 2. Target stack and versions

Confirm current versions against the docs; this is the documented baseline:

| Component | Version |
|---|---|
| Solana CLI | 3.1.9 |
| Rust | 1.89.0 |
| Anchor | 1.0.2 |
| Node | 24.10.0 |
| `ephemeral-rollups-sdk` | **v0.14+** (required for `CreateEphemeralPermissionCpi`) |

**Program IDs:**
- Delegation Program: `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`
- Permission Program: `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`

**Endpoints (devnet):**
- Base layer: `https://api.devnet.solana.com`
- Magic Router: `https://devnet-router.magicblock.app`
- **TEE ER: `https://devnet-tee.magicblock.app`** ← the one we need
- TEE validator identity: `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`
- Local ER: `localhost:7799`, validator `mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev`

**Reference repos to read before coding:**
- `magicblock-labs/magicblock-engine-examples`: especially `private-counter/anchor`, `magic-actions/anchor`, `delegation-actions/anchor`, `roll-dice`
- `magicblock-labs/ephemeral-rollups-sdk`
- `magicblock-labs/ephemeral-vrf`

---

## 3. Repo layout

```
solpoker/
├── SPEC.md
├── DECISIONS.md
├── TRUST_MODEL.md
├── crates/
│   └── poker-engine/          # Phase 1: pure Rust, no Solana deps
│       ├── src/
│       │   ├── card.rs        # Card encoding, deck
│       │   ├── eval.rs        # 7-card hand evaluator
│       │   ├── betting.rs     # Betting round state machine
│       │   ├── pots.rs        # Main pot + side pots
│       │   └── lib.rs
│       └── tests/
├── programs/
│   └── solpoker/              # Anchor program
│       └── src/
│           ├── lib.rs
│           ├── state/         # Table, Seat, Hand, Deck, HoleCards
│           ├── instructions/
│           │   ├── table.rs       # create, join, leave
│           │   ├── delegation.rs  # delegate, undelegate, permissions
│           │   ├── hand.rs        # start_hand, deal, advance_street
│           │   ├── action.rs      # bet/call/raise/fold/check
│           │   ├── vrf.rs         # request + callback
│           │   └── settle.rs      # showdown, payout, commit
│           └── errors.rs
├── app/                       # Next.js frontend
└── tests/                     # TS integration tests
```

---

## 4. Data model

Design this carefully, account layout is the thing that's painful to change later.

### Base layer (never delegated)
- **`Player`**: PDA seeded on wallet. Chip balance, faucet cooldown, lifetime stats.
- **`TableConfig`**: immutable table params: blinds, max seats, min/max buy-in.

### Delegated to TEE ER
- **`Table`**: seat map (`Option<Pubkey>` per seat), button position, current hand number, table state enum.
- **`Seat`** (one PDA per seat index), occupant, stack, `has_folded`, `is_all_in`, `committed_this_street`, `last_action_slot`.
- **`Hand`**: hand number, street (`PreFlop`/`Flop`/`Turn`/`River`/`Showdown`), board cards (5x`u8`, `0xFF` = undealt), pot, current bet, min raise, `to_act` seat index, action deadline.

### Delegated to TEE ER **and private**
- **`Deck`**: `[u8; 52]` shuffled order + `next_index: u8`. Permission: `is_private = true`, members = `[]`: readable by no wallet, only by program logic inside the enclave. *Verify against the access-control docs that an empty member list means "nobody"; if the semantics differ, ask me before proceeding.*
- **`HoleCards`** (one PDA per seat per hand), `[u8; 2]`. Permission: `is_private = true`, members = `[Member { pubkey: seat_occupant, flags: TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG }]`.

### The single most dangerous mistake in this project

**Never commit `Deck` or `HoleCards` to the base layer while a hand is live.** A commit writes account contents back to public Solana state, every card, visible to everyone, permanently. Enforce this structurally:

1. Maintain an explicit allowlist of committable accounts. Deck and HoleCards are never on it.
2. Zeroize both accounts at hand end *before* any undelegation path can touch them.
3. Write a test that starts a hand, forces a commit-and-undelegate, and asserts the base-layer bytes contain no card data.
4. Add a comment at every `MagicIntentBundleBuilder` call site listing what's being committed and why it's safe.

Card encoding: `u8` where `rank = card / 4` (0=Two … 12=Ace) and `suit = card % 4`. `0xFF` = none.

---

## 5. Phases

### Phase 0: Scaffold and prove the pipe
Install the dev skill. Fetch the docs index. Scaffold the Anchor workspace. Then **reproduce the `private-counter` example end to end on devnet TEE**: delegate a PDA, create an ephemeral permission, flip privacy on, confirm from a second wallet that reads are blocked, flip off, undelegate.

**Gate:** Working private counter on devnet TEE. Report the exact SDK version and any API drift vs. this spec.

> Don't skip this. If the TEE privacy path doesn't work for you, the whole architecture changes, and you want to know that on hour one, not hour twenty.

---

### Phase 1: Poker engine (pure Rust, no Solana)
Build `crates/poker-engine` as a standalone crate with zero Solana dependencies. This is chain-agnostic and by far the highest-value thing to get right.

- **7-card hand evaluator.** Compute-unit budget matters, you can't use a 130MB lookup table on-chain. Use a bitmask / prime-product approach. Benchmark CU cost and report it. If showdown evaluation exceeds budget, plan a compute budget increase and note it.
- **Betting state machine**: blinds, action order (UTG preflop, left-of-button postflop), valid action set per state, min-raise rules, all-in-for-less not reopening action.
- **Side pots**: multi-way all-ins at different stack depths. This is where most implementations have bugs.
- **Property tests** (`proptest`): chip conservation across any legal action sequence; evaluator ranking is a total order; side pots always sum to total contributions.

**Gate:** `cargo test` green including property tests. Show me the CU benchmark for showdown evaluation and a worked three-way side-pot example.

---

### Phase 2: Base-layer Anchor program
Player accounts, chip faucet, table creation, join/leave, buy-in from chip balance to seat stack. No ER yet, everything on devnet base layer.

**Gate:** TS test: create table, three players join with chips, leave and get stacks back. Chip totals conserved.

---

### Phase 3: Ephemeral Rollup integration (public state only)
Add `#[ephemeral]`, `#[delegate]`, `#[commit]` macros. Delegate `Table` + `Seat` PDAs. Run betting actions on the ER. Use `MagicIntentBundleBuilder` for commits, `commit_accounts` and `commit_and_undelegate_accounts` are deprecated.

Play a full hand with **face-up cards** (deck in a public PDA). Privacy comes next; get the real-time loop working first.

Add **session keys** so players don't get a wallet popup per action, non-negotiable for poker UX.

**Gate:** Full face-up hand played on devnet ER. Report measured action latency (target: <100ms perceived).

---

### Phase 4: Privacy (the hard part)
Move to the TEE validator. Add `Deck` and `HoleCards` with `EphemeralPermission`.

- Pre-fund PDAs at init with `ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(N) as u32)`: a delegated PDA can't be topped up the normal way later.
- Client-side: `verifyTeeRpcIntegrity()` then `getAuthToken()`, connect to `https://devnet-tee.magicblock.app?token=${token}`.
- At showdown, copy *only* the hole cards of players who reached showdown into a public `Showdown` account. Muck the rest.

**Adversarial tests, write these and make them pass:**
- Player B queries A's `HoleCards` via TEE RPC → denied.
- Unauthenticated read of `Deck` → denied.
- Base-layer `getAccountInfo` on `HoleCards` during a live hand → nothing useful.
- Post-hand base-layer state contains no unrevealed cards.

Write `TRUST_MODEL.md`.

**Gate:** All four adversarial tests pass. `TRUST_MODEL.md` written and shown to me.

---

### Phase 5: Verifiable shuffle
Use `ephemeral-vrf-sdk` (`create_request_randomness_ix` + `RequestRandomnessParams`, request/callback pattern). VRF on the ER is free.

**Strengthen it beyond plain VRF:** before the deal, each seated player submits `commit = hash(salt)`. The shuffle seed is `VRF_output XOR salt_1 XOR salt_2 XOR …`. Now neither the VRF oracle nor the validator nor any subset of players controls the deck. Publish the seed and all salts at hand end so anyone can recompute the shuffle and verify it, this is the genuinely provable part of the product.

Fisher-Yates from the seed, deterministic and re-runnable.

**Gate:** A hand-history verifier script that takes published seed + salts and reproduces the exact deck. Statistical test over 10k shuffles.

---

### Phase 6: Timers, disconnects, settlement
- **Turn clock** with auto-fold/check on expiry. Use a MagicBlock crank, or a permissionless `force_timeout` instruction anyone can call past the deadline. Read the dev skill's crank patterns.
- **Disconnect**: player drops → auto-fold on timeout, hand continues. Call this out in `TRUST_MODEL.md` as the concrete advantage over mental poker.
- **Settlement**: at hand end, commit public results (stacks, pot distribution, hand-history hash) to base layer via a post-commit **Magic Action**. Undelegate when the table empties.
- Watch the **10-commit sponsorship cap**: a long session needs the delegated fee payer topped up via `lamportsDelegatedTransferIx` (submitted to the *base layer*, not the ER).

**Gate:** 100-hand automated session, 6 seats, random disconnects injected. Zero stalls, chips conserved.

---

### Phase 7: Frontend
Next.js + wallet-adapter. `ConnectionMagicRouter` for routing, direct TEE connection with auth token for private reads. Real-time table UI, hand-history viewer with a "verify this shuffle" button, that verifier is your best marketing asset.

**Gate:** Two browsers, two wallets, a real hand.

---

## 6. Gotchas that will bite you

Compiled from the docs, check each against current docs when you reach it:

- Call `account.exit(&crate::ID)?` before a commit CPI, or the CPI sees stale serialized data.
- The undelegation callback discriminator is `[196, 28, 41, 206, 48, 37, 51, 167]`; `#[ephemeral]` injects it, don't hand-roll it.
- Resizing a delegated PDA requires it to already hold rent for the new size; the payer must itself be delegated to top it up.
- `init_permission` must be idempotent, check `permission.lamports() > 0` and return early.
- When toggling privacy, rebuild the member list every call so the authority can never lock itself out.
- Pin one ER validator via `remaining_accounts` in the delegate instruction. Don't let it float.
- Send top-ups to the **base layer** RPC; send game actions to the **ER**. Mixing these up produces confusing failures.
- Use a fresh 32-byte salt per lamports top-up, reuse collides with an existing PDA.
- The TEE enforces IP geofencing and OFAC screening at ingress. Test from your actual network early so you don't discover a block at Phase 7.

---

## 7. Definition of done for v1

- 6-max Texas Hold'em, play-money, on devnet
- Hole cards unreadable by opponents and by base-layer observers, with tests proving it
- Verifiable shuffle with a public verifier
- <100ms perceived action latency, no wallet popup per action
- Disconnects don't stall hands
- Chip conservation invariant holds across a 100-hand session
- `TRUST_MODEL.md` that a skeptical poker player would find honest

---

## 8. First message back to me

Before writing code, reply with:
1. Confirmation the dev skill installed, and the SDK version you found
2. Any place this spec contradicts current MagicBlock docs
3. Your read on the riskiest assumption here (my guess: whether an empty-member private permission gives true dealer-only secrecy for the `Deck`)
4. Your Phase 0 plan

Then execute Phase 0 and stop.
