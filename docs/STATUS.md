# SolPoker: what is built, what is verified, what is left

Written 15 August 2026. Updated 30 August 2026, after a week that moved the
work out of "does the protocol hold" and into "does a stranger who arrives at
the URL end up playing a hand". The program has been on mainnet since 22
August and the client has pointed at it since 24 August. Real USDC, real
hands, and — for most of that week — real reasons nobody could finish one.

This is the honest version. "Verified" below means a test or a measurement ran
and I read the result, not that the code looks right. Anything I have not
actually checked is in [What is not verified](#what-is-not-verified), and the
things I know are wrong are in [Known problems](#known-problems).

The repository is public and the client is live. As of 20 August there is no
known open fund-theft or card-leak bug: the four found in the mainnet audit are
fixed and deployed, and `record_hand_result`, open since 16 August, is closed.
Nothing found since has been a custody or leak bug; everything found since has
been a reason the game would not start, which is a different and, for a week,
more expensive class of problem.

## Where this stands

**Live on mainnet, taking real dollars, and thinly played.** pokerable.fun
serves the mainnet program at `Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker`,
chips are bought and sold for USDC at a cent each, and the treasury keeps four
house tables standing so an arriving player never has to open one alone. Every
figure the lobby prints is derived from public chain state or from hands the
server re-verified before storing.

The number worth stating plainly: **for the first five days on mainnet, exactly
one hand was ever dealt there**, and it was not a protocol failure. Starting a
table has the session key front delegation-buffer rent for all fifteen rollup
accounts, the float was sized from a devnet guess, and the last seat's
delegation failed three CPIs deep as `custom program error: 0x1` — a rollback
that correctly returned the table to Solana and told nobody why. See
[Why mainnet had one hand](#why-mainnet-had-one-hand-27-august). Since 30
August starts land, and the failures after that point were the felt lying about
what had happened rather than the chain refusing to do it.

Four things still fail the bar a real-money product should hold itself to, in
the order they matter:

1. **The upgrade authority can drain the entire vault, and it is a single laptop
   keypair.** The only risk here whose blast radius is *everyone's* money at
   once rather than one table's pot: whoever holds that key can deploy a program
   that empties the vault backing every chip. A multisig (Squads) or a burn is
   an afternoon. **Consciously deferred**, and the deferral got more expensive
   the day real USDC arrived, not less.

2. **Phantom warns on the domain.** Blowfish, the real-time scanner Phantom
   runs, shows "Request blocked — This dApp could be malicious" for
   pokerable.fun. It is a judgement on an unseen domain rather than a
   blocklist entry: `github.com/phantom/blocklist` has zero matches. The appeal
   is drafted at `docs/phantom-appeal.md` and leans on the OtterSec verified
   build. Until it clears, the first thing a new player sees is their wallet
   telling them not to.

3. **The client now has a backend, and the backend has secrets.** A funder
   wallet signs delegation on demand, a Postgres holds the hand record, and an
   RPC key sits in a server env var behind a proxy. None of that existed a week
   ago, and the whole of it is newer than any audit. The mainnet audit on 20
   August read a client with no server in it.

4. **A player who closes their tab without pausing leaves their seat
   unreleased.** The permission still names them, so the next occupant of that
   chair cannot be secured and sits out. Safe — excluded, never readable — and
   visible: the table says so and tells them to take another seat. Closing the
   last of it needs a hole PDA seeded by an occupancy counter, which costs an
   account per seat-change and has not been judged worth it.

Below those sit the launch-hygiene items that are cheaper now than later: no
account-migration path (treat the layouts as frozen, because money is on them),
the 50 orphan test players that argue for a fresh program id, and the standing
trust-model gaps (attestation proves hardware not code; the two-salt
threshold).

**Shortest honest path to a product that can be recommended to a stranger:**
multisig the upgrade authority, get the Phantom warning cleared, and put a
security pass over the server routes that did not exist when the last one ran.

## In one paragraph

Six-max no-limit Texas Hold'em, fully on chain. Hands run on a MagicBlock
Ephemeral Rollup so play is sub-second, and the rollup's validator runs inside
an Intel TDX enclave so hole cards are unreadable by opponents and by anyone
watching Solana. The shuffle is a VRF draw combined with player salts, at least
two of them, and anyone can recompute a finished deal in their browser to check
it was not rigged. Chips are bought with USDC and sold back at a fixed program
rate — a cent a chip — backed one to one by a token account the program's vault
PDA owns. The web client is live on mainnet, lays out on a phone, and after the
one signature that opens a session a player signs nothing else: sitting down,
betting, and the whole cash-out all run on a session key. The house keeps four
tables standing so nobody has to open one alone, and takes 2.5% of a flopped
pot, capped at three big blinds.

## The stack

| Layer | Choice | Version |
| --- | --- | --- |
| Chain | Solana mainnet-beta and devnet | Agave CLI 3.1.9 |
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
| Money | USDC (SPL) via `@solana/spl-token` | 0.4 |
| Hashing | `@noble/hashes` | 1.8 |
| Hand record | Hosted Postgres (Neon), `postgres` driver | 3.4 |
| Telemetry | Vercel Analytics + Speed Insights | gated on `VERCEL_ENV` |
| Browser tests | Playwright | 1.62 |
| Unit tests | Vitest, cargo test, proptest | current |

Deployed program: `Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker`
The same id on **both** devnet and mainnet-beta, so one vendored IDL serves
both and the cluster is chosen entirely by which RPC the client is pointed at.
TEE endpoint: `https://devnet-tee.magicblock.app`, `https://mainnet-tee.magicblock.app`
Pinned validator: `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` — the same
identity on both clusters, confirmed by `getIdentity` against each.
Client: <https://pokerable.fun> (mainnet)
Source: <https://github.com/bhu1tyagi/solpoker>, MIT, public

The dependency list moved in both directions this week. `three`,
`@react-three/fiber` and `drei` arrived on 28 August to render the chairs and
left the same day when photographs beat the model; `postgres`, `qrcode` and the
two Vercel telemetry packages arrived and stayed. `app/.npmrc` pins
`legacy-peer-deps`, because `@vercel/speed-insights` lists optional peers
including `@sveltejs/kit`, which drags vite 8 against the vite 7 vitest wants
and fails the install locally and on the build server alike. It lives in a file
so both resolve identically.

**22 August, later: the product is now Pokerable** (pokerable.fun, "Play poker
with SOL"), and the chip rate changed from 1,000 lamports per chip to
1,000,000 — **1 SOL is exactly 1,000 chips** — so stakes read directly in
money. The client, both test suites, and the stake presets (Micro 1/2,
Low 5/10, High 25/50, min 20 BB / max 100 BB) all carry the new rate. The
program constant is changed in source, but **neither cluster's deployed
program has the new rate yet**: an upgrade needs the ~7.31 SOL buffer
transiently, devnet's wallet holds 1.91 with the faucet dry for the day, and
mainnet's holds 1.51. Until the devnet upgrade lands, the live client's SOL
figures on buy and sell are 1,000× the lamports that actually move; chip
figures are right everywhere. Do not point a client at mainnet until the
mainnet program is upgraded to match.

**22 August, later still: devnet carries the new rate.** The previous devnet
program at `4f8UE9Bf…` was closed with the owner's approval — 7.49 SOL
reclaimed, that id burned for good — which funded the upgrade of the live
program in place. The whole upgrade cost 0.0052 SOL: the 7.31 SOL buffer is a
deposit the loader returns in the same command, which is also the answer to
"why does a mainnet upgrade need more SOL than the fees". Proven on chain
after the upgrade, not assumed: buying 10 chips moved exactly 10,000,000
lamports into the vault and selling them moved exactly 10,000,000 back.
**Mainnet was upgraded the same day**: same binary, 0.0052 SOL total with the
buffer refunded in the same command, and the same on-chain proof — 10 chips
moved exactly 10,000,000 lamports into the mainnet vault and back out. Both
clusters now run 1 SOL = 1,000 chips, byte-identical programs.

**24 August, evening: pokerable.fun is live on mainnet.** Certification was
two consecutive 27-check gates — real SOL, two isolated browsers, full hands,
verified shuffles, clean cash-outs — passed back to back on the paid RPC the
moment the last harness artifact was understood: the recurring second-run
failure was two gate players sharing one browser process's connection pool,
something no pair of real players can reproduce. The verdict probe
(scripts/vrf-verdict.mjs) settled the oracle question with signatures: four
consecutive raw-protocol runs fulfilled in 0.5-1.3s. The client the players
load is the same one certified here.

**24 August: mainnet is one steady oracle away.** MagicBlock's mainnet VRF
was confirmed fixed by their team and immediately passed a full two-browser
gate — 27 checks, two real hands, real SOL, hole cards visible, per-wallet
privacy enforced by the TEE — the first fully clean mainnet run this project
has had. The next run stalled five minutes on an unanswered randomness
request with every client-side step provably complete, so the oracle is
intermittent rather than fixed, and the cutover criterion is two consecutive
clean gates. Two operational facts learned the hard way are now load-bearing:
every browser shares one base-RPC key, so hidden tabs no longer poll and a
paid RPC tier is a launch requirement, not an optimisation; and the start
flow is resumable, because eight transactions with one flaky confirmation
must not strand a half-delegated table.

**The mainnet program is deployed but the client still points at devnet.** The
program went up on 22 August with 1,150,000 bytes allocated against a
1,049,800-byte binary, so there is ~100 KB of upgrade headroom and a redeploy
costs only fees. Its vault holds a 0.01 SOL seed, five times the floor
`sell_chips` asserts, so the first seller is not blocked. A base-layer smoke
test — init, buy 1,000 chips, sell them back — ran on mainnet and returned
every chip, with the vault moving 0.010 → 0.011 → 0.010 exactly.

Nothing else on mainnet has been exercised: no hand, no delegation, no rollup.
Switching the live client is a separate decision, and the remaining blockers
below are unchanged by the deploy.

The program moved to a fresh id on 22 August. The previous deployment, at
`4f8UE9BfWnAMLpYwpxJCNFD6HEmHwNQLtmQfhKW45tZ9`, had been extended twice to fit
growing binaries an upgrade would otherwise refuse — 30,000 bytes on 16 August
and 100,000 on 20 August — and still holds its 7.49 SOL of devnet rent. It can
be closed to reclaim that, at the cost of burning the id permanently.

**The new deployment has no headroom.** A first deploy allocates exactly the
binary size, so allocated data length is 1,049,800 bytes against a 1,049,800-byte
binary. The next upgrade that grows the binary by even one byte will be refused
until the account is extended:

```
solana program extend Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker 100000 -u devnet
```

Rent is 0.00000696 SOL/byte and identical on both clusters, so 100,000 bytes of
headroom costs 0.696 SOL. Worth buying deliberately before a mainnet deploy
rather than discovering it mid-upgrade.

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

37 instructions covering the lifecycle: create, seat, delegate, secure, salt
commit and reveal, VRF request and callback, start, deal, act, advance, settle,
timeout, commit results, undelegate, leave, vacate, delete — plus the two
break-glasses added in the mainnet audit, `reset_shuffle` and `abandon_hand`,
`release_hole`, which is how a chair survives changing hands, and the two added
on 28 August, `sit_down` and `stand_up`, which are `join_table` and
`leave_table` with the session-key guard every in-game instruction already
uses. 48 error codes. Chips are bought with USDC at a cent each, and the house
takes 2.5% of a flopped pot, capped at three big blinds.

### The client

`app/`, a Next.js app. A landing page at `/`, a lobby at `/lobby`, the table,
hand history with an in-browser verifier, a per-wallet profile, a rewards page,
tournaments (which says honestly that it is not running yet), and a trust page.

**There is still no game server, and that is unchanged**: starting a hand,
dealing, advancing a street, settling and timing out are all permissionless, so
every open client watches the same state and does whatever is next, staggered by
seat so they rarely collide. Nothing about the game's authority moved off chain
this week.

**But the client acquired a backend, and that is new.** Six API routes now do
work no browser can:

| Route | Does | Because |
| --- | --- | --- |
| `/api/hands` | stores settled hands in Postgres | the chain reuses hand accounts, so pots cannot be recomputed later |
| `/api/lobby` | aggregates the room's figures | four SQL aggregates plus a program scan, memoised and shared |
| `/api/delegate` | signs delegation from a funder wallet | so a player is not asked for 0.05 SOL of refundable rent |
| `/api/rpc`, `/api/rpc-token` | proxy the RPC behind a signed ticket | so the paid key is not in the bundle |
| `/api/profile` | display names, signature-verified | the one piece of state not derived from chain |
| `/api/attest`, `/api/table-name` | TEE attestation, deterministic table names | unchanged from before |

Nothing a route stores is trusted as submitted. `/api/hands` re-runs the same
shuffle verification the browser runs before writing a row, so a hand in the
database means the deck provably followed from the published salts and VRF
output. Devnet and mainnet share the database and never share a statistic:
every row is filed under its cluster and the id namespaced by it. With no
`DATABASE_URL` every route degrades to nulls and the lobby renders exactly what
the chain alone supports — an aggregate that cannot be known is absent, never a
fabricated zero.

Deployed at <https://pokerable.fun>. The table is now drawn at a fixed canvas
size and scaled as one object, which is how a real client does it and what lets
one set of seat percentages serve every screen; the compact canvas is 740px,
chosen because that is where phone-sized furniture takes the same fraction of
the cloth that full-size furniture takes at 1120. The media queries still live
in `globals.css` because inline styles cannot hear one, and `use-viewport`
mirrors the same breakpoints for the parts positioned in JS.

The mark is illustrated rather than drawn in code: a neon-lit raccoon in a
tuxedo, and a script wordmark beside him. It ships as three PNGs generated from
one set of sources in `app/public/new-logos` — `logo-*.png` for the mark alone,
`wordmark.png` for the horizontal lockup, `hero-mark.png` for the landing page —
plus `app/icon.png` and `app/apple-icon.png`, which Next serves as the tab and
home-screen icons by file convention. The art is pre-lit, so nothing in CSS
re-lights it and the brand link has no hover treatment at all: a second light
thrown at a drawing that already glows reads as the image blooming out, not as
the link answering the pointer.

It replaced a spade-on-a-chip mark drawn as SVG in `Logo.tsx` and duplicated in
`icon.svg`/`apple-icon.svg`. The chip ring that mark was built from did not go
with it: it still runs the turn clock, every loading state and the privacy
indicator (`ChipRing.tsx`), and it is still printed around the mark on the felt,
where it is also the table's only working indicator. The identity changed; the
interaction language did not.

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

Re-run 30 August, and these are the numbers the runners printed rather than the
numbers I remembered.

- 48 Rust unit tests, 8 property tests, 7 shuffle-quality tests, 14 program
  tests — **77 total**, up from 67
- **94 client unit tests** across 8 files, up from 62 (engine ports, verifier,
  salts, decoders, optimistic updates, the rake, and `send-solana`, which pins
  the base-layer rebroadcast added on 30 August)
- 14 devnet integration tests, plus 4 in the session run
- 1 module-level devnet play test
- 1 two-browser UI gate
- 1 page-load check that fails on any console error
- 1 design check that fails on horizontal overflow at 390px

One of those 94 was red for a day and worth naming: `decodeConfig` grew a
creator field when house tables needed telling apart from a player's own, and
the expectation was not brought along, so `npm test` had been one red since.
Fixed in `28f32f8`. A suite you have stopped reading is not a suite.

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

## Chips became dollars, 24 August

Chips were bought with SOL and sold back for SOL. That is a fine way to hold a
balance and a bad way to hold a stack: a player who sat down with 200 chips and
stood up with 200 chips could still be down eleven percent, because the thing
underneath the chips moved while they were playing. Deposits are USDC now, at a
fixed **ten cents a chip**, and a stack is worth the same at the end of a session
as it was at the start.

**What it cost to change was almost nothing, and that was not luck.** Every
monetary field on chain — balances, blinds, buy-ins, stacks, the pot, accrued
rake — was already a chip-denominated `u64`. The currency existed at exactly two
places in the program, `buy_chips` and `sell_chips`, so the swap changed no
account layout, migrated no state, and touched no rule of the game. The vault PDA
kept its seeds and its job; it simply stopped holding the money itself and
started owning the token account that does.

Three things were less obvious.

**The mint has to be an allowlist, checked on both sides.** Opening an
associated token account is permissionless, so anybody can create the vault's
account for a mint they control. Without an address check, an attacker prints
their own token, buys chips with it, and sells those chips for real USDC — the
ledger cannot tell the difference, because to the ledger a chip is a chip. The
program hardcodes two mints, Circle's on mainnet and a devnet test mint, and
refuses everything else in `buy_chips` **and** `sell_chips`.

The devnet mint is one we made and then destroyed the keypair for. That is what
makes it safe to compile into the same binary that serves mainnet: creating an
account at a keypair address requires that key's signature, so with the secret
gone the devnet entry is permanently uninstantiable on mainnet, where
`Account<Mint>` will simply find nothing there. Minting more test dollars needs
only the operator key, which we still have.

**`VAULT_FLOOR_LAMPORTS` was deleted rather than converted.** It existed because
an exact-drain sell could close a system account out from under the players. A
token account's rent is its own lamports and has nothing to do with its balance,
so the floor has no analogue; the solvency check is now just
`vault_ata.amount >= payout`.

**A wallet can afford chips it cannot buy.** USDC is what a chip costs and SOL
is what a transaction costs, and they are no longer the same asset. A wallet
holding fifty dollars and no SOL used to be impossible and is now ordinary, so
`usePlayer` reads both balances and the deposit screen says which one is
missing, before signing rather than after.

The one change with teeth outside the program was in `assertClusterMatch`. It
refused a devnet endpoint under `NEXT_PUBLIC_CLUSTER=mainnet` and said nothing
about the reverse — and the reverse is what happened here: a devnet build
inherited the paid **mainnet** RPC from `.env.local`, read every balance off the
wrong chain, reported the funded gate wallets as empty, and greyed out the
deposit button with no explanation. Two gate runs went into finding that. Both
directions throw now.

Proof, in order of how much it is worth. `scripts/usdc-smoke.mjs` buys, sells,
sells again with the seller's token account deliberately closed, and then prints
a worthless mint, opens the vault's account for it permissionlessly, and
confirms it buys nothing and redeems nothing: ten checks, green on devnet. Then
the two-browser gate, unchanged in what it asks except that the money is now
dollars — **27 of 27, no console errors**, ending in `the wallet's USDC went up
($10.20 received)`.

`scripts/cutover-preflight.mjs` is what says whether mainnet may be upgraded. It
counts chips in balances and on seats, because a chip that exists at the moment
of the upgrade quietly changes what it is worth, and refuses to say "go" until
the count is zero. As of 24 August it reports one blocker, and it is only money
in the wrong place: the write buffer for the larger binary costs 7.74 SOL and
the authority holds 6.10. The buffer is refunded when it closes.

## The USDC cutover, 24 August

pokerable.fun takes dollars now. The mainnet program is the same address it has
always been, `Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker`, upgraded in place.

Preconditions were checked rather than assumed, by `cutover-preflight.mjs`:
**zero outstanding chips** in balances and on seats, so nothing redenominated at
the moment of the swap; the binary inside the allocation bought at launch, so no
`extend`; the buffer affordable. The pre-USDC binary is kept at
`rollback/solpoker-pre-usdc-mainnet.so` and the source tagged
`pre-usdc-mainnet` — with zero chips outstanding on both sides, a downgrade
would have been clean.

**The first deploy attempt failed, and how it failed is worth recording.** 212
write transactions dropped: the CLI fires program writes at validators over UDP
by default, which is fine for a small program and not for 1.1MB. That left 7.69
SOL in an orphaned buffer whose ephemeral keypair was in output we had piped
through `tail` and lost. It was recoverable anyway — the buffer's *authority* is
the operator key, so `solana program close` returned every lamport.

The retry did three things differently. `--use-rpc`, so writes go through the
RPC instead of the transaction-processing unit. An explicit buffer keypair we
keep, so a partial upload resumes instead of restarting. And a priority fee of
30,000 rather than 300,000 micro-lamports per compute unit — the first retry
died instantly because at 300k the fee across ~2,000 write transactions came to
0.49 SOL *on top of* the 7.69 rent, more than the wallet held. The buffer's hash
was compared against the verified build before the swap, not after.

Cost of the upgrade, end to end: **0.0059 SOL**. The buffer refunded in full.

Then, in order: the vault's token account created and rent-paid by the house
rather than by whichever player deposited first; ten chips bought for a real
dollar and sold straight back, asserted to the penny in both directions;
`reclaim_legacy_vault` emptying the old SOL vault, which is now a deleted
account; the client deployed.

**The program is verifiable now, and says who to tell.** `solana-verify` builds
it reproducibly in Docker and the hash matches what is deployed, so the
"Verified: false" an explorer used to show has a real answer behind it. Getting
there needed the `3.1.14` base image: the default container's cargo is 1.84 and
cannot parse a crate that reaches the tree through `anchor-attribute-account`
1.0.2, which hard-pins `anchor-syn =1.1.2`, which wants `sha2 0.11`. It is a
build-time proc macro that never enters the binary, but it still has to compile.
security.txt is compiled in beside it, with a contact, a policy, and an honest
"Unaudited".

**Writing the on-chain PDA is only half of it, which is worth knowing before
someone else rediscovers it.** `solana-verify verify-from-repo` builds, compares
against the deployed bytes, and records the build parameters on chain — and an
explorer still shows "Program is verified: FALSE" afterwards, because explorers
do not read that PDA. They read OtterSec's registry, which only knows anything
once *their* builder has rebuilt the repo itself and agreed. Querying
`verify.osec.io/status/<program>` after the first step showed it exactly: our
`on_chain_hash` present, `executable_hash` and `repo_url` empty.

The flag that used to queue that build, `--remote`, is deprecated. The current
sequence is two commands: upload the PDA as the upgrade authority, then
`solana-verify remote submit-job --program-id <id> --uploader <the authority>`.
OtterSec rebuilt it and agreed, and the registry now answers
`"is_verified": true` with the commit it built from.

## A chip becomes a cent, 25 August

Two things were quietly wrong, and one player watching his wallet shrink
surfaced both.

**The rake had never once fired.** 2.5% of a twelve-chip pot is 0.3 chips, and
there is no 0.3 of a chip — the pot settles in integers. At ten cents a chip
that meant every pot under four dollars raked exactly nothing, which was every
pot anyone was actually playing. Two full heads-up games left the table's chip
total unchanged, and the house had earned nothing, correctly, by its own rules.

A chip is a cent now. A forty-cent pot rakes 1 chip, $1.20 rakes 3, $12 rakes
30 — 2.50% to the penny in each case. No rule changed and no account layout
moved; only the constant. Dollar stakes are identical, in ten times as many
chips: Micro is still 10c/20c blinds and a $4–$20 buy-in. It was done the day
it was noticed because outstanding chips were at zero, which is the only state
a redenomination is safe in — the same window the USDC cutover needed.

**The session float was sized for devnet.** 0.05 SOL is more than a Micro
buy-in is worth. It comes back when the key rotates, but only after someone
watches their balance drop and reasonably concludes something is taking it.
Measured against two real games, a session spends 0.0024 SOL. The float is
0.012 now.

The refill behind it was worse and had never fired: it sent **0.08 SOL whenever
the key fell below 0.05** — more than the float it was refilling — waiting for
the first player whose session ran long enough to trigger it. It is 0.010,
below 0.004.

Worth recording plainly, because it was asked and the answer took a chain trace
rather than an assurance: **nothing was taking anyone's SOL.** Fourteen
signatures cost 0.000300 SOL in total. The rest sat in a session key that
sweeps itself home, and the sweep was visible in the player's own history as an
unexplained credit.

**The deploy is worth its own note.** Devnet's public RPC could not complete a
1.1MB upload at all, and mainnet's first buffer write failed too — network
conditions, not code. What saved it was the habit picked up last deploy: write
to a buffer keypair you keep, so a failed upload resumes instead of restarting.
Two resumes brought the buffer hash to match, and no SOL was stranded. Shipping
on unit tests plus the real-money smoke test rather than a browser gate was a
deliberate, weaker choice, acceptable only because one constant changed and
outstanding chips were zero.

**Devnet is now behind mainnet** and will stay behind until its RPC cooperates.
Anyone testing there should know the rate differs from production.

## The product got a front door, 27 August

Everything up to here was a protocol with a debugging surface attached. This is
the week it became something a stranger could arrive at, and almost all of it
came from watching what a stranger actually hits.

**The lobby was living at `/`,** which meant the only way to see what this is
was to first meet a wallet gate. It moved to `/lobby` and a landing page took
the root, as a server component, so a stranger gets HTML on first paint and the
wallet adapter never loads at all.

Three claims from the design draft could not ship as drawn, and the reasons are
the same reasons that govern every number on the site. "The first provably fair
poker platform" is banned phrasing here; the honest claim is a provably fair
shuffle plus TEE-protected hole cards. "Zero rake" is false and documented as
false. And "4,281 players currently at the tables" was invented — an invented
player count on a real-money product is a misrepresentation rather than a
flourish, so it is simply absent.

**The onboarding gate shows one step at a time, never a checklist of
failures.** A rail shows where the player is; one panel shows the step that
currently blocks them. Funding steps are a process rather than a paragraph: a
token mark, a have-of-need figure, a QR code beside a copyable address, and a
visible "watching for your deposit" row, which is the balance subscription made
honest — the deposit arriving really is the next thing that happens.

The QR encodes the raw base58 address rather than a `solana:` URI, because
exchange withdraw screens read a bare address and a payment URI is exactly the
cleverness that fails inside them.

Two bugs there are worth keeping. Selecting a wallet *is* the connect request;
an earlier version also called `connect()` and lost a race, resolving while the
context sat disconnected forever, because the provider re-subscribes to the
adapter's events asynchronously. And the gate decided what to show the instant
it mounted, before `autoConnect` had resolved and before balances were read, so
a returning player was told to connect a wallet they had already connected. It
now waits for the answer to be knowable, reading the stored wallet name to know
a reconnect is coming, with a cap so a locked wallet cannot hang it.

**The gate is not a wall.** Click the ground behind it, press Escape, or take
the door, and it closes. A stranger can walk around a poker room. The refusal
that matters happens where the seat is, and a table page — which is a plain URL
that a shared link walks straight to — makes the same refusal there. Someone
already seated is never turned away whatever their balance says: chips on a
seat have to stay reachable. `useReadiness` answers for the gate, the cards and
the table alike, because the gate used to work readiness out privately, which
left the lobby no way to ask and guaranteed the two would drift.

**Arriving at a table without a wallet used to replace the table with the word
"Not yet."** No felt, no players, no way to see what you had been sent a link
to. A poker room has never had a reason to stop anyone watching. The room is
open now; only playing is gated, and clicking a chair opens the gate over the
table rather than instead of it.

**The trust page stopped being prose.** Several screens of text is the least
likely shape for anyone to read before depositing, so it is a machine diagram:
six actors, six dashed arrows in the direction data flows, and a colour split
that carries the argument structurally. Green flows are checkable by anyone
from public data; the one purple region — the enclave and everything it emits —
is where the player trusts hardware and an operator instead, drawn as a dashed
purple wall because that is exactly what it is. "What an attacker cannot do"
became "Try to cheat it", four attempts each carrying a verdict, because
framing the reader as the attacker is the most persuasive shape this content
has. The rake paragraph became a meter you drag. The footer had linked to
`/trust#shuffle` and `/trust#rake` since it was written and neither anchor
existed; both are real now.

**Tournaments exists and says it is not running yet.** One honest paragraph and
a way back to the cash tables: no fake schedule, no counterfeit bracket, no
countdown to a date nobody has committed to.

### The design system underneath it

The palette moved off the blue-cast felt onto near-black with glass panels, and
depth stopped coming from rim-light and started coming from blur and a green
glow. Headings run wide: Archivo loaded with its width axis and set at 125%
stretch, which only works because the axis is requested at load time — without
it the browser fakes the stretch by scaling glyphs, which is the exact cheap
look this replaces.

Money moved off the display face onto Satoshi, and the reason is measured
rather than aesthetic. A display face was briefly swapped in whose GSUB carries
one feature, `locl`, and no `tnum` at all, so the tabular request silently did
nothing and every stack and pot would have re-measured itself as it ticked.
Money is now pinned to the face whose `tnum` was verified with fontTools
against the shipped woff2. Satoshi is self-hosted rather than pulled from a
third-party stylesheet, which would have defeated the preloading `next/font`
exists to provide.

The chip icon took four passes and each rejection is a rule. A single fill set
to the page ground held on the felt and turned into a black blob on a green
button, so the slabs are cut with a mask and the chip is genuinely hollow.
Three concentric rings need a finer stroke than the rest of the set or they
close into a blob by 20px. Almost every instance on the site is 15–22px, so the
"detailed" drawing that only appeared at 24 and above was appearing exactly
once; the edge spots are notched into the rim itself now, with butt caps
declared explicitly, because the set rounds its line ends and a round cap grows
each dash by half a stroke at both ends — at 16px that is the entire gap and
every spot seals shut into a plain circle.

The USDC glyph was drawn by hand from memory and was missing the two arcs,
which are most of what makes that mark recognisable. It is Circle's own
artwork now, verbatim, at its native viewBox.

## Numbers a stranger can check, 27 August

The lobby's stat row read as three dashes and a 1, which is a room that has
failed rather than one that has not opened yet. Fixing that honestly took most
of a day, because the obvious fix — put a number there — is the one thing this
product cannot do: every figure is derivable from public chain state, so an
invented one is disprovable by anyone with an RPC call, in front of exactly the
audience that checks.

**The chain forgets the things a lobby wants to show.** Hand accounts are
reused every hand, so pots and hand records cannot be recomputed from Solana
later. Clients already capture the full record at settle for shuffle
verification; they now report it to a Postgres as well, fire-and-forget with
`keepalive` so the report survives the tab closing right after a hand ends,
which is exactly when players leave.

The pot in particular has no field to read. It is the sum of what the seats
have committed, and settlement zeroes those, so it is watched while the hand is
live and kept as a running maximum — a single snapshot is only that street's
total, and the notification carrying the last call can land after the one that
clears the table. It travels *beside* the record rather than inside it: the
record is the thing the verifier proves and has to stay exactly what was
proven, while the pot is summed from seat state and is not pretended to be
provable. A repeat report can raise a stored pot but never lower it, because a
client that joined mid-hand saw part of it and the fullest observation is the
right one.

**Hand counts are backfillable and pots are not.** Every table carries
`hand_number`, bumped as each hand is dealt, so the program's own tally covers
hands played before any of this reporting existed and hands whose client closed
the tab before the capture finished. It is read on the server, not taken from
the browser: a figure the page can post to us is a figure anyone can post to
us, and this one is a headline. It is written down rather than read live
because `close_table` deletes the table account, taking the count off chain
with it — so the high-water mark per table is stored and only ever moves up,
enforced in the upsert rather than trusted, and verified against the real
database by re-reporting zero (left it alone) and re-reporting more (raised
it). An unreachable RPC returns null and changes nothing, because an endpoint
that is down is not a room where nothing has been played.

Three rules came out of this and all three are load-bearing:

**Absence, never a zero.** A poker room reporting $0 of volume is a lie about
liveness; reporting nothing is the truth about what is known. An average pot
over no observed pots is not zero, it is a question nobody has answered.

**Every tile names its own window.** The counter carries no timestamps, so
there is no honest way to ask it about the last 24 hours, and it sits beside
money figures that may be showing a day.

**"Nobody counting" is not "nothing to count".** Every unknowable figure came
back null whether no database was attached or a database had answered and the
room had genuinely played nothing, so the row kept falling through to chain
counts on a machine whose database was working perfectly. The payload carries
`stored` now: once a database has answered, a count of zero hands is a fact
about this room and gets said out loud.

**And volume that goes down is not volume.** The rule was
`hands_24h > 0 ? "24h" : "all"`, meant to show recent activity when there was
any and fall back to lifetime so a quiet room did not look empty. It did the
exact opposite of its intent: while the room was quiet it showed lifetime
volume, and the moment somebody played their first hand of the day every tile
switched to a 24-hour window and the headline became those four hands alone.
Playing four hands took the lobby from $12.11 to $4.40. Nothing was lost; the
window moved underneath the number. These are cumulative figures and they say
so now.

**The rake bounds the pot from below, and only from below.** Money tiles were
dashes because a pot is only ever observed when a client stays open long enough
to report one. But rake sitting on chain already proves money went through: the
program takes a fixed 250 bps of a flopped pot, so every raked chip implies at
least forty chips of pot behind it. Rake caps at three big blinds and a preflop
hand is not raked at all, so both push the true figure above this and neither
below — which is why the tiles say "at least". A bound printed as a total would
be an invented number with arithmetic in front of it. Checked rather than
assumed: the treasury's `Player` account has `hands_played = 0` against a
minimum buy-in of 400 chips, so it has never sat down and those chips cannot be
what is left of a stack.

### A room with tables already in it

Nobody opens a poker table to sit at alone, and until now the first player had
to. Four tables opened and paid for by the treasury remove that step. Three are
the cheapest game in the room, because the table a newcomer can afford is the
only one that helps them and $4 is the smallest buy-in the program allows; the
fourth is there for anyone arriving with a bankroll.

Standing empty is the job, so the two rules that hide a deserted table no
longer apply to these — without that exemption every house table would vanish
an hour after the last player left, which is exactly when a newcomer most needs
to find one. The lobby tells them apart by the config's `creator`, a field
that has been on chain since the first build and simply was never read.

The permissionless sweep is untouched and always will be: closing an empty
table is anyone's to do and the rent goes back to whoever paid it. So
`house-tables.mjs` is a keeper, not a one-off — it counts what is standing,
opens only the difference, picks specs the room is short of rather than the
first N, and refuses to start a table it cannot finish paying for, because a
half-built table is one the lobby has to advertise as broken.

The published High tier at $2.50/$5 needed $200 to seat two players against $25
in the treasury, so the big table is sized from the bankroll instead of the
bankroll being pretended into the stakes: $0.25/$0.50, twenty big blinds at the
minimum and a hundred at the top.

**`house-session.mjs` plays real hands between two house wallets.** Real VRF,
real hole cards out of the enclave, real chips crossing the felt, real rake
taken. It writes no figure anywhere — the lobby moves because the play moved
it, and every number stays checkable on chain afterwards. It bets rather than
only calling, because checking a hand down produces a pot of exactly the blinds,
which is a real hand and a meaningless one.

The header says the thing the numbers cannot say for themselves: **both wallets
belong to the house, so this is house play, not players finding each other.**
It is real and verifiable; it is not organic. Anyone can read those two
addresses on chain. If the lobby ever shows these figures as a room full of
strangers, that is a claim the numbers will not support.

### What the runner cost to get working

Two failures, and the second one cost real money twice.

Authorising a session key is **two presses, not one**. The first opens a panel
explaining what the key can and cannot do; "Continue" is what signs. The runner
clicked the first and waited for the prompt to disappear — but the panel *is*
the prompt, so it waited forever while the table sat at READY TO START with
both players seated and nobody able to start it.

And **the balance a wallet reports is not the money a wallet has.** Chips live
in three places: on the seat while seated, in the `Player` balance after
leaving, and as USDC before ever buying in. Sitting down moves chips out of the
balance onto the seat, so a wallet mid-session reads as holding no USDC and no
chips while being fully stocked with $11 on the felt. Funding on those two
numbers alone re-bought the entire stack on every run, which is how the
treasury went from $25 to $3. It counts all three now and buys nothing that
already exists. This misunderstanding cost two separate runs and $22 of
treasury USDC; it is written down here so it costs a third nothing.

**Tearing a table down no longer asks a browser to do it.** Leaving a seat and
closing a table are two plain instructions and both wallets are held locally,
so `table-teardown.mjs` does it directly — the UI can fail for reasons that
have nothing to do with the chain, and a stuck table is exactly when that is
least welcome. Order is enforced: `leave_table` returns each stack to its
owner's balance and empties the seat, and `close_table` refuses while anyone is
still sitting. The twelve seat and hole accounts are remaining accounts, and
passing none produces `SeatOrderMismatch` rather than anything that mentions
them, so seats-then-holes in index order is part of the instruction rather than
a convention.

## Why mainnet had one hand, 27 August

This is the most expensive bug of the week and the least visible, because
nothing was lost and nothing was stuck: the table simply refused to start, was
correctly rolled back to Solana, and said nothing useful about why.

Pressing start died on

```
delegate seat 0 failed: {"InstructionError":[0,{"Custom":1}]}
```

`Custom: 1` three CPIs down, where nothing names it. Raising the session float
from 0.05 to 0.15 SOL — what the two-browser gate uses for the same work — did
not change it, so lamports looked ruled out. What actually settled it was
reading a failed transaction on chain rather than reasoning about it:

```
Transfer: insufficient lamports 1215920, need 1600800
```

**The session key, not the wallet, fronts the delegation-buffer rent for every
account a start moves to the rollup.** A fresh key holds its float, clears the
old "below 0.004, top up" check untouched, and is then drained by delegation.
Measured on mainnet: 9.2M lamports for the table, hand and deck together, plus
6.4M per seat — and it moves **all six seats whether or not anyone is in
them**, because the rollup refuses to run a hand unless every account it might
touch is there. That is roughly 48M lamports for a start. The last seat asks
for lamports the key no longer has and the whole start rolls back.

`startTable` now sizes the top-up to the work — core, plus an allowance per
seat, plus a cushion — and moves it from the wallet before delegating.
`PLAY_FLOOR_LAMPORTS` rose 0.018 → 0.032 → **0.06 SOL** as the measurement
was taken and then corrected, and the meters read the constant rather than
carrying their own copy. The rent is refunded on undelegation, so this parks
SOL rather than spending it.

This is why the entire mainnet history was a single hand: **every table but one
died here.** Verified against a real table — with the larger float it delegated
and moved onto the rollup, which no treasury-adjacent table had ever done
before.

A sibling of the same class: `CREATE_TABLE_LAMPORTS` is checked before the
wallet is ever asked to sign, because creation is three transactions and the
third is the expensive one. A wallet that runs out between them leaves a table
with seats and no card slots — it appears in the lobby, accepts players, and
can never deal. That happened on mainnet, and two people sat at that table for
three hours waiting for a hand that could not come.

## The table became a room, 28 August

A day and a half of nothing but what a player looks at. Most of it is
recorded here because the rejections are more useful than the results.

**The chairs went round a full circle.** CSS-drawn seats → four photographed
angles of a green Chesterfield → a downloaded CC0 GLTF model → the Chesterfield
modelled in code out of primitives with procedural tufting → back to the
photographs. The 3D round was not wasted: what it taught about light got
layered into the *room* instead of baked into the pictures, so every chair
stands in its own pool of ground shadow, seats farther up the screen render
smaller the way the far side of a real table sits farther from your eyes, and
the room's light falls from the table's centre — far chairs run brighter, and
the hero's back, nearest the viewer and facing away from the light, sits
darkest. `three`, `@react-three/fiber` and `drei` came and went in the same
day.

Two rendering traps worth keeping. A chair at `z: -1` inside its seat needs
`isolation: isolate` on the parent or the image falls behind the page whenever
framer resets the idle transform. And the global `img` max-width reset
collapses a fixed-width image inside a shrink-to-fit absolute wrapper to its
minimum size.

The matte took three passes. A whole-image neutral purge ate the chairs,
because dark leather in shadow is as neutral as studio floor; a greedy
enclosed-pocket cut ate the leather's own pale highlights and left them
moth-eaten. What works is surgical: a border flood for the outside, a sizeable
enclosed-region cut for the pockets it cannot reach, and a bright-neutral-only
flood confined to the bottom half for the studio floor. The corner mirrors were
also backwards — the source three-quarter faces lower-right, not lower-left —
so the top corner chairs faced away from the table.

**The seat ring moved to the classic 6-max arrangement**, hero dead centre
above the action bar, opponent top centre, corners and flanks around. The
rotation that already put you at seat 0 now seats you exactly where every poker
room seats its hero.

**An empty seat says "open".** Two instructions were tried first — "sit · 3",
then "sit here" — and both shouted at a player who is looking at a poker table
and can already see which chairs are free. It is the fact and nothing else,
printed in the felt's own ink at low opacity, so six free chairs read as a calm
room rather than six buttons. The seat is an object: a plate recessed into the
room, lit from above, with the ghost of its player inside — the same circle
every seated player occupies, so a full seat and an empty one are plainly the
same kind of thing. Hover brings the brand gradient to full and lifts the
ghost.

**Nothing floats over the felt any more.** The working overlay — a raised card
in the middle of the table — is gone. The house mark printed into the cloth is
the loading indicator: while the table works its ring turns and the mark lifts
a little out of the felt, and the words speak through the same status line as
everything else. A card over a table reads as an interruption; the table's own
mark turning reads as the room quietly at work.

The status line is white run through overlay blending, so the letters take the
cloth's own green and its lighting — brighter where the felt is lit, sunk where
it falls dark. It can wrap but must never run off the edge: short labels keep
their wide tracking, medium ones tighten and may take a second line, and
anything longer is not upholstery at all but a sentence asking the player to do
something, so it goes to a toast and leaves a short stand-in behind. Before
that rule, "next hand has not started, so try reloading, or pause the table"
arrived as "...pause the TA".

**The overlay speaks the language of the game.** Shuffling up, setting the
table, dealing you in — not "delegating accounts" and "moving the table into
the enclave". The machinery is still real and still explained on the fairness
page, where anyone who wants it can go and find it.

**Chips are drawn as chips.** SVG, a face seen at a shallow angle over a
visible clay edge, moulded spots crossing rim and edge together, an inlay ring,
and the denomination printed in the inlay of every column's top chip so a
stack's value is readable from the chips themselves. The pot pays out chip by
chip — one stream per winner, so a split pot reads as a split — with each chip
absorbed as the winner's stack counts up and the figure arriving last, after
the money.

**The deck is the real deck.** All fifty-two faces are Byron Knoll's
public-domain artwork shown exactly as printed. Two earlier attempts failed
instructively: hand-drawn geometric court figures lasted one look, and grafting
the classic courts into our own faces doubled every symbol, because the art
carries its own pips and indices. The back stays ours and carries the house
logo — a real casino brands the back and leaves the face to the printer.
Nothing about which card comes off the deck changes; these files only decide
what a card byte looks like once it is already yours to see.

### Six things a hand running end to end exposed

Recorded because none of them were visible until a hand actually completed on
the felt, which on mainnet had happened once.

- **The mark outranked the cards.** Cashing out narrates itself as "finishing
  this hand", and any narration lit the mark and set its ring turning — so
  pressing Cash out put the brightest, only moving thing on the table directly
  behind the board of a hand still being played. Cards on the cloth outrank
  whatever the room is arranging in the background.
- **Folding was drawn as a catastrophe**: a black disc over the player's face
  with the word across it in loss-red, the loudest treatment on the table given
  to its least eventful event. It desaturates with a single band carrying the
  word in the felt's own ink now, the way a mucked hand gets a line through it.
  Two cues, no colour alone, and you can still see who it is. All-in keeps its
  warning colour, because that one *is* an event.
- **Split pots were cut off mid-payment.** The award beat was a flat 1,500ms
  and a split needs about 1,760, so the second winner's chips were deleted in
  flight — precisely the moment a player most needs to see where the money
  went. The beat is measured from what is actually being animated now.
- **The pot row unmounted the instant the chips flew,** and the column is
  centred on its own middle, so losing that row jerked the board and everyone's
  cards a dozen pixels upward every single hand.
- **`layout` on a seat pod** whose cards unmount at the end of every hand made
  framer scale the whole subtree and ease it back, so every avatar and name on
  the table squashed and stretched twice a hand. Measured after: an opponent's
  seat moves 0px between a live hand and none.
- **The bet chips printed across the hero's own hole cards.** The hero's bet
  sat at y 71 and the hero's hand starts at y 71, hiding the rank of the second
  card on every street the hero bet. Every bet spot is now derived against that
  seat's cards, the pot and the board rather than eyeballed against its chair,
  and the pot's own position was corrected from y 56 — the status line — to
  where the pot is actually drawn.

## One signature per session, 28 August

Sitting down and cashing out were the last two wallet prompts in a session, and
every prompt is a place for a player to hesitate. `sit_down` and `stand_up`
accept the same session-key guard every in-game instruction already uses, so
the wallet signs exactly once — the sit that creates the session key — and
everything after that, including the entire cash-out, is promptless.

`stand_up` is safe outright: the account constraints pin both ends, so whatever
signs it, the chips can only travel from the occupant's seat to the occupant's
own balance. The most a leaked session key gains is standing its own player up
between hands.

**`sit_down` is a deliberate trade, made with eyes open.** A browser-held key
may now commit the player's balance into play, where before it could only bet
what was already on a seat. The seat is still assigned to the session's own
authority and the buy-in still bounded by the table config — the chips never
leave the player's name — but a stolen key plus a colluding opponent could put
them at risk. Judged worth it: the key already signs bets that can lose the
whole stack, and a signature on every sit was the product's single worst
moment.

They are new instructions rather than changes to `join_table` and
`leave_table`, so clients built before the deploy keep working through it. The
client tries the session path whenever a live, funded session key exists and
falls back to the wallet otherwise — which is also the ordering rule:
**deploy the program before shipping the client,** or a live session tries an
instruction the chain does not know yet.

## Push instead of poll, 28 August

The six-second listing poll was the app's biggest RPC spender — two program
scans per tick per open tab — and the leaderboard's twenty-second full scan was
the second. Neither survives arithmetic: fifty people in the lobby is a
scan-storm every second against a limiter that counts per second, on any plan.

The endpoint's websocket carries the same facts for free. A table account
changes exactly when somebody joins, leaves, starts, pauses or closes it; a
player account exactly when chips are bought, sold, or moved to and from a
seat. Both hooks build state from one initial scan and then listen — table
subscriptions on **both** owners, because a delegating table is next written as
the delegation program's and one coming home as ours, with the discriminator
filtered server-side and address re-derivation keeping out other apps'
same-named accounts.

The polls remain as once-a-minute reconciles, because a socket can drop events
across a reconnect and a subscription can quietly lapse. Measured on the lobby:
six HTTP calls in the first 25 seconds and then about four a minute, where the
old shape spent that budget every six seconds.

**Questions whose answers cannot change stopped being asked.** A table's config
is written at creation and never after, and the deck and hole accounts that
decide `outdated` either were made with the table or never will be — yet every
poll re-read all three for every table. They happen once per table per visit
now, remembered at module level so a remount forgets nothing. Config caches
only once an account was actually read, so one null from a flaky batch cannot
freeze a table as stakes-less for the whole visit.

**Three balance subscriptions answer "did my deposit arrive?"** — the player
account, the USDC account and the wallet itself — so a transfer sent from an
exchange or a phone appears the moment it confirms, in the header, the gate and
the buy-chips modal at once. Shared across every mounted copy of the hook,
because there are around five per page and each opening its own three
subscriptions would ask the endpoint the same question fifteen times.

Balances are also cached per wallet now, so the last known numbers are up
before the first read begins. Held per wallet on purpose: switching wallets
must never show the previous one's money, so a miss is simply a miss. And
`openGate` was only ever cleared by dismissing, so once anything armed it the
flag stayed armed for the whole visit — which is why walking between the lobby
and a table produced "reading your wallet's balances" every single time.
**Unknown is not zero**, and the holding card that accused funded wallets of
holding nothing is gone: the gate opens as itself with its rail and panel drawn
as skeletons, because a skeleton claims nothing.

## The endpoint was most of 29 August

A day that started as "the app is slow" and ended somewhere else entirely.
Recording it in order, because three of the four conclusions reversed an
earlier one.

**First, the logging, because everything after depends on it.** Both
connections are now built over a fetch that records every call — method, layer,
account, duration, outcome — with a ring buffer at `window.__rpc`
(summary/errors/recent/slow). It immediately showed every base-layer call
averaging 890ms. Against the endpoint directly: `getHealth`, which touches no
chain state, answers in 48ms, so the network path is fine; ten `getSlot`
samples averaged 901ms where public mainnet-beta averages 271ms for the
identical call. Errors are classified rather than lumped together, because they
call for opposite responses — not-found (an account asked of the layer it does
not live on), rate-limited, transient, rpc-error — and not-found logs the
**whole** address, because a truncated one cannot be looked up.

**A table's stakes are read, never guessed.** Sitting at one table offered a
maximum of 200 chips to a player holding 659, at a table whose real terms are
10/20 blinds and a 400–2000 buy-in. The config was on chain the whole time; one
unguarded `getAccountInfo` came back rate-limited and left the stakes unknown
for the entire visit, and the fallbacks of 40 and 200 were not a safe guess in
either direction — at a table whose minimum is 400, the seat button was quietly
promising a transaction that could only fail. Unknown stakes say so now, and
the config is read once and cached: 842ms to stakes cold, 84ms warm.

**One unguarded read could take the whole table down.** `refreshDelegation` ran
every ten seconds with nothing catching it — the only background read on the
page that had been missed. One failed call became an unhandled rejection, which
put a dialog over the table and made the seats unclickable. It reached the
browser as a bare `TypeError: Failed to fetch`, because an error response
carries no CORS headers, so a rate-limited read is indistinguishable from the
network being gone. It retries now, and **a failure leaves the last known value
alone**: reporting "not delegated" because a read failed would redraw a live
game as an empty lobby. Verified by cutting the RPC entirely for 32 seconds —
43 requests refused, zero unhandled rejections, no dialog, the table still on
screen.

Retry backoff became exponential with jitter, where it was 1.5s, 3s, 4.5s — the
same delays to the millisecond in every browser. A rate limit refuses several
clients at once by definition, so they all backed off together and all came
back together, re-creating the burst that got them refused.

**The scans moved to the server, and then moved back.** `getProgramAccounts` is
billed at ten credits against one and has its own much lower ceiling; the lobby
needed two and the leaderboard a third, in every browser. Two cached routes
fixed that, and a shared in-flight sweep fixed the cold-start burst behind it
(ten simultaneous cold requests answered in 2.2s off a single scan, against
eleven seconds and a storm of 429s before). Then the dashboards were actually
read: the room runs at 0.8 requests a second with a 100% success rate. It was
insurance against a crowd that does not exist yet, paid for with a hop on every
read, so `/api/tables` and `/api/leaderboard` were deleted. The caches they
taught us to keep stayed. **Worth knowing before the crowd arrives: this trade
reverses in production, where a function beside the endpoint reads it far
faster than a browser on the other side of the world can.**

**The lobby was slow at the database, not the endpoint. I had this wrong and
the dashboards said so.** `/api/lobby` had no cache at all — the one route of
the three that never got one — so every reader rebuilt the whole thing.
Memoising it was half. The other half: four independent aggregate queries were
awaited one after another, and issuing them together did nothing, because
`max: 1` gave the driver a single socket to queue them on. That setting was
filed next to `prepare: false` as though both were pooler safety, but only
`prepare: false` is — a pooler exists precisely so many client connections can
share few server ones. Measured on this database: the four take 2170ms through
one connection and 496ms through four. The database is in us-east-1 and we are
not, so a round trip costs about 250ms before doing any work, and the hands
table has seven rows. **Nothing here was ever a query that needed optimising;
it was four trips where one would do.** Steady-state rebuild 2350ms → 647ms,
6ms on a cache hit. The cold path is still ~11s, almost all of it Neon waking
up, which is why the phase timings now print.

### The key in the bundle

An RPC url a browser calls is an RPC url the world can read. Ours was
unrestricted: no Origin, a forged Origin and a forged Referer all answered 200.

The first move was two keys rather than one — server paths read `BASE_RPC` with
no `NEXT_PUBLIC_` prefix, falling back to the public variable so a single-key
setup keeps working — so the public key could be origin-locked at the provider
and the server key never shipped anywhere. Testing that turned up two things.
The rule works, but only on the api-key urls; the "Secure RPC URL" subdomain we
were using serves everybody, including `evil.example`. And the locked url is
**three times quicker**: 327ms against 948ms on the same call, back to back,
which was most of the slowness chased earlier that day.

Origin locking stops other websites and casual copying, not a script — measured,
thirty forged requests in a third of a second. So `/api/rpc` keeps the key on
the server: the browser calls a path on our own origin, the route holds the key
and calls Helius. It is the overflow path, not the hot one — browser reads go
direct to the keyless per-IP-limited endpoint, and only a 429 falls back to the
proxy, so the steady state pays no server hop. Measured: Secure direct 944ms,
the api-key url 376ms, the proxy over it 391ms — fifteen milliseconds of
overhead.

Development routes *everything* through the proxy, because the fast endpoint is
domain-locked and Helius will not allowlist localhost: a dev browser calling it
directly gets 403, while the proxy attaches the site's own origin and the same
endpoint answers 200.

**Then the proxy grew a ticket, and the honest framing decided its shape.** A
proxy that hides the key but lets anyone on our origin relay through it has
moved the problem, not solved it. Any token a browser sends is a token the
browser holds, and a fixed one in the bundle would be the key problem under a
new name. So the ticket is not built to be unstealable — it is built so
stealing it is worth little. It is an HMAC over its own expiry, so it cannot be
invented or extended; it lasts fifteen minutes; it is minted at a separate,
rate-limited endpoint; and the proxy also checks `Sec-Fetch-Site`, which a
browser sets and a page cannot forge. **None of this stops a script that
fetches a ticket and uses it — in a browser nothing can.** What it stops is the
cheap case, copying one value out of the network panel. Verified: no token 401,
valid 200, forged 401, expired 401, and a real page mints once and relays five
calls with no rejects.

Verified against a production build: **zero bundle chunks contain the key or
even the string "api-key"**, where the keyless Secure url is present as
expected.

**Leaking a server secret is a build error now.** The funder's key and the
database password are safe today because Next.js only inlines `NEXT_PUBLIC_`
vars into the bundle — verified, not assumed, by grepping the built chunks for
the key bytes, the `FUNDER_` variable names and the database host, all absent
while the prefixed RPC url is present as expected. But that protection is a
naming convention, and a convention is one careless import away from being
wrong. Both modules declare `server-only`. Confirmed by doing it: a client page
importing the funder exits 1.

## The house pays the table's rent, 29 August

Starting a table parks rent-exemption for fifteen accounts in the delegation
program's buffers, and the player was being asked for it — a wallet prompt for
about 0.05 SOL with no explanation and no way to tell a refundable deposit from
the price of playing. A player who is not told this reasonably concludes the
game costs fifty times what it does and stops before finding out otherwise.
(The actual cost of a game is fees, around 0.00007 SOL.)

Two answers shipped. The deposit sheet says what the money is before asking for
it. And a funder wallet signs those delegations, so **a player signs nothing to
start a table.**

The safety comes from where the money goes, not from who is asking.
`delegate_core` and `delegate_seat` take the payer as their only signer, so the
funder pays directly and the lamports land in buffers owned by the delegation
program — they never pass through an account the caller controls. The obvious
alternative, transferring SOL to the player's session key, would have been the
opposite: a session costs about 0.014 SOL to create, so draining 0.05 at a time
would have been profitable for whoever asked most often.

What is left is griefing rather than theft — starting tables nobody will play,
to lock the float up in buffers — so the checks are aimed at that: the table
must exist and be ours, two players must already be sitting at it, a table
cannot be restarted in a tight loop, and there is a daily ceiling and a kill
switch. **The funder is deliberately not the treasury authority.** It signs on
demand from a server, which is a different risk from the key that owns the
house tables and the chip vault, and it should hold a working float and nothing
more.

Server-side confirmation polls instead of subscribing: `confirmTransaction`
waits on a websocket, which in this Node build fails as
`bufferUtil.mask is not a function` and then retries forever rather than
throwing, wedging the route and every request queued behind it.

### The funder told six seats they were already delegated

**This is why a started table dealt nobody in, and it was mine.** The route
checked the *table's* owner on every step to decide whether there was anything
left to pay for — but `delegate_core` is precisely what makes the table
delegation-owned, so once the core landed, all six seat requests saw a table
that was no longer ours and returned ok having done nothing. Six successes, no
seats moved.

Found by reading the chain rather than the code: table, hand and deck on the
rollup, all six seats and holes on the base layer — exactly the half-delegated
table the start's rollback exists to prevent, built by the thing meant to help.
"Already delegated" is a question about the account being asked for now. A seat
step asks about its own seat, and a delegated table is what it should expect to
find.

`recover-table.mjs` pulls a half-delegated table back: seats first where any
are on the rollup, then the core, then waits for the commit to land. Used on
mainnet table 1787822983190680, which is whole again.

### Three more ways a start lied about itself

**The start wrote to accounts it never waited for.** It waited for the table,
the hand and the seats to arrive on the rollup, then wrote to the *hole*
accounts. A hole that had not landed failed its secure, its seat was recorded
unsecured, and with both players in that state the table went live with the
whole room sat out. It was never an ownership problem: `secure_hole` rebuilds a
seat's permission every call to name its current occupant, so an occupied chair
is always securable — the program says so and this was read from it. The catch
that recorded a seat as unsecured also swallowed the reason, which made this
the one failure in the sequence a report could not explain.

**Then the fix overcorrected.** Listing every occupied hole in the wait put the
starter directly against the rule in the comment above it: the validator serves
a permission-gated hole to its member and to nobody else. The permission exists
from the moment a player sits down, so the starter polled the opponent's hole,
read null forever, and burned its whole window — while delegation flipped
`delegated` true on every seated client within one poll and *their* cranks
finished the start. A hand was visibly live on the felt, blinds posted, cards
secured, while the status said "setting the table" and thirty seconds later the
starter announced the table had been returned to Solana. None of it was true.
The wait list carries our own hole only, which still stands proxy for the rest
because every hole delegates in the same transaction as its seat. **A hand
going live mid-wait is the finish line crossed by somebody else, not something
to wait through** — and the felt gets the rule as a backstop: a start-phase
overlay never outranks a live hand, because cards on the felt are the proof the
start succeeded.

**Starting took twelve to fifteen seconds** because the seats were delegated
one at a time, each turn costing a check and a send waited out to confirmation.
Nothing about them is ordered — six independent accounts, six independent
transactions, and only the core has to land first. The checks collapse into one
batched read and the sends go together, so the wait is the slowest seat rather
than the sum of six. About eight seconds off every start.

**And the felt stopped contradicting the secured badge.** A seated player
mid-game, with the HUD showing CARDS SECURED, was being told by the felt to get
up: "this chair is still locked — try another seat." The badge draws "secured"
from the rollup link being live, which is the authenticated connection that
reads your hole cards; the felt read the on-chain `cards_secured` bit
separately, and a stale read of it with the link plainly live left the felt
handing a playing player advice that would have cost them their seat. A live
link *is* the lock being in place.

Two more non-events stopped being dressed up as faults. A table spends a few
seconds with its accounts split across two layers while it starts or pauses;
the crank has always swallowed that, but an action pressed inside the same
window took a different path out and reached the screen as "this table is
part-way between Solana and the game validator" in the middle of an otherwise
successful start. And `ws error: undefined` is web3.js reporting a dropped
subscription socket — a browser WebSocket error event carries no message, so
that string is the whole of it — which Next's dev overlay promoted to a
full-screen dialog. It is a warning now, matched on that exact string and
nothing else.

## Send to Solana like we mean it, 30 August

A start failed in production and left no trace on chain. The house funder
signed `DelegateCore`, the RPC handed back signature `3dW6zeGq…`, and the
transaction was never included in any block — null from `getSignatureStatuses`
with `searchTransactionHistory`, null from `getTransaction`, on two independent
endpoints. The route waited its thirty seconds, said "core did not confirm",
returned 502, and the client correctly rolled back a start that had never
begun. Nothing was lost and nothing was broken; the table simply could not
start, and pressing the button again rolled the same dice.

**Every base-layer transaction this app has ever sent paid 5,000 lamports** —
the bare signature fee, no priority fee at all — and was broadcast exactly once
with no rebroadcast. That is the shape a leader under load drops first, and
when it is dropped there is nothing to find afterwards.

`sendSolana` is the base-layer sibling of `sendEr`. It bids at a floor of
20,000 micro-lamports per unit over a 200,000 unit limit — measured, not
guessed: `DelegateCore` has consumed 125,027 and 149,027 units, `DelegateSeat`
77,291 to 140,292. It keeps the same signed bytes going out every two seconds,
which cannot double-apply because the signature is fixed at signing. And it
tells "not yet" from "never" using the blockhash's own
`lastValidBlockHeight`, so a dropped transaction is reported as one that never
happened rather than one whose fate is unknown.

Proved on mainnet before shipping: landed in 2,294ms for a fee of 9,000
lamports, being the 5,000 base plus the 4,000 the bid costs.

**The wallet-signed sends are not covered yet.** Join, cash out, create table
and deposits still send once at zero priority. They keep preflight on, so they
fail loudly instead of vanishing, but they can be dropped the same way and are
next.

## A player has a profile, 30 August

A public page per wallet, built from hands already recorded against a public
key on a public chain, so there is nothing about it to gate — and gating it
would break the one thing a profile is for, which is being shown to somebody
else.

**The display name is the first thing in the product that is not derived from
chain state,** so it is also the first thing somebody could set on a wallet
that is not theirs. The wallet signs the exact name it is claiming, the server
verifies that signature, and the signature stops being good ten minutes after
it was made. No session, no cookie, no token.

The rewards page is reworked around the same grammar — stat cards, tabular
figures, one glow per region — with a line chart, skeletons in place of empty
boxes while the data is still arriving, and boards that end at the same height
so thin data reads as thin data rather than as a layout bug. `hand_players`
grew a `contributed_chips` column, added the same idempotent way as the rest of
the schema.

Speed Insights joined Analytics, both gated on `VERCEL_ENV` so neither logs an
error off Vercel. It reports the route rather than the URL, so a table id never
leaves the client attached to a measurement.

## The room got a face, 30 August

### A day is the wrong grain for a poker graph

Both series were bucketed by day in the database, so a session of three hundred
hands collapsed to one point and the line between two days was a straight
interpolation. Every swing inside the session — the whole thing a player opens
the chart to see — was invisible, and the graph could only ever look linear.

The grain is one point per HAND now. Running totals come from a window over the
hands in settle order, then the result is thinned to at most four hundred
evenly spaced samples: forty hands gets all forty, forty thousand gets a
detailed line rather than a payload measured in megabytes. The last hand is
always kept, so the final point is the player's real current position rather
than wherever the sampling happened to land. The x axis is hands recorded
rather than the calendar, which is what every poker tracker uses — a week away
belongs absent from the shape rather than drawn as a flat stretch that reads as
a losing streak. The dates ride in the tooltip.

### The mark became a drawing

The identity is illustrated now, and the sizing came with it. The three source
renders are trimmed to their own ink before shipping, so a height in CSS is the
height of the DRAWING rather than of a box with air around it — untrimmed, a
nominally correct 34px header lockup read as undersized because a third of it
was transparent margin. The whole shipped set is smaller than the single
`logo.png` it replaces.

The felt needed the opposite treatment from everywhere else. An illustration
carries far more contrast than the flat chip it replaced — near-white rim light
against dark green — so the opacities that read as weave for the old mark read
as a picture hung behind the board for this one. The raccoon is a grey
watermark that never brightens (0.08 at its loudest, 0.015 while cards are
out), and the ring alone answers when the room is working. That split is safe
because `tableBusy` is `roomWorking && !showBoard`: the loud state cannot
coincide with cards on the cloth, so a legible ring is never a ring competing
with a hand.

The card back kept the mark and lost the greyscale. The old treatment was right
for a flat chip; this art's whole legibility at 40px is its purple-and-cyan rim
light, and desaturating it left a smudge. Opacity alone does the dimming.

The hero inverted. A chip is a prop and can stand in front of the cards; a
character cannot be a garnish on them. He is large, centred and at the BACK of
the stage with two small cards low in front of him, and hovering turns the
face-down card up to reveal an ace of hearts beside the ace of spades already
showing — only that one card turns, because turning one the reader can already
see is a shuffle rather than a reveal. The neon moves: a band sweeps up through
the art's own alpha, masked to the smoke and the script so it never crosses his
face, and the whole effect is behind `@supports (mask-composite)` because
without compositing the mask layers add and paint a bright rectangle.

### The share card is one object

It used to draw a page — a background, a rounded panel floating on it — and
export the whole thing, so what a player posted was a screenshot of a card
rather than the card. It is full bleed now, edge to edge, with the app's own
gradients inside it.

Making the mascot the background took a composition change rather than an
opacity. He is a dark figure on transparent, so a centred stack over a centred
image left him at a peak luminance of **45 out of 255** — measurably invisible,
because anything dark enough to print a figure over is dark enough to erase
him. The type has its own column with a horizontal wipe under it; the gradients
are ground rather than overlay, so the green rising from the bottom right is
light BEHIND him; and nothing is drawn past the column's edge, so no rule or
figure crosses the drawing. He measures 230 now.

Every figure on it is fitted rather than assumed. The profit steps its own size
down until it fits the column, so an eight-figure night stays inside it; the
three facts are fitted as a ROW so one huge number shrinks all three together
rather than putting three sizes in one line; and the domain sizes down and then
truncates from the front, keeping the registrable domain, because size-down
alone bottomed out and a ninety-character hostname still overflowed 181px into
the address beside it. Profit is green and loss is red, but the sign stays in
the string — a posted card gets screenshotted and recompressed, and the one
thing that has to survive that is whether it was a win.

### Two pages laid out around it

The profile leads with the share card, with the figures it does not carry
beside it. The four that used to sit above it — net, hands, won, biggest pot —
are gone from the page because the card already states them at a size nothing
else competes with; the same number twice, once large and once small, is the
page arguing with itself. Nothing left the record: every one of those values is
still fetched, still stored, and still on screen inside the card. Both charts
share a row, because they share an x axis and are read against each other.

Rewards took the same shape. The headline column is narrower — it holds one
number and a line of type, and the width belongs to whichever half has more in
it — and all eight figures sit in one block beside it. Two of them were already
on the page in worse places: the rake total was buried in the sentence under
the headline, and the token-fee share was filed under "Your share" when it is a
programme-wide rule that applies to everyone.

The chart and the two boards share the row below, boards stacked. They are held
to **equal heights taken from the chart**, which needed a positioning shell: a
grid row is as tall as its tallest item, so with the boards as a direct child a
long list made the row grow and dragged the chart up to match. Measured with 28
rows cloned into one board, the card ballooned from 273px to 1447px and the
chart stretched to 2910. Inside the shell the card holds 273, both boards stay
equal, and the list scrolls internally. Each board crops to its height, shows
its head, and opens in full over the page — one 44px control, present on every
board whatever its length, because an affordance that appears at six rows and
up is one nobody learns.

### Three floors that were not being met

`Button` sets `display` as an INLINE style, so the rule hiding the header CTA
on phones had never once applied. That button has been on every phone header
since the rule was written; it only became visible when the larger lockup
started being crushed to make room for it.

Two buttons were 40px against a 44px floor, and the brand link had landed on
exactly 44 — which measures 43.99 about a third of the time at device pixel
ratio 3, so a control sized to the exact minimum is a control that misses it on
some device. All three now clear it with slack.

## Known problems

**Phantom shows a malicious-dApp warning on pokerable.fun.** Blowfish, the
real-time scanner Phantom runs, is making a risk judgement on a domain it has
never seen; `github.com/phantom/blocklist` has zero matches, so there is
nothing to request removal of. The fix is evidence and time rather than a
takedown: an appeal to `review@phantom.com`, drafted at
`docs/phantom-appeal.md`, leaning on the OtterSec verified build and the
absence of any token, presale or airdrop. Until it clears, the first thing a
new player sees is their own wallet telling them not to proceed. **This is
currently the largest single obstacle between the product and a user.**

**`design-check` fails on elements that meet the spec.** It measures tap
targets at device pixel ratio 3, where layout snaps to thirds of a pixel, and
compares with a strict `height < 44`. An element that is exactly 44px — the
menu toggle, a chart chip, the board's expand control, anything sized to
`--touch-target` — measures 43.99 often enough that the check is red on most
runs and names a height of "44px" while failing it. The elements are correct
and the assertion is not; the fix is an epsilon (`< 44 - 0.5`) at
`scripts/design-check.mjs:198`, deliberately left alone because loosening a
quality gate is not a change to make on somebody else's behalf.

**`ui-check` fails `/` on selectors that no longer match anything.** It expects
`h1:has-text('Pokerable')`, a `[aria-label='How this works']` link, and a
`button` matching "Connect" — the landing h1 has always read "The deck is
on-chain", the trust link carries no such label, and the CTA is an anchor
rather than a button. Three stale expectations rather than three regressions;
every other page in that check passes.

**`app/public/new-logos/` ships 5.4MB of source art to production.** The three
originals the shipped set was generated from live inside `public/`, so Next
serves them alongside the derived copies that are actually used. They belong
somewhere versioned but unserved — `design/logos/` — and it is one `git mv`.

**The server routes are newer than any audit.** A funder wallet that signs
delegation on request, a Postgres holding the hand record, an RPC proxy with a
minted ticket, and a signature-verified name endpoint all arrived on 27–30
August. The mainnet audit on 20 August read a client with no server in it.
Nothing here touches custody — the funder pays into delegation-program buffers
and never through an account a caller controls, and `/api/hands` re-verifies
every hand before storing it — but "reasoned about carefully while writing it"
is not the same as "read by someone looking for a way in".

**The funder is a hot key on a server.** Deliberately not the treasury
authority, deliberately holding a working float and nothing more, and fenced
with a daily ceiling, a kill switch, a restart-rate limit and a requirement
that two players already be seated. The residual risk is griefing — starting
tables nobody will play, to lock the float up in buffers — and the ceiling is
what bounds it rather than anything cleverer.

**The RPC ticket is a speed bump, stated as one.** Any token a browser sends
is a token the browser holds. The HMAC-over-expiry ticket cannot be invented or
extended and dies in fifteen minutes, and `Sec-Fetch-Site` refuses cross-site
use, but nothing stops a script that mints a ticket and uses it. What it buys
is that the cheap attack — copying a value out of the network panel — stops
working, and everything else becomes traffic through endpoints we rate-limit.

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
same one below. **This now matters differently: real chips are on mainnet
accounts, so the layouts are frozen rather than merely inconvenient to
change.**

**The devnet cluster is behind mainnet and getting further behind.** The chip
rate diverged on 25 August when devnet's public RPC could not complete the
1.1MB upload, and every deploy since has gone to mainnet first. Anyone testing
on devnet should treat it as a different product.

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

- **A hand played end to end on mainnet by two strangers.** The house session
  runner plays real hands between two wallets the house owns, and the
  two-browser gate plays them with injected keypairs. Neither is two people who
  found each other.
- **Real wallets, mostly.** Phantom has certainly *seen* the site — it is
  warning on the domain — but every browser test still uses an injected
  wallet-standard wallet backed by a keypair, and no extension has been driven
  through a full sit-bet-cash-out here. The interface is the standard one, so
  this is likely fine, and likely is not the same as tested.
- **The two-browser gate has not run since the design rebuild.** The table it
  drives was redrawn from the felt up between 27 and 30 August, and the gate
  asserts on things a player looks at. Assume it needs repair before it is
  trusted again — every previous rebuild broke it in exactly one selector.
- **Mobile, on real hardware.** The table is drawn at a canvas size and scaled
  as one object now, which is a better answer than the old breakpoint pair, and
  it was checked at 390px in a headless browser. No physical phone has opened
  it, and a screenshot does not test a thumb, a notch or a browser chrome that
  moves as you scroll.
- **The funder route under any load.** Its ceiling, kill switch and
  restart-rate limit are written and reasoned about; none has been driven to
  its limit deliberately.
- **The RPC proxy under a real burst.** The direct-to-429-to-proxy fallback was
  verified once by forcing a 429 by hand. It has never carried a crowd.
- **More than two browsers at once.** The crank's collision handling is designed
  for six and tested with two in the UI, six by script.
- **Long UI sessions.** The 100-hand run was scripted. The longest UI session is
  a handful of hands.
- **Reconnection mid-hand in the browser.** The retry and reconnect logic is
  ported from the scripted runs, but a browser losing its socket during a hand
  has not been exercised deliberately.
- **The one-hour abandoned-table sweep firing for real.** The rule is
  implemented and deployed, and deletion itself is verified end to end, but no
  table has been observed sitting empty for a full hour and then being swept.

## What is left

Roughly in the order I would do it. The first four are what stands between this
and a product that can be recommended to a stranger; the rest is hygiene.

1. **Move the upgrade authority to a multisig, or burn it.** The single most
   important item, because it is the only one whose blast radius is the whole
   vault. Squads is an afternoon. Real money has been on it since 24 August,
   which means this is now overdue rather than pending.
2. **Get the Phantom warning cleared.** The appeal is drafted at
   `docs/phantom-appeal.md` and needs sending to `review@phantom.com`. Nothing
   downstream of the front door matters while the wallet is telling people to
   turn around.
3. **Security-review the server routes.** `/api/delegate`, `/api/hands`,
   `/api/rpc`, `/api/rpc-token` and `/api/profile` are all newer than the last
   audit, and the funder is a hot key that signs on request.
4. **Repair and re-run the two-browser gate,** then keep it green. It is the
   only check that has ever caught a table that passes every test and cannot be
   played, and it has caught exactly that three separate times.
5. **Priority fees and rebroadcast on the wallet-signed sends.** `sendSolana`
   covers the funder's transactions; join, cash out, create table and deposits
   still send once at zero priority and can vanish the same way.
6. **Decide the program id question.** A fresh id is the only way to a room
   without 50 test players on the leaderboard, 48 of them unremovable; a
   self-authorised `close_player` stops it recurring but cannot undo it. The
   window for this closes as real balances accumulate.
7. **Account versioning or a migration instruction,** so a future layout change
   stops orphaning existing accounts. Until it exists, the layouts are frozen —
   and real chips are already on them.
8. **Open it on an actual phone.**
9. **A reveal timeout for salts,** the precondition for requiring one salt per
   dealt-in seat. Raising the threshold without it lets one player who commits
   and walks away freeze a table — a denial of service that needs nobody in
   place of a fairness weakness that needs collusion.
10. **Enclave measurement allowlist,** so attestation proves the code and not
    just the hardware. The biggest remaining gap in the trust story.
11. **Bring devnet back level with mainnet,** or say plainly on the site that it
    is not.
12. **Dependency bumps.** Advisories in the client's production tree, none
    reachable from client runtime code, all transitive under `@solana/web3.js`,
    wallet-adapter, `next` and the mobile-wallet-adapter chain.
13. **Multi-table and spectating,** neither of which exists.
14. **A proper hand-history replay** rather than a final-state view.

Done since this list was last written: the whole of the 27–30 August work above
— a landing page and an onboarding gate, a lobby that reads as a room, house
tables so nobody sits alone, a Postgres hand record whose every row is
re-verified server-side, `sit_down`/`stand_up` so a session costs one
signature, a funder that pays the delegation rent a player used to be asked
for, websocket subscriptions in place of the polling that would not have
survived fifty people, the RPC key out of the bundle behind a ticketed proxy,
priority fees and rebroadcast on every server-sent transaction, and the session
float finally sized from a mainnet measurement rather than a devnet guess —
which is what turned mainnet from one hand ever dealt into a table that starts.

Two items from the old list are closed. **Seats changing hands across a pause**
is exercised: `release_hole` plus the `data_is_empty()` existence check were
verified on devnet on 20 August, and the residual case (a tab closed without
pausing) is documented and visible in the UI rather than silent. **Mainnet**
is no longer unverified — it is where the product lives.

## Running it

```bash
# program
cargo test                      # 77 Rust tests (48 unit, 8 property,
                                # 7 shuffle-quality, 14 program)
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
npm install                     # .npmrc pins legacy-peer-deps; see The stack
npm run dev                     # http://localhost:3000
npm test                        # 94 unit tests
npm run test:devnet             # a real hand through the client's modules
npm run test:ui                 # every page in a browser, fails on console errors
npm run design                  # layout check; fails on horizontal overflow at 390px
npm run gate                    # two browsers, two wallets, a real hand

# operating the room
node scripts/house-tables.mjs       # open house tables up to the target count;
                                    # counts what stands and opens the difference
node scripts/house-session.mjs      # two house wallets play real hands
node scripts/table-teardown.mjs     # empty and close a table without a browser
node scripts/recover-table.mjs      # pull a half-delegated table back to Solana
node scripts/rewards-snapshot.mjs   # rewards figures off chain + database
node scripts/sweep-rake.mjs         # move accrued rake to the treasury
node scripts/clear-tables.mjs       # delete tables this wallet created
node scripts/clear-gate-tables.mjs  # delete tables created by a gate/persisted
                                    # wallet, signing as creator (no hour wait)
node scripts/wipe-tables.mjs        # remove every table, wherever it is in its
                                    # lifecycle; run it twice, it converges

vercel --prod                   # deploy the client, FROM THE REPOSITORY ROOT.
                                # The project's Root Directory is `app`, so
                                # running this from app/ looks for app/app.
```

### Environment

`NEXT_PUBLIC_CLUSTER` picks the chain and every endpoint derives from it; a
mainnet build carrying a stale devnet URL refuses to start rather than talk to
the wrong chain. Beyond that, three groups of variables, and the split between
them is load-bearing:

| Variable | Side | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_BASE_RPC` | browser | Keyless, per-IP-limited. Assume the world can read it. |
| `BASE_RPC` | server only | The api-key url. Origin-locked at the provider, and three times faster for it. Never shipped. |
| `RPC_TOKEN_SECRET` | server only | HMAC key for the fifteen-minute proxy ticket. |
| `SITE_ORIGIN` | server only | Sent as `Origin` so the locked key accepts our own backend. |
| `FUNDER_SECRET_KEY` / `FUNDER_KEYPAIR_PATH` | server only | The wallet that pays delegation rent. `FUNDER_DISABLED` is the kill switch. |
| `DATABASE_URL` | server only | Also read as `POSTGRES_URL`, `STORAGE_URL`, `DATABASE_POSTGRES_URL`, because providers disagree on the name. Absent means every aggregate degrades to null. |

`db.ts` and `funder.ts` both declare `server-only`, so importing either from a
client component is a build failure rather than a leak discovered later.

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

Three qualifications, all worth stating before someone else does.

The shuffle needs two revealed salts, not one from every seated player, so a
player who does not reveal is relying on the two who did and on the VRF. That is
unchanged, and the reason is still that raising the threshold without a reveal
deadline trades a weakness needing collusion for a denial of service needing
nobody.

**What is proven is the board, not the hand you were shown.** Until 20 August
the published seed proved the entire deal and, in doing so, published every
folded hand — "provably fair" and "your mucked cards stay yours" were in direct
tension and the design resolved it entirely in favour of the first. Two
independent VRF draws fixed that: the board draw is published at settlement and
verifiable by anyone, the hole draw is never published and is wiped at hand
end. The cost is real and is the qualification: **a shown hand can no longer be
proven to be the hand the deck dealt.** The verifier still checks the board
against the seed, and checks that a shown card is a real card, is not on the
board, and was not also shown by someone else, but there is no derivation left
to pin it to. That is exactly what `docs/TRUST_MODEL.md` has always claimed.

**And the room's figures are real but they are not organic.** The lobby's
volume, hand count and pot sizes come from hands that genuinely happened on
chain and were re-verified before being stored — and a large share of them were
played between two wallets the house owns, by `house-session.mjs`, with both
addresses readable by anyone. The house-play header says so on the page. If
those figures are ever presented as a room full of strangers finding each
other, that is a claim the numbers will not support.

The base-layer record is no longer a qualification: as of 20 August
`record_hand_result` will only write what is already true on chain.
