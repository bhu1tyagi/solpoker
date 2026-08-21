# SolPoker: what is built, what is verified, what is left

Written 15 August 2026. Updated 20 August 2026, after a second, mainnet-focused
security audit, the fixes it produced, and a full devnet redeploy and
verification. Still devnet only.

This is the honest version. "Verified" below means a test or a measurement ran
and I read the result, not that the code looks right. Anything I have not
actually checked is in [What is not verified](#what-is-not-verified), and the
things I know are wrong are in [Known problems](#known-problems).

The repository is public and the client is live. As of 20 August there is no
known open fund-theft or card-leak bug: the four found in the mainnet audit are
fixed and deployed, and `record_hand_result`, open since 16 August, is closed.
What stands between here and mainnet is not a bug list; it is in
[Are we ready for mainnet?](#are-we-ready-for-mainnet) directly below.

## Are we ready for mainnet?

**Not yet, and the remaining list is short.** Everything provable without real
money on the line passes: 75 Rust tests, 68 client tests, 30 devnet integration
tests across three suites, and the two-browser gate. The mainnet audit's four
fund-or-card bugs are fixed on chain, `record_hand_result` is closed, mucked
cards are no longer derivable, and the house now earns a rake. If the question
were "is the code sound", the answer is yes.

Two things still fail the mainnet bar, and the owner has deliberately deferred
the first while this remains an experiment:

1. **The upgrade authority can drain the entire vault, and it is a single laptop
   keypair.** The only risk here whose blast radius is *everyone's* money at
   once rather than one table's pot: whoever holds that key can deploy a program
   that empties the vault backing every chip. A multisig (Squads) or a burn is
   an afternoon. **Consciously deferred** — acceptable for an experiment on
   devnet, not acceptable the day real SOL is involved.

2. **A real wallet extension has never signed anything here.** Every browser
   test uses an injected keypair. The interface is the standard one, so this is
   likely fine, and likely is not the same as tested. One hand with Phantom on
   devnet closes it.

3. **A player who closes their tab without pausing leaves their seat
   unreleased.** The permission still names them, so the next occupant of that
   chair cannot be secured and sits out. Safe — excluded, never readable — and
   now visible: the table says so and tells them to take another seat. Closing
   the last of it needs a hole PDA seeded by an occupancy counter, which costs
   an account per seat-change and has not been judged worth it.

Below those sit the launch-hygiene items that are cheaper now than later: no
account-migration path (treat the layouts as frozen once money is on them), the
50 orphan test players that argue for a fresh program id, and the standing
trust-model gaps (attestation proves hardware not code; the two-salt threshold).
None is a reason to hold a launch alone; together they are the difference
between a careful launch and a hopeful one.

**Shortest honest path to GO:** multisig the upgrade authority, sign one hand by
hand with Phantom on devnet, and exercise a seat changing hands across a pause.

## In one paragraph

Six-max no-limit Texas Hold'em, fully on chain. Hands run on a MagicBlock
Ephemeral Rollup so play is sub-second, and the rollup's validator runs inside
an Intel TDX enclave so hole cards are unreadable by opponents and by anyone
watching Solana. The shuffle is a VRF draw combined with player salts, at least
two of them, and anyone can recompute a finished deal in their browser to check
it was not rigged. Chips are bought with SOL and sold back at a fixed program
rate, backed one to one by a program vault; on devnet that SOL is test
currency. The web client is live and lays out on a phone. Both players in a
two-browser test can play a real hand without a single wallet prompt after
setup.

## The stack

| Layer | Choice | Version |
| --- | --- | --- |
| Chain | Solana devnet | Agave CLI 3.1.9 |
| Program framework | Anchor | CLI 1.0.2, lang 1.1.2 |
| Language | Rust | 1.89.0 |
| Rollup | MagicBlock Ephemeral Rollups | `ephemeral-rollups-sdk` 0.16.2 |
| Privacy | Private ER on Intel TDX | features `access-control` |
| Randomness | MagicBlock VRF | feature `vrf` |
| No-popup play | Session keys | `session-keys` 3.1.1 |
| Client | Next.js App Router | 15.5 |
| UI runtime | React | 19.1 |
| Animation | Motion (Framer Motion) | 12 |
| State | Zustand | 5 |
| Wallets | Solana wallet-adapter | 0.15 |
| Web3 | `@solana/web3.js` | 1.98.4 |
| Hashing | `@noble/hashes` | 1.8 |
| Browser tests | Playwright | 1.62 |
| Unit tests | Vitest, cargo test, proptest | current |

Deployed program: `4f8UE9BfWnAMLpYwpxJCNFD6HEmHwNQLtmQfhKW45tZ9`
TEE endpoint: `https://devnet-tee.magicblock.app`
Pinned validator: `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`
Client: <https://solpoker.vercel.app>
Source: <https://github.com/bhu1tyagi/solpoker>, MIT, public

The program account has been extended twice to fit growing binaries the upgrade
would otherwise refuse: 30,000 bytes on 16 August, and 100,000 bytes on
20 August for the mainnet-audit fixes. Allocated data length is now 1,075,544
bytes against a 1,004,888-byte binary, which leaves real headroom.

## What is built

### The rules engine

`crates/poker-engine`, plain Rust with no Solana dependency, so it can be
property-tested at full speed and linked into the program unchanged.

- Seven-card hand evaluation with no lookup tables. A 13-bit rank mask plus a
  count array; straights are found with a four-shift AND rather than a search.
  The usual fast evaluators buy speed with a ~130 MB table, which does not fit
  a Solana compute budget.
- Betting state machine: streets, blinds, min-raise, under-raise all-in rules,
  who acts next.
- Side pots by level bands, with odd chips going clockwise from the button.
- Deterministic shuffle: Fisher-Yates over a SHA-256 keystream with rejection
  sampling, never modulo, so no permutation is likelier than another.

### The program

Split across the two layers on purpose, because the split is the security model.

| Account | Layer | Why |
| --- | --- | --- |
| `Player` (chips), `TableConfig` | base only | Custody stays settled on Solana |
| `Table`, `Seat`, `Hand` | delegated to the rollup | Change every action |
| `Deck`, `HoleCards` | delegated, TEE-private | Must never be publicly readable |

35 instructions covering the lifecycle: create, seat, delegate, secure, salt
commit and reveal, VRF request and callback, start, deal, act, advance, settle,
timeout, commit results, undelegate, leave, vacate, delete — plus the two
break-glasses added in the mainnet audit, `reset_shuffle` and `abandon_hand`,
and `release_hole`, which is how a chair survives changing hands.
45 error codes. Chips are bought with SOL, and the house takes 2.5% of a
raked pot.

### The client

`app/`, a Next.js app with no game server. Lobby, table, hand history with an
in-browser verifier, and a trust page. There is no backend: starting a hand,
dealing, advancing a street, settling and timing out are all permissionless, so
every open client watches the same state and does whatever is next, staggered by
seat so they rarely collide.

Deployed at <https://solpoker.vercel.app>. It lays out for narrow screens, and a
phone held upright gets a table stood on end rather than a shrunken wide one:
the media queries live in `globals.css` because inline styles cannot hear one,
and `use-viewport` mirrors the same breakpoints for the parts positioned in JS.
The two must stay identical word for word or a phone gets a portrait table
inside a desktop room.

The mark is a spade on a slate tile, drawn once in `components/primitives/Logo`
and again in `app/icon.svg` and `app/apple-icon.svg`, which Next serves as the
tab and home-screen icons by file convention. Three candidates were rendered at
16, 20, 32, 64 and 160 pixels on light and dark tab bars before one was picked;
the two that lost did so on measurement rather than taste, which is the only way
to choose a mark that has to survive 16 pixels.

## What is verified

### Privacy, measured rather than assumed

| Check | Result |
| --- | --- |
| Deck read by the table creator | denied |
| Deck read by a seated player | denied |
| Deck read by an outsider | denied |
| Your own hole cards | allowed |
| An opponent's hole cards | denied |
| Base layer during a live hand | no card data |
| Base layer after the hand | no unrevealed cards |
| Shuffle seed during a live hand | not public |
| Raw VRF output during a live hand | not public |
| Undelegating mid-hand to force a reveal | refused by the program |
| Starting a hand before the *deck* is locked down | refused by the program |

The three seed and randomness rows came out of an audit late in the build and
are the most important. See
[What went wrong](#what-went-wrong-and-was-fixed). The last row is newer, from
the 16 August audit, and is the difference between the cards being private
because the client locked them and being private because the program will not
deal otherwise. See [The security audit](#the-security-audit-16-august).

### Fairness

- Published history reproduces the exact deal, checked by a verifier that
  shares no code with the program.
- A tampered salt is rejected.
- A tampered board is rejected.
- Rust and JavaScript agree on the pinned vector: seed `[7u8; 32]` gives
  `3d 5c 7s Kd Qc 8c As Jd 4d 2d` in both.
- Chi-square over 10,000 shuffles, plus 8 property tests asserting chips are
  conserved across any legal action sequence and pots always sum to
  contributions.

### Play

| Run | Result |
| --- | --- |
| 100 hands, 6 seats, 141 forced timeouts | 0 stalls, chips never moved from 12,000 |
| 3-hand session, 6 seats | passed, all players cashed out |
| Full hand through the client's own modules | settled, verified, chips conserved |
| Two browsers, two wallets, a real hand through the UI | passed |
| Pausing a live table back to the base layer, through the UI | passed |
| The creator deleting their table, through the UI | passed |
| A non-creator being refused a delete | passed |
| Two consecutive hands, both recorded, both verify | passed |
| A live table listed in the lobby with a way back | passed |
| Magic Actions reaching the base layer after the audit fixes | passed, 1 commit, last hand 3 |
| The client building and serving from Vercel | passed, tab icon included |

The two-browser gate is the one that matters. It drives the actual UI with two
wallet-standard wallets backed by real keypairs and checks that each player sees
their own cards and not the other's. Everything else was green while the table
page was rendering six empty seats to a player sitting at one.

### Cost and speed

| Operation | Compute units | Share of budget |
| --- | ---: | ---: |
| Evaluate one 7-card hand | 865 | 0.4% |
| Six-player showdown with side pots | 7,075 | 3.5% |
| 52-card shuffle | 18,289 | 9.1% |

Action round trip on devnet: min 257ms, median 348ms, max 865ms. That is above
the sub-100ms target and the cause is network distance, not block time: devnet's
only TEE region is in Asia. The client covers it by reading at `processed` and
rendering your action the moment you press, so confirmation lands inside the
chip animation.

### Test counts

- 48 Rust unit tests, 8 property tests, 7 shuffle-quality tests, 4 program tests
  (67 total, up from 63: three of the new four pin the config-swap attack)
- 62 client unit tests (engine ports, verifier, salts, decoders, optimistic)
- 14 devnet integration tests, plus 4 in the session run
- 1 module-level devnet play test
- 1 two-browser UI gate
- 1 page-load check that fails on any console error

## The security audit, 16 August

Done before making the repository public, on the assumption that people would
arrive looking for something to break rather than a game to play. Every
instruction handler and account context was read directly. Secrets and git
history came out clean: no keys, tokens or `.env` content in any of the 50
commits, nothing added and later deleted.

Chip custody also held up under a deliberate attempt to break it. `buy_chips`
and `sell_chips` are the only two places chips enter or leave, the vault is
backed one to one with a rent floor, and there is no mint path. Custody
transitions are structurally confined to the base layer by account ownership,
so the rollup cannot reach a player's balance. Positional seat accounts turned
out to be safe for a non-obvious reason worth writing down: `check_seat_order`
verifies `seat.table` and `seat.seat_index` rather than re-deriving the address,
and that is sufficient only because `create_seat` binds both fields to the seed,
which makes the pair unique. The same argument covers `Hand` and `HoleCards`.

### Fixed

**Anyone could take every pot at any table.** `player_action`, `advance_street`
and `force_timeout` each took a `TableConfig` without checking it belonged to
the table being played. `StartHand` and `SettleHand` constrain it with
`address = table.config`; these three never load the table, because a 192-byte
seat map plus six seat accounts does not fit the BPF stack frame, so the account
sat entirely unchecked. All three write `now + config.action_timeout_secs` into
the hand's deadline. So: create a table with a one-second timeout, pass its
config while acting at someone else's table, then call the permissionless
`force_timeout` on each opponent in turn before they can physically respond.
Every opponent folded, every pot uncontested, and chips redeem for SOL. The same
config also supplied the blinds the engine sizes a minimum raise from.

`check_config` now re-derives the table address from the config's own
`table_id`, which is the seed of its own PDA, so the pair prove they belong
together without loading the table. Three unit tests, one named after the attack.

**Cards could be dealt before anyone locked them.** Nothing on chain required
`secure_deck` and `secure_hole` to have run before secrets were written, and
`start_hand` is permissionless. The deck holds the VRF output while the salts
are public, so a hand started against a still-readable deck publishes the entire
deal. Privacy was an ordering the client remembered, not a rule the program
kept. `Deck` and `Seat` now carry a bit only those two instructions can set,
`start_hand` refuses without it, and every path that changes who occupies a seat
clears it, so a permission can never vouch for the previous occupant.

**A salt commitment could be reopened after reveal.** `commit_salt` never
checked `salt_state`, and a second reveal XORs the new salt in without XORing
the first out, so a player could commit, reveal, then commit and reveal again
and land on any `salt_xor` they liked after watching everyone else. Commitments
now close at the first reveal. First-time commits stay open, so a player who
sits down late is not shut out.

**The documented fairness guarantee was stronger than the code.** README and
`docs/TRUST_MODEL.md` both said the deck could only be biased by the oracle *and
every seated player*. `request_shuffle` requires two revealed salts. The docs
now say two, and say what has to change before the threshold moves.

**Housekeeping.** MIT `LICENSE` added, which the README had claimed all along
and which made the repository legally all-rights-reserved without it. `https`
and `wss` are now enforced on the configurable endpoints, because the TEE auth
token rides in that query string and an `http://` typo would have shipped it in
cleartext. The `!target/deploy/*-keypair.json` re-inclusion line is gone from
`.gitignore`: it was inert, and one edit away from publishing the upgrade
authority. Local security reports are git-ignored, so the list of unfixed
weaknesses does not get published alongside the source.

### Attempted, failed, reverted

**`record_hand_result` has no caller authentication, and could not be given
any.** `#[action]` injects `escrow_auth` and `escrow` as `UncheckedAccount`s and
nothing else about the caller is available, so anyone can invoke it directly and
write into any table's history.

The SDK documents `escrow` as "a `signer` in callback", which would be exactly
the authentication needed. It is not one. Declaring it `Signer<'info>` compiles,
deploys, and then silently stops every Magic Action from landing, because a
failing action is stripped from its transaction strategy and the commit is
retried without it. Measured, not reasoned about:

```
escrow as Signer:          base layer recorded 0 commits, last hand 0   FAILED
reverted to Unchecked:     base layer recorded 1 commits, last hand 3   passed
```

Reverted. This is the clearest argument in the repo for the session test
existing: `npm run test:er` passed all 14 tests against the broken build,
because its "history" is the local shuffle-verifier JSON and not the on-chain
`TableHistory`. The regression would have shipped invisibly.

Closed on 20 August, without authenticating the caller at all. See
[The mainnet audit](#the-mainnet-audit-20-august): `commit_results` builds the
action's account list itself, so it hands over the base-layer `Hand` PDA and the
handler records only values that already match it.

## What went wrong and was fixed

Worth recording, because most of it was invisible to the tests that existed.

**The privacy fix wedged a table permanently, 17 August.** The 16 August change
made `start_hand` refuse to deal to any seat whose `cards_secured` bit was
false, and made sitting down clear that bit, on the reasoning that a permission
naming the previous occupant must not vouch for the next one. The reasoning was
right and the enforcement was unworkable, for a reason that only shows up on
chain: **a hole-card permission can only be updated by the member it already
names.** Updating it means loading the account, and the enclave refuses to load
a private account for anyone outside its member list. Secure a seat while it is
empty and the member list is empty, so the moment someone sits down nobody can
point the permission at them. Not the new occupant, not the crank, not the
creator.

So a seat changing hands produced a table that could not start a hand, could not
undelegate because the deck still held fulfilled VRF randomness, and therefore
could not be paused or deleted either. It presented as the status line reading
"shuffling" forever, because `CardsNotSecured` had been added to the client's
race-lost set and was being swallowed as a benign retry. One table on devnet was
lost to it and had to be freed by redeploying the program.

The per-seat gate is gone. The deck gate stays, and is safe for a reason the
seat gate was not: the deck's permission has no members by design, and
`secure_deck` sets its flag the first time it runs, which is the only moment the
permission does not yet exist. False there always means "creatable", never
"locked out". `cards_secured` survives as advisory state so a client can see a
stale permission and fix it while it still can.

**The shuffle seed was public for the whole hand.** The VRF output and seed were
written to the `Hand` account, which anyone can read. Salts are public once
revealed, and the deal is a deterministic function of the seed, so anyone could
compute all six players' cards and the whole board before a card was turned. The
TEE was faithfully hiding the deck while the recipe sat in the open. Both now
live on the deck, the one account nobody can read, and settlement copies them
out once publishing them is the point.

**Undelegation was a forced-reveal button.** It permanently publishes account
contents, anyone may call it, and nothing checked what it was publishing.
Zeroizing at settlement was a habit of the client, not a guarantee of the
program. Both undelegate instructions now verify, by content, that what is
leaving holds no cards, no randomness and no seed.

**Settling twice corrupted the record.** A client losing the settle race re-ran
against cleared seats, wiped the revealed cards and hashed a result over zero
payouts.

**The table page only read the rollup,** so a table that had not started yet
rendered as six empty seats to the player sitting at one.

**One legacy account emptied the whole lobby.** Old config accounts are eight
bytes shorter than the current layout; reading past the end threw, one try/catch
covered the entire listing, and the failure rendered as "No tables yet", which is
indistinguishable from an empty lobby.

**Your own cards were face down.** The hole account is permission gated, so its
change notifications are not reliable, and it was the only account with no
polling fallback.

**Salts regenerated when storage was unavailable,** so a player committed to one
salt and revealed another, stalling every hand for anyone with storage blocked.

**`commit_results` was dead code** with no caller, so nothing reached the base
layer until someone pressed Pause.

**A committed salt that never revealed stalled the table forever.**

**History storage could be poisoned by whoever opened it first.** Opening an
IndexedDB database without a version creates it, empty, if it does not exist.
The test harness's history counter did exactly that on fresh browsers, so the
app's own versioned open then skipped its store creation and every hand save
failed silently. Anything can make that first blind open, devtools included.
The store is now created defensively on a bumped version, which also heals any
database already in that state.

**A live table vanished from the lobby.** The lobby queried accounts owned by
the program, but a delegated table is owned by the delegation program on the
base layer, so the moment a game started its table disappeared from the list. A
player who stepped away mid-game found a lobby insisting their table did not
exist, with their chips on it. The lobby now asks both owners, verifies each
candidate by re-deriving its address, and shows a "return to your table" banner
whenever your wallet is in a seat map.

**Hand records could be written with the previous hand's seed.** The capture
fired when the table flipped to waiting, but the settlement data had not
arrived, and the previous hand's result hash made the state look settled. Worse,
watching for the settled moment at all turned out fragile: account notifications
arrive in any order and grouping, and the brief settled state can be skipped
entirely between two snapshots. Capture now fetches the hand account directly
and retries until it sees the settled shape, which is safe because everything
the record needs stays on the hand from settlement until the next hand starts.

## The mainnet audit, 20 August

Done because the plan changed from "devnet demo" to "real SOL", which moves
every tradeoff. Eight areas were read independently — leakage, custody,
authorization, the rules engine, client security, client state, UI, and
operations — and the findings were then re-derived from source rather than
taken on trust.

It found four things that could lose a player real money or show an opponent
their cards, none of which the 16 August audit had caught. All four are fixed.

**Randomness could land on a deck nobody had hidden yet.** `start_hand` checked
`deck.secured`; `request_shuffle` and `shuffle_callback` did not. The VRF output
was therefore written to the deck *before* anything required the deck to be
private, and the salts it combines with are public the moment they are revealed.
A deck still world-readable when the callback arrived was the entire deal in the
open — every hole card and the whole board — computable before a card was
turned, by anyone who could reach the rollup. It needed no attacker: a
`secure_deck` that simply failed produced it. Both instructions now refuse.

**A one-second turn clock stole every pot.** `create_table` accepted any
`action_timeout_secs > 0`. `check_config` correctly proves a config belongs to
its table, which is precisely why it could not see this: the hostile clock was
on the attacker's own table, legitimately. Create a table with a one-second
clock, raise, and call the permissionless `force_timeout` the moment it expires;
every opponent is folded before a human can answer, hand after hand, and
`sell_chips` turns the proceeds into SOL. Clocks are now bounded to 10–300
seconds at creation and clamped again at all four points of use, so a config
written by an older build cannot be used this way either.

**Every empty seat was permanently blinded.** `secure_hole` on an unoccupied
seat created a permission with `is_private = true` and no members — readable by
nobody, and, measured on devnet, updatable by nobody either. Whoever sat there
next was dealt cards they could never read. The shipped client did this to all
six seats of every table it started: `startTable` took the occupied seats as an
argument and then ignored them. `secure_hole` now refuses an empty seat, and the
client only asks for seats somebody is in.

**Undelegation could be aimed at a decoy.** The accounts arrived as bare
`AccountInfo`s with nothing binding them to one table, so the content check that
refuses to publish a deck holding cards could be satisfied with *some other
table's* settled deck. Pass the victim's real table and hand with a clean
foreign deck and their table was yanked back to the base layer mid-hand while
its seats stayed on the rollup — split across two layers, unplayable,
unrecoverable, pot included. One cheap transaction, any table, repeatable. The
same trick worked on `undelegate_seat` with any seat not dealt into the hand.
Both now bind every account to one table and refuse while a hand is live.

**A hand that could not settle locked every chip on the table.** If settlement
itself fails — a hole account that will not deserialize, a distribution the
engine refuses because it could not assign every chip an owner — then
`settle_hand` fails forever, the table never leaves `HandInProgress`,
`leave_table` needs `Waiting`, and undelegation refuses a deck that still holds
cards. Every chip on that table stopped existing for its owner, with no route
out at all. There is now `abandon_hand`: permissionless, one hour past the
deadline, and the most conservative resolution available — nobody wins the pot,
every seat gets back exactly what it contributed, and the table returns to
`Waiting` so people can stand up. An hour is long enough that it cannot be used
to duck a losing hand, because anyone at the table can end one properly with
`force_timeout` and has the whole hour to do it.

Also fixed in the same pass:

- **`record_hand_result` is closed** — the item below that was open since 16
  August. `commit_results` now passes the base-layer `Hand` PDA through the
  action's own account list, and the handler records only values that already
  match it. The caller is still unauthenticated and it no longer matters: the
  worst it can write is something that was already true. Every rejection is a
  quiet `Ok`, because an action that fails is stripped rather than refused.
- **The deal gate is back, as an exclusion.** `start_hand` deals only to seats
  whose permission names their occupant, and sits the rest out. This is the
  17 August change that wedged a table, made safe by the `secure_hole` fix
  above: refusing the hand bricked it, sitting one seat out costs that player
  one hand.
- **A dead shuffle no longer freezes chips.** An unfulfilled VRF request left
  `shuffle_state` stuck, and every route out of it — start, settle, re-request —
  is refused while it holds, so the table could not play, could not pause, and
  nobody could cash out. This is the ordinary end of a heads-up session: one
  player busts, the crank has already drawn the next shuffle, and `start_hand`
  can never run again with one funded seat. There is now a permissionless,
  time-gated `reset_shuffle`, the crank calls it, and `pauseTable` clears the
  way before undelegating. The crank also no longer draws a shuffle for a hand
  that cannot start.
- **The validator and the VRF queue are pinned on chain.** Delegation is
  permissionless and the validator was pinned only by a constant in the web
  client, so anyone could send an unstarted table to a rollup of their choosing
  — and every card depends on the accounts landing inside the enclave.
  `request_shuffle` likewise accepted four oracle queues, three of which nobody
  services, which was a one-transaction stall.
- **The VRF caller seed no longer comes from the salts.** Deriving it from
  `salt_xor` was meant to stop a requester shopping for a draw and did the
  opposite: whoever committed last could read every revealed salt, pick theirs
  to land the total wherever they wanted, and so choose the caller seed. It is
  now `sha256(table || hand_number)` — fixed before any salt exists, nobody's to
  choose, and identical on every re-request, so there is nothing to grind. The
  final seed is still `VRF XOR salt_xor`, and steering one half of an XOR
  against a half nobody knows yet steers nothing.
- **A daily session rotation was quietly abandoning SOL.** Each session key is
  funded with real lamports and rotation overwrote its only copy. The remainder
  is now swept back to the wallet first, and a keypair survives a blocked
  `localStorage` instead of being lost along with its balance.
- **The app had no security headers at all.** No CSP, no `X-Frame-Options`, no
  `Referrer-Policy`. This origin holds a session key that signs bets and a token
  that reads hole cards, so one injected script was a total compromise. There is
  now a CSP whose `connect-src` is built from the configured endpoints, and the
  TEE token's retention is down from 30 days to 12 hours and is cleared on
  disconnect along with the session key — neither was cleared before.
- **Betting actions cannot double-fire.** `act` was guarded by React state,
  which does not settle within a tick, so a double-tap sent two transactions.

### Deployed and verified on devnet, 20 August

The program account was extended by another 100,000 bytes to fit the new
instructions — the binary had outgrown its allocation again and the upgrade
would otherwise have been refused outright. Allocated data length is now
1,075,544 bytes against a 1,004,744-byte binary, which leaves real headroom.

| Suite | Result |
| --- | --- |
| `npm run test:base` | 11 passing, chips conserved across the run |
| `npm run test:er` | 15 passing, up from 14 |
| `HANDS=3 npm run test:session` | 4 passing, 3 hands, 0 stalls |

Three results are worth naming, because each was an open question this morning.

**Magic Actions still land.** `base layer recorded 1 commits, last hand 3` — the
same assertion that caught the `escrow as Signer` regression and would have
caught this one. `record_hand_result` now carries a second account and verifies
the claim against it, and the action was not stripped. That was the largest
uncertainty in the whole change.

**The empty-seat refusal is real, and the old client was doing it.**
`test:er` failed on first run: it secured all six seats, seats 3-5 were empty,
and the program refused with `SeatEmpty`. That is precisely what the shipped
client did to every table it started. The test now secures only occupied seats,
as the client does, and a new case pins the refusal.

**A two-second clock is no longer creatable.** `test:session` failed on first
run with `TimeoutOutOfRange`: it had always used a 2-second clock to force
timeouts quickly. A clock that short is the theft vector, so the test moved to
the 10-second floor rather than the floor moving to the test.

### The fix that broke the game, and how it was caught

Worth writing down at length, because it is the clearest argument in this
repository for the two-browser gate existing.

Closing the late-commit hole by refusing every commit once any salt had been
revealed was wrong, and every automated test said it was fine. 71 Rust tests,
66 client tests, 11 base-layer tests, 15 rollup tests and a 3-hand session run
all passed against it. Then the gate opened two browsers and the table sat at
**"waiting for players to shuffle in" forever.**

The scripted suites drive every seat from one process, so they commit for
everybody and then reveal for everybody. Two real clients do not take turns:
each does its own salt work immediately, because nobody else can do it for
them. So one browser revealed first, `salt_mask` became non-zero, and the other
browser could no longer commit at all. One salt, and `request_shuffle` needs
two. `NotEnoughSalts` is in `RACE_LOST`, so it was swallowed as a lost race and
retried forever, exactly as designed and exactly wrong.

Reading the seats straight off the rollup is what settled it, rather than
guessing:

```
seat 0 occupant GUBtWpzL stack 2000 salt_state 2 cards_secured 1
seat 1 occupant 4VjxgdLk stack 2000 salt_state 0 cards_secured 1
```

Both secured, both funded, one salt. The privacy work was fine; the protocol
was deadlocked.

The repair was not to revert. A late committer choosing `salt_xor` only ever
mattered because the VRF caller seed was derived from it, so the caller seed
now comes from the table and hand number instead — which closes the grinding
concern more completely than refusing commits did, and makes a late commit
harmless. Two problems, one fix, and the race is gone.

Two lasting changes came out of it. The table now says so when a wait has
stopped being a wait: any between-hands state that persists for 35 seconds
stops reassuring and starts describing, because every error in that phase is
swallowed by design and a stuck table otherwise looks exactly like a healthy
one. And a reminder that a green suite of 163 tests said nothing about whether
two people can play a hand.

**The gate itself had gone stale, and that hid a passing result.** Step 12
waited for the words "on Solana" to appear after pausing. That string came from
the Link field in the HUD, which was removed on the grounds that which layer a
table sits on is plumbing rather than something a player reads every hand.
Nothing has rendered it since, so the check could only ever time out — on a
pause that had in fact succeeded, with the table and all six seats verifiably
back on the base layer. It now waits for the room to offer "Start playing"
again, which is the thing a person would actually look at. A test that asserts
on copy is a test that expires quietly when the copy changes.

## Mucked cards and the rake, 20 August

Two changes made after the audit, both requiring a redeploy and a wipe because
both move an account layout.

### Folded hands are no longer public

The audit's one open design problem. Publishing the shuffle seed is what makes
the deal checkable, and the deal was a deterministic function of it, so anyone
could recompute every card a finished hand dealt — including the hands of
players who folded and never showed. A permanent, public read on every
opponent's folding range.

The documented fix was "two seeds derived from the same VRF draw", and that does
not work. Proving the board was fair means publishing the value it came from,
and anything else derived from that same value is published with it: XOR is
reversible, and hashing the two apart does not help, because a verifier who
cannot see the input cannot check the output either. One secret cannot be both
published and secret.

So there are now **two independent VRF draws per hand**, requested together and
answered by separate callbacks:

| Draw | Decides | Published |
| --- | --- | --- |
| board | the five community cards | yes, at settlement |
| hole | which cards each player is dealt | never |

`start_hand` shuffles fifty-two from `VRF_board XOR salts` and takes the top five
as the board, which it holds on the private deck and reveals a street at a time.
The hole cards are dealt from the other forty-seven, ordered by a seed derived
from `VRF_hole`, which is wiped at hand end and which `assert_deck_publishable`
refuses to let leave the rollup.

Measured on devnet, from a real settled hand:

```
published seed  82acda9762d6597c91c0679de4f517f6f564cf41af89f1ea84c6fd2fdda52f28
deck[0..5]      5s 8d Ah 9d Th   <- the board, and it matches
deck[5..11]     8c 3d As Qh Td Ks <- what the three hands WOULD have been
actually shown  4s 2d | 4c 7h | Ad Jd
```

The board verifies. The hands are nowhere in the published deck.

What this costs is real and worth stating: **a shown hand can no longer be
proven to be the hand the deck dealt.** The verifier still checks the board
against the seed, and checks that a shown card is a real card, is not on the
board, and was not also shown by someone else — but there is no derivation left
to pin it to. The guarantee is now exactly what `docs/TRUST_MODEL.md` always claimed
it was: provably fair shuffle of the board, TEE-protected hole cards. Before, it
was quietly stronger on fairness and quietly weaker on privacy than the document
said.

### The house takes a rake

2.5% of the pot, capped at three big blinds, and only on hands that see a flop.
No flop, no drop. Pots at or below one big blind go unraked. All three rules
exist so the charge is invisible: a hand that steals the blinds is never
touched, and the cap means the effective rate *falls* as pots grow, which is the
opposite of how a fee behaves and the reason volume players do not feel it.

It comes off the winners in proportion to what each is owed, so a split pot is
raked once between them rather than once each, and a side-pot winner taking a
tenth of the money pays a tenth of the rake. The odd remainder goes to the
largest payout, the same rule the engine already uses for an odd chip.

Settlement runs on the rollup and a base-layer balance cannot be written from
there, so the chips wait in `Table.rake_accrued` and a permissionless
`sweep_rake` moves them once the table is back on Solana. The destination is
fixed to `TREASURY_AUTHORITY`, so there is nothing for a caller to gain and no
reason to make the house the only one who can run it. `close_table` refuses
while rake is unswept, because deleting the table would destroy chips the vault
is still backing. The treasury is an ordinary `Player` account and cashes out
through the same `sell_chips` everyone else uses.

No chip is created to pay it. Verified over a three-hand session:

```
rake taken over 3 hand(s): 3 chips
swept 3 chips of rake to the treasury
all 6 players cashed out; 59997 chips across balances, 3 raked
```

59,997 + 3 = 60,000. The session test's conservation assertion now counts the
rake, which makes it a stronger check than before rather than a weaker one: it
proves the rake neither creates nor destroys a chip on its way out of the pot.

### The two open questions, answered on devnet

Both were "unverified" rather than "broken", and both are now measured.

**The doubled VRF dependency holds up.** Splitting the deal into a published
board draw and a secret hole draw means every hand needs two oracle round trips
instead of one, and until now that had run for about six hands. A 25-hand
session with six seats and a 15% drop rate:

```
25 hands played
24 player-hands dropped, 30 forced timeouts
0 stalls
base layer recorded 1 commits, last hand 25
rake taken over 25 hand(s): 23 chips
swept 23 chips of rake to the treasury
all 6 players cashed out; 59977 chips across balances, 23 raked
```

Fifty randomness draws, every one fulfilled, no stall. Chips read exactly 12,000
at hands 10, 20 and 25, and 59,977 + 23 = 60,000 at the end.

**A seat that changes hands across a pause is fixed, and the root cause was
larger than the symptom.** The suspicion was that an `EphemeralPermission`
names one member, only that member may update it, and it survives the trip off
the rollup and back — so a seat whose occupant changed while paused could never
be re-secured, and its new player was excluded from every deal.

The first half is true, and `release_hole` handles it: the departing player
hands their read right back while the table is still on the rollup, dropping the
permission to public. Safe precisely because it happens when there are no cards
to protect — the account holds `0xFF` between hands, and `start_hand` refuses to
deal to a seat until `secure_hole` has pointed a fresh permission at whoever is
sitting there. Public and re-pointable beats private and stranded. It is signed
by the occupant's wallet or session key, so standing up costs no extra prompt,
and the client does it as part of `pauseTable`.

But that alone did not fix it, and chasing the remaining failure found something
worse. Probing the rollup mid-test:

```
permission on rollup: 0 lamports, 101 bytes
secure_hole 0 after handover failed: InvalidAccountData
```

The permission account still exists after a re-delegation — 101 bytes of it —
but carries **zero lamports**. `secure_deck` and `secure_hole` both used
`permission.lamports() == 0` to mean "this does not exist yet", so they took the
create branch against an account that was already there, and the permission
program refused it. That is not a handover bug. **Every table that was paused
and restarted failed to secure every seat**, `start_hand` dealt nobody in, and
the table looked dead with nothing reporting why. Nothing caught it because no
test had ever paused a table and then started it again.

Existence is now decided by `data_is_empty()` rather than by lamports, at all
three sites. With both changes:

```
release_hole 0 by its occupant                     821ms
permission on rollup: 0 lamports, 68 bytes         (public after release)
seat 0 changed hands across a pause and was re-secured for its new occupant
the read right moved with the chair, and the deal gate still guards it
```

The safety net is untouched. `start_hand` still builds `dealt_in` from
`cards_secured`, so a seat that cannot be secured for any reason sits out rather
than being dealt cards its previous occupant could read. A dead chair is a bad
table; a readable chair is a stolen pot. And the residual case — a player who
closes their tab without pausing, so their seat is never released — is no longer
silent: the table says *"this seat cannot be locked down — you will sit out;
take another seat"* instead of dealing them out with no explanation.

**Pausing used to be able to split a table in half, and the escape hatch could
be skipped.** Two defects in the client's own pause path, both found by the
two-browser gate rather than by any unit test.

Seats have to leave the rollup before the core accounts, because
`undelegate_seat` reads the table to refuse a mid-hand pull. But the deck
refuses to leave while it holds randomness for a hand that never started, so
undelegating the seats and *then* failing on the core left the table across two
layers — seats on Solana, table and deck on the rollup, and no instruction able
to work across the gap. Measured on a real table:

```
table DELEGATED   seats: base   hand/deck DELEGATED
hand# 2  shuffle_state 1 (REQUESTED)  deadline age 393s
```

`pauseTable` now checks that the whole table can leave before it takes any of it
apart, and says how long the wait is instead of stranding it.

The second was worse and was self-inflicted: `reset_shuffle` had been gated on
the client's cached hand to save a wasted transaction on healthy tables. A store
is least trustworthy exactly when a table is stuck, which is the only time the
escape hatch matters, so the optimisation could skip the recovery entirely. It
now reads the hand fresh from the chain. The stranded table above was recovered
with the same instruction, which is the first time the break-glass has been used
in anger:

```
reset_shuffle: cleared the stale draw
undelegate_core: table is back on Solana
```

## Cashing out without stopping the table, 21 August

Found by playing it: a table sat at hand 5 with two players and 19,641 chips on
it, showing "the shuffle is taking longer than it should", and pressing "Pause
table" appeared to do nothing.

**The shuffle was in a retry loop that could never succeed.** Watching the hand
account, the deadline reset every ninety seconds — `reset_shuffle` firing, a new
request going out, never being fulfilled. Hands 1 to 4 on that table had been
fine, so first requests worked and retries did not. The cause was the caller
seed: `sha256(table || hand_number)` was chosen so nobody could shop for a draw,
but a hand that fails to start never advances its number, so every retry re-sent
a byte-identical request and the oracle treated it as a duplicate. One unlucky
first draw became a table that retried forever. The slot is now in the seed, so
a retry is a genuinely new request; it stays unshoppable because none of table,
hand number or slot is the caller's to choose and the deck is private
throughout. **Not yet proven to be the whole story** — the first retry after the
fix had also not been fulfilled when it was last checked, so there may be a
second reason a draw fails.

**And pressing Pause really did nothing visible.** The click was refused, for a
good reason: the deck could not be published, and undelegating the seats anyway
would have split the table across two layers. But it said so in a toast, which
is easy to miss, and left the player looking at a table that would not close.
Pause now waits the shuffle out and clears it rather than bouncing, and says how
long it will take.

### Pause was the wrong thing to ask a player for

The deeper problem was the flow, not the bug. To cash out you had to press
"Pause table" — which reads like an admin action, stops everyone else, and only
then offers a cash out.

The constraint behind that is real and worth stating, because it is the custody
guarantee rather than an oversight: `leave_table` writes both the seat and the
player balance, `Player` is never delegated, and one instruction cannot write
across both layers. So a seat genuinely has to come off the rollup before its
chips can go home. That is exactly why the rollup can never reach anybody's
balance.

The obvious idea — a fifteen-second cash-out window after every hand — does not
survive that constraint. It would mean undelegating and re-delegating the whole
table every hand: the full delegate-and-secure sequence, which the gate measures
at about eighty seconds, plus a chunk of the ten free commits each delegation
cycle gets, plus fees, on every hand. It would make the game slower than the
problem it solves.

What works is the same idea paid for on demand instead of on a clock. **Cash
out** is now one button, available whether or not the table is on the rollup,
and it runs the whole sequence:

1. Sit out at once, so the next hand is dealt without you. `release_hole`
   already does this — giving up the read right clears `cards_secured`, and
   `start_hand` builds `dealt_in` from that. The instruction that keeps a chair
   alive for the next player turns out to be the honest way to say "deal me
   out", and because it is on chain it survives closing the tab.
2. Let the current hand finish. Nobody's pot is cut short.
3. Bring the table back to Solana.
4. Move the chips into the balance.
5. Put the table back on the rollup for whoever is still sitting, so one player
   leaving does not end everyone else's game.

Only step 3 costs anything, and it is paid once per departure rather than once
per hand. "Pause table" is now visible to the creator alone, because deleting a
table still needs it, and is no longer something a player at the table has to
reach for.

## Known problems

**50 test `Player` accounts are on chain and 48 of them cannot be removed.** They
are the leaderboard. Every chip movement needs the player's own `authority`
signature — that is the custody guarantee — and there is no `close_player`
instruction. On 20 August every table was cleared and the two players whose keys
were persisted (the two-browser gate keeps its wallets on disk) were cashed out
and emptied. The other 48 were created by `tests/session.ts` with
`Keypair.generate()` and never saved, so no key exists to sign for them and
nothing on chain ever can. They hold 481,000 unredeemable chips, fully backed in
the vault, forever. The only clean slate is a fresh program id, which `a5e6cc6`
did once before. A self-authorised `close_player` would stop the pattern
repeating but cannot retrieve these, because closing has to be authorised by the
player being closed. On mainnet the same mechanism means a genuinely lost key is
a permanently stranded balance — correct, and a reason to launch on a fresh id.

**Layout changes still break existing tables.** Unchanged, and exercised again
today: the privacy fix appended a bool to `Seat` and `Deck`, which makes every
account written by an earlier build too short to deserialize. Nothing needed
migrating because the tables were wiped first, but the underlying gap is the
same one below.

**Tables: cleared, twice.** `wipe-tables.mjs` cleared the world on 16 August. On
20 August the eight tables from the mainnet-audit devnet runs were cleared
again — four by the ordinary wipe, and the four the gate created (whose creator
was a throwaway keypair the gate happens to persist) by a new
`clear-gate-tables.mjs`, which signs as the creator so it needs no one-hour
abandonment wait. Zero tables, seats, hands, decks, holes or histories remain;
only the 50 Player accounts above.

**There is still no migration path.** Versioned accounts or a
realloc-and-migrate instruction. Acceptable for devnet, unacceptable for
anything real.

**Attestation proves hardware, not code.** `verifyTeeRpcIntegrity` verifies a
genuine Intel TDX quote bound to a fresh challenge. It does not compare the
enclave's measurements against an allowlist, so it does not prove which code is
running inside. Closing that needs an MRTD/RTMR check that is not implemented.
The trust page says so.

**Latency misses its target.** 348ms median against a sub-100ms goal. Masked
rather than solved.

**Once a shuffle is fulfilled, the table must play that hand before pausing.**
The VRF randomness for the next hand sits on the private deck, and undelegating
a deck that holds randomness is refused, because the salts are public and
republishing would let the next deal be computed. So a pause request that lands
after fulfillment waits one hand. The client retries around it; it is a corner,
not a defect, but worth knowing.

**Deleting a table is several transactions.** One per occupied seat, then one to
close. Fine for six seats, clumsy in principle.

**Abandoned tables need someone to sweep them.** Solana has no timers, so
"deleted after an hour" really means any client may remove an empty table once
it has sat idle that long. The lobby batches a couple of these into the
signature you are already giving when you create a table, so it costs nothing
and no background prompt ever appears. It also means tables are tidied at
roughly the rate they are made, not on a clock.

## What is not verified

Listed because "not tested" and "broken" are different things and the difference
matters.

- **Real wallets.** Every browser test uses an injected wallet-standard wallet
  backed by a keypair. Phantom and Solflare have never actually signed anything
  here. The interface is the standard one, so this is likely fine, and likely is
  not the same as tested.
- **Mobile, on real hardware.** The table, lobby and controls now redraw for
  narrow screens, a phone held upright gets a tall table rather than a shrunken
  wide one, and both were checked at 390px in a headless browser. No physical
  phone has opened it, and a screenshot does not test a thumb, a notch or a
  browser chrome that moves as you scroll.
- **More than two browsers at once.** The crank's collision handling is designed
  for six and tested with two in the UI, six by script.
- **Long UI sessions.** The 100-hand run was scripted. The longest UI session is
  one hand.
- **Reconnection mid-hand in the browser.** The retry and reconnect logic is
  ported from the scripted runs, but a browser losing its socket during a hand
  has not been exercised deliberately.
- **The one-hour abandoned-table sweep firing for real.** The rule is
  implemented and deployed, and deletion itself is verified end to end, but no
  table has yet sat empty for a full hour and then been swept, because the rule
  is newer than an hour.
- **Mainnet.** Nothing has ever run there.

## What is left

Roughly in the order I would do it. The first three are the mainnet gates from
[Are we ready for mainnet?](#are-we-ready-for-mainnet); the rest is hygiene.

1. **Move the upgrade authority to a multisig, or burn it.** The single most
   important item, because it is the only one whose blast radius is the whole
   vault. Squads is an afternoon. Do it before any real SOL exists.
2. **Verify with a real wallet extension.** Phantom on devnet, one hand, by
   hand. The largest gap between "tested" and "works".
3. **Exercise a seat changing hands across a pause,** which is the one path that
   could strand a re-taken seat's rent. Sit down, pause, have someone else take
   the seat, restart, confirm they get dealt in.
4. **Decide the program id question.** A fresh id is the only way to a launch
   without 50 test players on the leaderboard, 48 of them unremovable; a
   self-authorised `close_player` stops it recurring but cannot undo it.
5. **Account versioning or a migration instruction,** so a future layout change
   stops orphaning existing accounts. Until it exists, the layouts are frozen
   once real money is on them.
6. **Open it on an actual phone.** The responsive work is written and checked in
   a headless browser at 390px, which is not the same thing.
7. **A reveal timeout for salts,** the precondition for requiring one salt per
   dealt-in seat. Raising the threshold without it lets one player who commits
   and walks away freeze a table — a denial of service that needs nobody in
   place of a fairness weakness that needs collusion.
8. **Enclave measurement allowlist,** so attestation proves the code and not
   just the hardware. The biggest remaining gap in the trust story.
9. **Dependency bumps.** 24 advisories in the client's production tree, none
    reachable from client runtime code, all transitive under `@solana/web3.js`,
    wallet-adapter, `next` and the mobile-wallet-adapter chain.
10. **Multi-table and spectating,** neither of which exists.
11. **A proper hand-history replay** rather than a final-state view.

Done since this list was last written: the mainnet audit and its four fixes; the
`abandon_hand` and `reset_shuffle` break-glasses; the on-chain validator and
queue pin; the deal gate restored as an exclusion; the TEE token cut to 12 hours
and cleared on disconnect with the session key; a CSP and five security headers;
the cluster switch that derives every endpoint and refuses a mainnet build
carrying a devnet URL; and CI that runs `cargo test`, `clippy`, `tsc`, the unit
tests, a production build, the page-load check, and an IDL-drift guard on every
push. Undelegation, previously an unconditional between-hands griefing button, is
now bound to its table and refused while a hand is live — the mid-hand split and
the cross-table decoy are closed, though a `Waiting` table can still be knocked
to the base layer and simply re-delegated.

## Running it

```bash
# program
cargo test                      # 71 Rust tests
cargo clippy --workspace --all-targets --locked -- \
  -D warnings -A deprecated -A unexpected_cfgs   # what CI runs; the two allows
                                # are Anchor's own macro expansion, not our code
anchor build && npm run deploy
cp target/idl/solpoker.json app/src/lib/idl/solpoker.json    # re-vendor after
cp target/types/solpoker.ts  app/src/lib/idl/solpoker.ts     # any deploy
npm run test:er                 # 15 devnet integration tests
HANDS=3 npm run test:session    # multi-hand session, and the only test that
                                # covers Magic Actions reaching the base layer

# client
cd app
npm install
npm run dev                     # http://localhost:3000
npm test                        # 66 unit tests
npm run test:devnet             # a real hand through the client's modules
npm run test:ui                 # every page in a browser, fails on console errors
npm run gate                    # two browsers, two wallets, a real hand
node scripts/clear-tables.mjs       # delete tables this wallet created
node scripts/clear-gate-tables.mjs  # delete tables created by a gate/persisted
                                    # wallet, signing as creator (no hour wait)
node scripts/wipe-tables.mjs        # remove every table, wherever it is in its
                                    # lifecycle; run it twice, it converges
vercel --prod                   # deploy the client

# For mainnet, set NEXT_PUBLIC_CLUSTER=mainnet in the Vercel project. Every
# endpoint derives from it, and a mainnet build carrying a stale devnet URL
# refuses to start rather than talk to the wrong chain.
```

The gate needs the dev server on port 3111 and a funded wallet at
`~/.config/solana/id.json`.

Upgrading the program needs roughly 6.6 SOL free for the deploy buffer, which is
refunded afterwards, and the account must be large enough for the new binary or
the upgrade is refused outright: `solana program extend <id> <bytes>`. The
public devnet faucet is usually rate-limited; `solana airdrop 1 --url
https://rpc.magicblock.app/devnet` worked when it would not.

Re-vendoring the IDL after a deploy is not optional. The account layouts and the
error list live in it, and a stale copy makes the client send the wrong accounts
and decode the wrong bytes.

## The claim, stated accurately

Provably fair shuffle, TEE-protected hole cards. Not "provably fair poker", and
not "trustless". The shuffle is checkable by anyone with no trust required. The
hole cards rest on Intel's hardware isolation and on MagicBlock operating the
enclave honestly. `docs/TRUST_MODEL.md` covers what an enclave compromise would
expose and why mental poker was not used instead.

Two qualifications, both worth stating before someone else does.

The shuffle needs two revealed salts, not one from every seated player, so a
player who does not reveal is relying on the two who did and on the VRF. That is
unchanged, and the reason is still that raising the threshold without a reveal
deadline trades a weakness needing collusion for a denial of service needing
nobody.

And **the seed that proves the shuffle was fair also reveals every folded hand.**
"Provably fair" and "your mucked cards stay yours" are in direct tension here,
and this design currently resolves it entirely in favour of the first. A player
should know that before they sit down, which is why it is now the first thing in
`docs/TRUST_MODEL.md` rather than something a careful reader could derive.

The base-layer record is no longer a qualification: as of 20 August
`record_hand_result` will only write what is already true on chain.
