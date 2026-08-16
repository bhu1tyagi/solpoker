# SolPoker: what is built, what is verified, what is left

Written 15 August 2026. Updated 16 August 2026, after a security audit, the
fixes that came out of it, and the first public deployment. Devnet only.

This is the honest version. "Verified" below means a test or a measurement ran
and I read the result, not that the code looks right. Anything I have not
actually checked is in [What is not verified](#what-is-not-verified), and the
things I know are wrong are in [Known problems](#known-problems).

The repository is public and the client is live. One exploitable issue is
**still open**, and it is the first thing in [Known problems](#known-problems).

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

The program account was extended by 30,000 bytes on 16 August to fit the audit
fixes; the binary had outgrown its allocation and the upgrade would otherwise
have been refused. Allocated data length is now 975,544 bytes.

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

30 instructions covering the lifecycle: create, seat, delegate, secure, salt
commit and reveal, VRF request and callback, start, deal, act, advance, settle,
timeout, commit results, undelegate, leave, vacate, delete. 41 error codes.

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
`TRUST_MODEL.md` both said the deck could only be biased by the oracle *and
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

Still open. See [Known problems](#known-problems).

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

## Known problems

**Anyone can wreck a table's on-chain history, permanently. Open.** This is the
one unfixed security issue and the repository is public, so assume it is known.
`record_hand_result` authenticates nobody, `last_hand_number` only ever moves
forward, and no instruction can lower it. One transaction with a large hand
number makes every later hand look like a replay and the table never records
again. `MAX_HAND_ADVANCE` is now 100 rather than 10,000, which turns a one-shot
brick into a bounded repeatable one: damage limitation, not a fix. Funds are
unaffected; the verifiable-history claim is not.

The repair is to stop trusting the instruction arguments. `commit_results`
builds the action's account list itself, so it can pass the base-layer `Hand`
PDA alongside `history`, and `record_hand_result` can then record only values
that match it, which leaves an attacker able to write nothing that is not
already true on chain. The cost is skipping a record when the action runs ahead
of the commit, which is exactly the case `hands_recorded` is a counter rather
than a flag for. One deploy and one `HANDS=3 npm run test:session` to confirm
the account ordering.

**A seat that changes hands can keep a permission naming its previous
occupant.** That player could then read the new occupant's hole cards. The
program cannot close this by refusing to deal, which was tried and wedged a
table: a permission is only updatable by the member it already names, so once a
seat is secured while empty nobody can ever re-point it. `secure_hole` succeeds
only when the permission does not exist yet, or when the caller is already its
member, and the crank now attempts it once per seat per hand and carries on when
it fails. Closing this properly needs a way to update a permission you are
locked out of, which is a MagicBlock question rather than something this program
can decide. In practice it needs a seat to be secured, vacated, and retaken by
someone else, on a table that is never re-delegated in between.

**23 test `Player` accounts are on chain and cannot be removed.** They are the
leaderboard. The program has `close_table` but nothing to close a player, and
`tests/session.ts` creates wallets with `Keypair.generate()` and never persists
them, so the keys are gone too. `play.devnet.test.ts` already says it in a
comment: "forever with no way to close them". The only way to a clean slate is a
fresh program id, which is what `a5e6cc6` did once before. Adding a
`close_player` instruction would prevent a repeat but cannot retrieve these,
since closing has to be authorised by the player being closed.

**Layout changes still break existing tables.** Unchanged, and exercised again
today: the privacy fix appended a bool to `Seat` and `Deck`, which makes every
account written by an earlier build too short to deserialize. Nothing needed
migrating because the tables were wiped first, but the underlying gap is the
same one below.

**Legacy tables: resolved.** The five orphaned tables are gone, along with
everything else. `wipe-tables.mjs` cleared the world on 16 August and reports
zero tables remaining.

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

Roughly in the order I would do it.

1. **Close `record_hand_result`.** The only known exploitable issue, on a public
   repository. Method and cost are in [Known problems](#known-problems).
2. **Verify with a real wallet extension.** Phantom on devnet, by hand, once.
   This is the largest gap between "tested" and "works".
3. **Open it on an actual phone.** The responsive work is written and checked in
   a headless browser at 390px, which is not the same thing.
4. **A reveal timeout for salts,** which is the precondition for requiring one
   salt per dealt-in seat. Raising the threshold without it lets one player who
   commits and walks away freeze a table, trading a weakness that needs
   collusion for a denial of service that needs nobody.
5. **Account versioning or a migration instruction,** so a layout change stops
   orphaning every existing table.
6. **Decide the program id question.** A fresh id is the only way to a launch
   without 23 test accounts on the leaderboard; a `close_player` instruction
   stops it recurring but cannot undo it.
7. **Gate undelegation.** Permissionless today, so anyone can knock a table off
   the rollup between hands. Chips are safe, the table stalls. Left unfixed
   because the instruction runs on the rollup, where the base-layer config
   holding the creator is not readable, so there is no cheap identity to gate on.
8. **Credential storage in the browser.** The session key and the 30-day TEE
   token both sit in plaintext `localStorage`. Bounded at devnet stakes, since
   the session key cannot move chips or touch a wallet balance, and the fix is a
   UX tradeoff rather than a bug. Revisit before mainnet.
9. **Enclave measurement allowlist,** so attestation proves the code and not
   just the hardware. This is the biggest gap in the trust story.
10. **Dependency bumps.** 29 advisories in the client's production tree, 14 of
    them high, all transitive under `@solana/web3.js`, wallet-adapter and
    `next`. Nothing in first-party code.
11. **Continuous integration.** A public repository with a token attached should
    run `cargo test`, `clippy`, `anchor build` and `npm test` on every pull
    request, both as a signal and so a drive-by malicious change fails loudly.
12. **Multi-table and spectating,** neither of which exists.
13. **A proper hand-history replay** rather than a final-state view.

## Running it

```bash
# program
cargo test                      # 67 Rust tests
anchor build && npm run deploy
cp target/idl/solpoker.json app/src/lib/idl/solpoker.json    # re-vendor after
cp target/types/solpoker.ts  app/src/lib/idl/solpoker.ts     # any deploy
npm run test:er                 # 14 devnet integration tests
HANDS=3 npm run test:session    # multi-hand session, and the only test that
                                # covers Magic Actions reaching the base layer

# client
cd app
npm install
npm run dev                     # http://localhost:3000
npm test                        # 62 unit tests
npm run test:devnet             # a real hand through the client's modules
npm run test:ui                 # every page in a browser, fails on console errors
npm run gate                    # two browsers, two wallets, a real hand
node scripts/clear-tables.mjs   # delete tables this wallet created
node scripts/wipe-tables.mjs    # remove every table, wherever it is in its
                                # lifecycle; run it twice, it converges
vercel --prod                   # deploy the client
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
enclave honestly. `TRUST_MODEL.md` covers what an enclave compromise would
expose and why mental poker was not used instead.

Two qualifications, both from the 16 August audit, both worth stating before
someone else does. The shuffle needs two revealed salts, not one from every
seated player, so a player who does not reveal is relying on the two who did and
on the VRF. And the *record* of a finished hand on the base layer can be
disrupted by anyone, because `record_hand_result` authenticates nobody. Neither
touches whether a deal was fair, and the second does not touch chips, but
"provably fair" is a claim about evidence, and one of the places that evidence
is written is currently not defended.
