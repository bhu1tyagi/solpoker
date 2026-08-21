# SolPoker: design

Why the system is shaped the way it is. `docs/STATUS.md` covers what is built and
what is verified; `docs/TRUST_MODEL.md` covers what is and is not guaranteed. This
covers the decisions underneath both, and the invariants the code exists to
hold.

---

## 1. The problem

On-chain poker has three hard problems, and most attempts die on the first.

| Problem | Why it is hard | What this does |
| --- | --- | --- |
| Hidden cards | Every Solana account is world-readable | Card accounts are delegated to a TEE validator and gated by `EphemeralPermission` |
| Real-time play | 400ms blocks and a wallet popup per action | Ephemeral Rollup plus session keys |
| Fair shuffle | Clock and slot seeds are trivially biased | VRF combined with per-player commit-reveal salts |

### Why a TEE and not mental poker

Mental poker is the cryptographically pure answer to hidden cards, and it is
the reason no on-chain poker product has shipped at scale. Every card reveal
needs a multi-party decryption round trip, and a player who disconnects
mid-hand takes their key share with them, so the hand stalls. Six players means
six chances per hand for somebody's laptop to close.

Making the enclave the dealer turns a disconnect into an ordinary auto-fold.
Nothing needs the absent player's key, because they never held one. That is the
trade: a hardware and operator assumption in exchange for a game that finishes.
`docs/TRUST_MODEL.md` states the assumption plainly rather than burying it.

### The chip economy

Chips are bought with SOL and sold back for SOL at a fixed rate, backed one to
one by lamports in a program vault. They enter and leave in exactly two places,
`buy_chips` and `sell_chips`, and there is no mint path anywhere. The house
takes 2.5% of a pot that sees a flop, capped at three big blinds, which
redistributes chips that already existed rather than creating any.

---

## 2. The two-layer split

The split is the security model, not an optimisation.

| Account | Layer | Why |
| --- | --- | --- |
| `Player` (chips), `TableConfig` | base only, never delegated | Custody stays settled on Solana |
| `Table`, `Seat`, `Hand` | delegated to the rollup | Change on every action |
| `Deck`, `HoleCards` | delegated, TEE-private | Must never be publicly readable |

`Player` is never delegated, so a single instruction cannot write both a
player's balance and a delegated seat: they live on different layers. That
forces every custody transition through the base layer while the table is
undelegated, and gives a clean invariant. **While a hand runs on the rollup,
chips may move between seats, but the table total cannot change, no chip can be
minted, and no player balance is reachable.** Account ownership enforces it, not
a check that could be forgotten.

It also has a cost worth naming: cashing out genuinely requires the table to
come off the rollup, because `leave_table` writes both a seat and a balance.
That is why cashing out is a flow rather than a button.

---

## 3. Randomness

Two independent VRF draws per hand.

- **Board draw** — the seed is published at settlement, so anyone can recompute
  the five community cards and confirm they were not rigged.
- **Hole draw** — never published, never leaves the private deck, wiped at hand
  end.

One draw cannot do both jobs. Proving the board was fair means publishing the
value it came from, and anything else derived from that value is published with
it: XOR is reversible, and hashing the two apart does not help, because a
verifier who cannot see the input cannot check the output either. With a single
seed, publishing it also published every folded player's hand, permanently.

The seed for the board is `VRF XOR salt_1 XOR ... XOR salt_n`. Players commit
`sha256(salt)` before anyone reveals, so nobody can choose a salt after seeing
another. The VRF is drawn only once the salts are fixed, so choosing one half of
an XOR against a half nobody knows yet chooses nothing. The VRF caller seed is
derived from the table, the hand number and the slot, none of which is a
player's to pick.

---

## 4. Data model

Account layout is the thing that is painful to change once anything is
deployed, so it is defined up front in `state.rs`.

### Base layer, never delegated

- **`Player`** — PDA seeded on the wallet. Chip balance and lifetime stats.
- **`TableConfig`** — immutable table parameters: blinds, seat count, buy-in
  range, turn clock. Bounded at creation, because the clock is a weapon if it is
  short enough.

### Delegated to the rollup

