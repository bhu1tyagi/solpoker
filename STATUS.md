# SolPoker: what is built, what is verified, what is left

Written 15 August 2026. Devnet only.

This is the honest version. "Verified" below means a test or a measurement ran
and I read the result, not that the code looks right. Anything I have not
actually checked is in [What is not verified](#what-is-not-verified), and the
things I know are wrong are in [Known problems](#known-problems).

## In one paragraph

Six-max no-limit Texas Hold'em, fully on chain. Hands run on a MagicBlock
Ephemeral Rollup so play is sub-second, and the rollup's validator runs inside
an Intel TDX enclave so hole cards are unreadable by opponents and by anyone
watching Solana. The shuffle is a VRF draw combined with a salt from every
player, and anyone can recompute a finished deal in their browser to check it
was not rigged. Chips are bought with SOL and sold back at a fixed program
rate, backed one to one by a program vault; on devnet that SOL is test
currency. There is a working web client. Both players in a two-browser test
can play a real hand without a single wallet prompt after setup.

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

Deployed program: `CJT1DDJe5cFsSVcwTAWr3wEo7QEqNjrXwmWkw1pdxmJd`
TEE endpoint: `https://devnet-tee.magicblock.app`
Pinned validator: `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`

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

27 instructions covering the lifecycle: create, seat, delegate, secure, salt
commit and reveal, VRF request and callback, start, deal, act, advance, settle,
timeout, commit results, undelegate, leave, vacate, delete.

### The client

`app/`, a Next.js app with no game server. Lobby, table, hand history with an
in-browser verifier, and a trust page. There is no backend: starting a hand,
dealing, advancing a street, settling and timing out are all permissionless, so
every open client watches the same state and does whatever is next, staggered by
seat so they rarely collide.

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

The last three came out of an audit late in the build and are the most
important. See [What went wrong](#what-went-wrong-and-was-fixed).

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

- 48 Rust unit tests, 8 property tests, 7 shuffle-quality tests
- 62 client unit tests (engine ports, verifier, salts, decoders, optimistic)
- 14 devnet integration tests
- 1 module-level devnet play test
- 1 two-browser UI gate
- 1 page-load check that fails on any console error

## What went wrong and was fixed

Worth recording, because most of it was invisible to the tests that existed.

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

**Legacy tables.** Five tables created by earlier builds remain on chain with
account layouts the current program cannot read. They are hidden from the lobby
and cannot be played. Two still hold test chips that cannot be recovered,
because vacating a seat needs to deserialize a table that no longer
deserializes. They are inert; they are also litter.

**Layout changes break existing tables.** There is no migration path. Every time
an account layout changed during the build, every table created before it became
unplayable. That is acceptable for devnet and unacceptable for anything real,
which needs either versioned accounts or a realloc-and-migrate instruction.

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
- **Mobile and small screens.** Never opened on a phone. The table is a fixed
  16:10 box and will not adapt well.
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

1. **Verify with a real wallet extension.** Phantom on devnet, by hand, once.
   This is the largest gap between "tested" and "works".
2. **Make the table responsive.** It is unusable on a phone today.
3. **Account versioning or a migration instruction,** so a layout change stops
   orphaning every existing table.
4. **Clean up or accept the five legacy tables.** Vacating a seat needs to read
   the table raw, the way deletion already does.
5. **Enclave measurement allowlist,** so attestation proves the code and not
   just the hardware. This is the biggest gap in the trust story.
6. **A hosted deployment,** so two people in different places can play. Only
   localhost has been used.
7. **Multi-table and spectating,** neither of which exists.
8. **Sound, and a proper hand-history replay** rather than a final-state view.

## Running it

```bash
# program
cargo test                      # 63 Rust tests
anchor build && npm run deploy
npm run test:er                 # 14 devnet integration tests
HANDS=3 npm run test:session    # multi-hand session with disconnects

# client
cd app
npm install
npm run dev                     # http://localhost:3000
npm test                        # 62 unit tests
npm run test:devnet             # a real hand through the client's modules
npm run test:ui                 # every page in a browser, fails on console errors
npm run gate                    # two browsers, two wallets, a real hand
node scripts/clear-tables.mjs   # delete tables this wallet created
```

The gate needs the dev server on port 3111 and a funded wallet at
`~/.config/solana/id.json`.

## The claim, stated accurately

Provably fair shuffle, TEE-protected hole cards. Not "provably fair poker", and
not "trustless". The shuffle is checkable by anyone with no trust required. The
hole cards rest on Intel's hardware isolation and on MagicBlock operating the
enclave honestly. `TRUST_MODEL.md` covers what an enclave compromise would
expose and why mental poker was not used instead.