- **`Table`** — seat map, button, hand number, state, accrued rake.
- **`Seat`** — one PDA per seat index, reused for the table's lifetime so a
  seat address is stable and never needs re-delegating as players come and go.
  Occupant, stack, per-street commitment, per-hand flags, salt state.
- **`Hand`** — street, board, betting state, deadline, published seed and
  revealed hands after settlement.

### Delegated and private

- **`Deck`** — the 52-card order, both randomness draws, the board held back
  until each street reveals it. `EphemeralPermission` with `is_private = true`
  and an empty member list: readable by no wallet, only by program logic inside
  the enclave.
- **`HoleCards`** — one PDA per seat, two card bytes. `is_private = true` with
  exactly one member, the seat's current occupant.

A permission may only be updated by a member it already names, and it survives
the trip off the rollup and back. Two rules follow, and both are load-bearing: a
permission is never created for an empty seat, or nobody could ever be named in
it; and a departing player releases their read right so the next occupant can be
named. Without either, a chair dies for the life of the table.

Card encoding is `u8`, `rank = card / 4` (0 = Two … 12 = Ace), `suit = card % 4`,
`0xFF` = none. The same encoding in the engine, the program and the verifier, so
nothing converts.

### The most dangerous mistake in this project

**Never let `Deck` or `HoleCards` reach the base layer while they hold cards.**
Undelegation commits account contents to public Solana state permanently: every
card, visible to everyone, forever. It is also permissionless, so "the client
only calls it after settlement" is a habit, not a guarantee.

Four things enforce it structurally:

1. Both accounts are zeroized at settlement, before any undelegation path can
   run.
2. `undelegate_core` and `undelegate_seat` verify by content, byte by byte, that
   what is leaving holds no cards, no randomness and no seed, and refuse
   otherwise.
3. Every account in those instructions is bound to one table, so the content
   check cannot be satisfied with some other table's already-clean deck.
4. Every commit call site carries a comment listing what is being committed and
   why it is safe.

---

## 5. Driving the game without a server

There is no backend. Starting a hand, dealing, advancing a street, settling and
timing out are all permissionless, so every open client watches the same state
and does whatever is next. Two clients will sometimes try the same step at the
same moment.

Two things keep that from being chaos. Steps are idempotent or refused on chain,
so a duplicate is never applied twice. And clients wait their turn: a seat's
delay is based on where it sits among the occupied seats, so the lowest usually
acts and the others only step in if it did not. That turns a race into a
fallback chain.

The loser of a race gets a specific error and treats it as success rather than
showing anybody a failure. That is correct, and it has a cost worth knowing: a
genuinely stuck state looks exactly like a lost race. Anything that waits longer
than 35 seconds therefore stops reassuring and starts describing.

---

## 6. Things that bite

Collected because most of them cost a day each.

- **A hand that cannot finish strands every chip on the table.** `settle_hand`
  failing means the table never leaves `HandInProgress`, `leave_table` needs
  `Waiting`, and undelegation refuses a deck holding cards. `abandon_hand` is
  the break-glass: refund every contribution, nobody wins the pot.
- **An unfulfilled VRF request is the same trap.** `reset_shuffle` clears it,
  time-gated so recovery never depends on a particular client being awake.
- **A retry must be a different request.** A caller seed that does not change
  between attempts is a duplicate the oracle ignores, and the table retries
  forever.
- **Permission existence is decided by data, not lamports.** After a
  re-delegation the account still exists with zero lamports, and reading that as
  "does not exist" makes every seat fail to secure.
- **Seats must leave the rollup before the core accounts**, because
  `undelegate_seat` reads the table to refuse a mid-hand pull. Check the whole
  table can leave before taking any of it apart, or it splits across two layers.
- **The commit budget is ten per delegation cycle**, so settling to Solana after
  every hand exhausts it in ten. Play at rollup speed, commit on a cadence.
- **Re-vendor the IDL after every deploy.** Account layouts and the error list
  live in it, and a stale copy makes the client send the wrong accounts and
  decode the wrong bytes.

---

## 7. What v1 means

Six-max no-limit Hold'em, playable end to end by two people in two browsers:
buy chips, sit, play hands with no wallet prompt after setup, see only your own
cards, cash out. A published hand verifies against its seed in the browser. The
turn clock survives a disconnect. Chips are conserved across any legal sequence
of actions, and the vault backs every one of them.
