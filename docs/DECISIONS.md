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
which validator build is running. `docs/TRUST_MODEL.md` must not claim otherwise.

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

## Phase 4: TEE privacy

**Two permission shapes for two secrets.** The deck gets `is_private = true` with an
empty member list, so no wallet reads it and the enclave is the dealer. Each hole-card
account gets exactly one member, that seat's occupant. Measured on devnet: deck denied to
the creator, to a seated player and to an outsider; hole cards allowed to their owner and
denied to both an opponent and an outsider.

**Accounts are pre-funded for permission rent at creation.** A delegated PDA cannot be
topped up later, so the deck and each hole-card account receive
`rent(EphemeralPermission::size_of(n))` when they are created on the base layer. The deck
uses `size_of(0)`, hole cards `size_of(1)`.

**Only showdown hands are revealed.** Settlement copies the cards of players who reached
showdown into `Hand::revealed` and mucks everyone else. A pot won on a fold shows nothing,
the same as at a real table.

**Settlement no longer wipes the board.** The board is public by definition and the
shuffle verifier needs it. Wiping it destroyed the hand history. Only the deck and hole
cards are zeroized, which is what the commit-safety rule actually requires.

**Anchor's `fetch` does not enforce the account owner.** A delegated account can still be
decoded from the base layer, so "cannot be read" is the wrong assertion. The property that
matters, and what the test now asserts, is that the frozen base-layer copy holds no card
bytes.

## Phase 5: verifiable shuffle

**Order is the security argument.** Players commit `sha256(salt)`, then everyone reveals,
and only then is VRF drawn with a caller seed derived from those salts. Committing first
stops a player choosing a salt after seeing others. Drawing VRF last stops a player
steering the result. Deriving the caller seed from the salts stops anyone re-requesting
until they like the answer. Biasing the deck needs the oracle and every seated player to
collude.

**The verifier shares no code with the program.** `tools/verify-shuffle.mjs` reimplements
the shuffle in plain JavaScript with only `node:crypto`. Both produce
`3d 5c 7s Kd Qc 8c As Jd 4d 2d` from seed `[7u8; 32]`, and a test pins that so the two
cannot drift apart silently. If they ever disagree, published histories stop being
checkable.

**Statistical results over 10,000 shuffles.** Chi-square on card position: worst card
scored 78.0 against a critical value of 95 at p=0.001 with 51 degrees of freedom. Mean
displacement 17.34 against a uniform expectation of 17.3. A one-bit seed change left 1 of
52 cards in place, which is what two independent permutations should look like.

**`anchor_lang::solana_program` does not re-export the hash module** in this version, so
commitments use the `sha2` crate directly. That also keeps the on-chain hash identical to
the one the shuffle and the verifier use.

**Measured latency improved to 300ms min, 362ms p50, 397ms avg, 689ms max** over 12
session-key actions, with privacy enabled. Still above the sub-100ms target for the same
network-distance reason.

## Phase 6: clocks, disconnects, settlement

**The turn clock is permissionless.** `force_timeout` can be called by anyone once a
hand's deadline passes. A crank can run it on a timer, but the table must not depend on
one, so nothing breaks if the crank is down and another player calls it instead.

**Timing out checks rather than folds when nothing is owed.** A player facing no bet is
checked down, which is what a real dealer does. Folding them would cost a pot they could
have stayed in for free.

**The clock is per table, not a constant.** `TableConfig.action_timeout_secs` lets a fast
game and a slow game coexist, and lets the session test use a 2 second clock instead of
waiting 30 seconds per dropped player.

**Settlement resets the shuffle.** Without clearing `shuffle_state`, the salt XOR and each
seat's salt state, a table would reuse one deck order for every hand. Easy to miss because
the first hand looks perfect.

**Results reach the base layer through a post-commit Magic Action.** `commit_results`
commits the table and hand, then schedules `record_hand_result` on Solana to write a digest
of the hand into `TableHistory`. No separate user transaction and no relayer.

Scheduling is not execution. A failing action is stripped from its transaction strategy and
the commit retries without it, so a commit signature does not prove the action ran. The
handler is therefore idempotent (it ignores replays and out-of-order hand numbers rather
than failing) and `hands_recorded` is a counter the test reads back from the base layer.

**Committing every hand would blow the commit budget.** Each delegated account gets 10 free
commits, so a hundred-hand session that settled after every hand would run out in ten. The
session commits every 25 hands instead, which is also what a real table wants: play at
rollup speed, settle to Solana on a slower cadence. Lifting the cap properly needs the
validator-scoped fee vault and a delegated fee payer, which is not implemented.

**The board survives settlement but cards do not.** Zeroizing the board destroyed the hand
history the verifier needs, and the board is public by definition. Only the deck and hole
cards are wiped.

**Result: 100 hands, six seats, 44 minutes.** 93 player-hands dropped and 141 forced
timeouts, with nobody covering for the absent players. Zero stalls. Chip totals were
checked after every hand and never moved from 12,000. Four Magic Actions reached the base
layer, the last recording hand 100. All six players then cashed out with every faucet chip
accounted for.

**A long session on a public endpoint will lose its socket.** The first attempt died at
hand 80 with `ECONNRESET`, which is infrastructure rather than a poker bug, but the harness
treated it as fatal. Blindly resending is unsafe, because the dropped attempt may already
have landed. So each step now declares how to tell whether it is already done, and a retry
skips it rather than double-applying. The play loop simply re-reads state and decides
again, which is naturally correct.

## Phase 7: Frontend

**Session keys now sign the salt exchange too.** Betting already avoided a wallet prompt,
but committing and revealing a salt happen twice per hand, so a hand still cost two
prompts. Both instructions now take the same `session_auth_or` path as `player_action`,
with the occupant check unchanged. The salt is still generated on the player's own
machine, so the fairness argument is untouched: a session key signs the same bytes its
owner chose. What a session key can reach is still bounded by the instructions that refuse
it, and joining, leaving and the faucet all still refuse it.

**No game server, so every client runs the same crank.** Starting a hand, dealing,
advancing a street, settling and timing out are all permissionless. Rather than elect a
leader, each open client watches the same state and does whatever is next. Two things keep
that from thrashing: the steps are idempotent on chain, and a client waits a moment before
acting based on where it sits among the occupied seats, so the lowest seat usually acts
and the rest are a fallback chain. Losing the race returns a specific error, which is
treated as success rather than surfaced.

**The client reads at `processed` and renders your action immediately.** The measured round
trip is 362ms at the median, which is network distance to the Asia-only TEE region rather
than block time. Rendering the press instantly puts the confirmation inside the chip
animation. Only the amounts that are exactly known are predicted, which is all of them for
your own seat: legal actions give the call amount and the raise target outright. Whose
turn is next and whether the street closed are left to the chain, because guessing those
is where optimistic UIs start lying to people.

**Attestation runs server-side.** `verifyTeeRpcIntegrity` pulls a CommonJS verifier that
stubs node built-ins for browsers. Rather than fight the bundler, it runs in a route
handler and the client never imports the MagicBlock SDK at all. The auth handshake it
would also have provided is three HTTP calls, so that is reimplemented locally. Rejected:
shipping the verifier to the browser, which bloats the bundle to prove something the user
still has to take on trust from our own page.

**Salts live in memory first, storage second.** They were persisted only to
`localStorage`, so when storage was unavailable every call generated a fresh salt and a
player committed to one and revealed another. That is a stall on every hand for anyone
with storage blocked or full, and it showed up immediately when the flow ran outside a
browser. Found by running it, not by reading it.

**Hand history is captured while the hand is live.** Settlement clears the salt state and
the dealt-in mask, and the next hand's commit overwrites the salt bytes. A capture taken
after settlement therefore recorded a hand nobody was dealt into, which put the board at
the top of the deck and failed to verify for reasons that had nothing to do with the deal.
Both are now collected during the hand and combined with the result at the end.

**The browser is part of the test loop.** A clean build and a clean typecheck both passed
a table page that crashed on load with an infinite render loop, caused by subscribing to
the whole store and writing back into it from an effect. `npm run test:ui` loads every
page in a real browser and fails on any console error. It also greps the rendered text for
the copy we have promised not to use.

**Result.** A hand plays end to end through the client's own modules on devnet: table
created in four transactions, session keys authorised, delegation paid for by a session
key, deck and opponent cards unreadable, two independent cranks converging on a hand,
chips conserved, the shuffle verified in the browser, a tampered salt rejected, and both
players cashed out with every faucet chip accounted for.

## Phase 7 follow-up: what running the UI found

The frontend passed its module tests and still did not work. Two players sat
down and saw an empty table, then went back to the lobby and could not find the
table they had just created. Both were real, and neither was reachable without
opening a browser.

**The table page only ever read the rollup.** Before a game starts the accounts
live on the base layer, and that is where seats fill up, so a freshly created
table rendered as six empty seats to the very player sitting at one. The page
now reads whichever layer owns the accounts: base until delegation, the rollup
after. Hole cards still come only over the player's own authenticated rollup
connection.

**One legacy account emptied the lobby.** Seven tables on devnet predate
`action_timeout_secs`, so their config accounts are 82 bytes where the layout
now expects 90. Reading past the end threw, the whole listing was in one
try/catch, and a failed listing rendered as "No tables yet", which is
indistinguishable from an empty lobby. Decoding is now bounds checked, a field
past the end reads as zero, one bad row is skipped instead of taking the list
with it, and a genuine failure says so with a retry rather than lying about
being empty.

**Your own cards were face down.** The hole account is permission gated, so a
change notification for it is not something to count on, and it was the only
account with no polling fallback. When the notification did not arrive the
player watched the backs of their own cards for the whole hand.

### The seed was public for the whole hand

The worst of it was not a UI bug. The VRF output and the shuffle seed were
written to the `Hand` account, which is public and readable by anyone. Salts
are public once revealed, the seed is VRF XOR salts, and the deal is a
deterministic function of the seed, so anyone could recompute all six players'
hole cards and the whole board before a single card was turned. Publishing that
at settlement is the point of the verifier; publishing it during the hand
undoes the reason the deck is private in the first place.

Both now live on the deck, the one account nobody can read. The oracle callback
writes there, `start_hand` combines VRF with the salts inside the enclave, and
settlement copies both to the hand once they are safe. A consequence worth
noting: clients can no longer see the callback arrive, so they knock with
`start_hand` and let `ShuffleNotReady` pace the retries. Fulfillment being
invisible is itself the point.

**Undelegation was a forced-reveal button.** It is permissionless and it commits
account contents to public Solana state permanently. Nothing checked what those
contents were, so anyone could undelegate mid-hand and publish the live deck and
every hole card. The zeroize-at-settlement rule was real but it was a habit of
the client, not a guarantee of the program. Both undelegate instructions now
verify, by account type and by content, that what is leaving holds no cards, no
randomness and no seed. Mid-hand undelegation is refused for everyone.

**Settling twice corrupted the record.** Settlement is permissionless and
several clients race for it. The winner flipped the table to Waiting; a loser
arriving late re-ran against cleared seats, wiped the revealed cards and
recomputed the result hash over zero payouts. It now requires the table to still
be in a hand.

**Committing results was dead code.** `maybeCommit` existed, was correct, and
had no caller, so nothing reached the base layer until someone pressed Pause.
The cadence now lives in the hook that can read what the base layer already
recorded, and pausing commits on the way out.

**A committed salt that never revealed stalled the table forever.** The shuffle
waited for every committed seat to open its commitment, with no timeout, so a
player who committed and closed the tab held the table hostage. After long
enough the shuffle goes on without them.

**The browser is now part of the gate.** `npm run gate` drives two browsers with
two wallet-standard wallets backed by real keypairs, plays a hand through the
UI, and checks that each player sees their own cards and not the other's. The
module-level devnet test stays, because it is faster and more precise, but it
was passing throughout everything described above.

## Phase 7, third pass: the wipe, the sweep rules, and Nocturne

**Anyone may send a stale table's players home.** Tables get abandoned with
players still seated, and creators lose keys, so creator-only seat clearing
meant those seats and their chips were stuck forever. Now the creator can clear
a seat any time between hands, and anyone can once the table has been game
stale for an hour, judged by the hand's action deadline, which every real
action refreshes. The chips go to the seat occupant's own balance whoever
calls it, so the permission can move a player out of a chair but can never
take anything. Closing accepts the same staleness, so a freshly cleared husk
does not need a second hour. Vacating reads and writes the table raw, because
recovering people's chips is the one job that must not break when a layout
changes.

**The wipe is a script, and it leans on permissionlessness.** A stuck hand is
driven to settlement with the clock alone, then undelegated, then everyone is
sent home, then the table is closed. Nine tables went in one pass, including
one mid-hand with lost session keys. The safety hour means a freshly driven
table refuses to be swept for another hour, which is the rule working.

**The theme is now Nocturne.** The green and gold felt read heavy, so: ink
navy under two faint aurora washes, mint accent, petrol felt, glass surfaces
with hairlines instead of bordered boxes, radii up across the board. The
lobby's stat cards became one open strip and the explainer cards became open
columns, because a page of boxes reads as a form and a page of things resting
on a surface reads as a place.

**Waiting states show a shuffle, not a void.** Salt exchange, the enclave
drawing randomness, and the deal being prepared are all invisible by design,
which previously rendered as nothing happening. A looping riffle of card backs
now plays between hands, and long operations, delegation, securing,
undelegating, closing, dim the felt and narrate their step over it. Chain work
has no progress bar, but a table that visibly shuffles reads as busy rather
than broken.

## The economy: SOL in, SOL out

The owner reversed the play-money constraint on 16 August 2026: the point of
on-chain poker is that the buy-in is real. The spec now says so, and the
program now does.

**Every chip is backed by lamports in a program vault.** `buy_chips` moves SOL
from the wallet into a vault PDA and mints exactly what was paid for;
`sell_chips` burns chips and pays the same rate back out. The rate is a
constant in the program, 1,000 lamports per chip, so the price is not a market
and not a knob. The faucet is gone, because an unbacked chip is a claim on
someone else's deposit. Chips minted by the retired faucet were grandfathered
by seeding the vault with operator devnet SOL.

**The chip stays an internal ledger entry, not an SPL token.** Custody moving
between balance and seat only on the base layer while undelegated is the
security model, and it is property-tested. A token mint would widen the custody
surface for composability nobody asked for.

**Both sides of the trade are wallet-only.** Session keys still cannot touch
join, leave, buy or sell, so the blast radius of a leaked session key is
unchanged: bad bets at one table, nothing more.

**The honesty pass moved, not shrank.** The trust model no longer says risk is
bounded by play money, because it is not. It says the stakes are devnet test
currency today, and states plainly what becomes true if that ever changes: the
attestation gap becomes custodial risk, and real-stakes poker is regulated.
The error enum kept its dead FaucetOnCooldown variant so every existing error
code keeps its number.

## The currency: USDC in, USDC out, 24–25 August

**A stack denominated in SOL is not a stack.** A player who sat down with 200
chips and stood up with 200 chips could still be down eleven percent, because
the thing underneath the chips moved while they were playing. Deposits are USDC
now. The swap changed no account layout and no rule of the game, because every
monetary field on chain was already a chip-denominated `u64` and the currency
existed at exactly two places in the program.

**The mint is an allowlist, checked on both sides.** Opening an associated
token account is permissionless, so anybody can create the vault's account for a
mint they control; without an address check an attacker prints their own token,
buys chips with it, and sells those chips for real USDC. The program hardcodes
Circle's mainnet mint and a devnet test mint and refuses everything else in
`buy_chips` **and** `sell_chips`. The devnet mint is safe to compile into the
mainnet binary because its keypair was destroyed — creating an account at a
keypair address needs that key's signature, so the devnet entry is permanently
uninstantiable on mainnet.

**`VAULT_FLOOR_LAMPORTS` was deleted rather than converted.** It existed
because an exact-drain sell could close a system account out from under the
players. A token account's rent is its own lamports and has nothing to do with
its balance, so the floor has no analogue.

**A chip is a cent, not ten cents.** The rake had never once fired: 2.5% of a
twelve-chip pot is 0.3 chips, and the pot settles in integers, so at ten cents
a chip every pot under four dollars raked exactly nothing — which was every pot
anyone was actually playing. Only the constant changed. Redenominating is safe
only while outstanding chips are zero, which is the same window the USDC
cutover needed, so it was done the day it was noticed.

**Deploys write to a buffer keypair we keep.** A failed 1.1MB upload then
resumes instead of restarting, and the buffer's authority is the operator key
either way, so `solana program close` refunds even a buffer whose ephemeral
keypair was lost. Also `--use-rpc`, because the CLI fires program writes over
UDP by default, which is fine for a small program and not for 1.1MB; and a
priority fee of 30,000 rather than 300,000 micro-lamports per unit, because at
300k the fee across ~2,000 write transactions came to 0.49 SOL on top of the
7.69 rent.

## The front door, 27 August

**The lobby moved off `/` and a server-rendered landing page took it.** The
only way to see what this is was to first meet a wallet gate. A server
component means a stranger gets HTML on first paint and the wallet adapter
never loads.

**Three claims from the design draft were refused rather than softened.** "The
first provably fair poker platform" is banned phrasing; "zero rake" is false
and documented as false; and "4,281 players currently at the tables" was
invented. An invented player count on a real-money product is a
misrepresentation rather than a flourish, so it is absent, not replaced with a
smaller invented number.

**The onboarding gate shows one step, never a checklist of failures.** A rail
for where you are, a panel for what blocks you. Rejected: a status list, which
tells a new player four things are wrong with them.

**The gate is dismissible everywhere except under a table.** A stranger should
be able to walk around a poker room, so a scrim click, Escape and a door all
close it. A table is different: the player may have chips on a seat and a hand
in progress, and every verb on screen needs a signature they no longer have, so
a wallet disconnecting under a table locks the gate open with no way out that
would quietly do nothing.

**`useReadiness` answers for the gate, the lobby cards and the table page
alike.** The gate used to work readiness out privately, which left the lobby no
way to ask and guaranteed the two would drift.

**The deposit QR encodes a bare base58 address, not a `solana:` URI.** Exchange
withdraw screens read a bare address, and a payment URI is exactly the
cleverness that fails inside them.

**The trust page became a diagram, not prose.** Several screens of text is the
least likely shape for anyone to read before depositing. Six actors, arrows in
the direction data flows, and a colour split that carries the argument
structurally: green is checkable by anyone from public data, and the one purple
region — the enclave and what it emits — is where the player trusts hardware
and an operator instead. Drawn as a dashed wall because that is what a boundary
you cannot see into looks like. "What an attacker cannot do" became "Try to
cheat it", because framing the reader as the attacker is the most persuasive
shape this content has.

**Headings request Archivo's width axis at load time.** Without the axis the
browser fakes a 125% stretch by scaling glyphs, which is the exact cheap look
the type change replaces.

**Money is set in Satoshi, reversing the earlier rule, and the reason is
measured.** A display face was briefly swapped in whose GSUB carries one
feature, `locl`, and no `tnum` at all, so the tabular request silently did
nothing and every stack and pot would have re-measured itself as it ticked.
Money is pinned to the face whose `tnum` was verified with fontTools against
the shipped woff2. Self-hosted, because a third-party stylesheet defeats the
preloading `next/font` exists to provide.

**Icons are drawn twice, chosen by size, and the small cut is the real one.**
Almost every chip on the site is 15–22px. Three concentric rings close into a
blob by 20px, so edge spots are notched into the rim itself with butt caps
declared explicitly — the set rounds its line ends, and a round cap grows each
dash by half a stroke at both ends, which at 16px is the entire gap.

## What a lobby may say, 27 August

The governing rule, and everything else follows from it: **every figure is
derivable from public chain state or from a hand the server re-verified, so an
invented one is disprovable by anyone with an RPC call, in front of exactly the
audience that checks.**

**Absence, never a zero.** A poker room reporting $0 of volume is a lie about
liveness; reporting nothing is the truth about what is known. An average pot
over no observed pots is not zero, it is a question nobody has answered. The
dash placeholder was deleted along with its styling so no tile can render one.

**Every tile names its own window.** The chain's hand counter carries no
timestamps, so there is no honest way to ask it about the last 24 hours, and it
sits beside money figures that may be showing a day. Rejected outright:
`hands_24h > 0 ? "24h" : "all"`, which did the opposite of its intent — while
the room was quiet it showed lifetime volume, and the first hand of the day
switched every tile to a 24-hour window, so playing four hands took the
headline from $12.11 to $4.40. **A number that falls because someone played is
not a volume figure.**

**"Nobody counting" is distinguished from "nothing to count".** The payload
carries `stored`: once a database has answered, a count of zero hands is a fact
about this room and is said out loud. With no database nothing is known at all
and the chain counts stay.

**The rake bounds the pot from below and is printed as a bound.** The program
takes a fixed 250 bps of a flopped pot, so every raked chip implies at least
forty chips behind it; the cap at three big blinds and the no-flop-no-drop rule
both push the true figure above this and neither below. Hence "at least". A
bound presented as a total would be an invented number with arithmetic in front
of it.

**Table names are generated deterministically from the table id.** Tables have
no name on chain, and a deterministic name means every player sees the same one
with no server round trip. This is labelling and never invented liveness: the
name decorates a real table and never fabricates one. `displayName()` is the
seam for a registry that can supply a chosen name later.

**House play is labelled as house play.** Both wallets in `house-session.mjs`
belong to the house, so the header says so. It is real and verifiable; it is
not organic, and anyone can read the two addresses on chain.

**Rejected: fabricating a pot figure from the rake, or a 24h window from a
counter with no timestamps.** Both were available and both would have been
disprovable.

## The session float, and why mainnet had one hand, 27 August

**The session key, not the wallet, fronts delegation-buffer rent for every
account a start moves to the rollup** — and it moves all six seats whether or
not anyone is in them, because the rollup refuses to run a hand unless every
account it might touch is there. Measured on mainnet: 9.2M lamports for the
table, hand and deck, plus 6.4M per seat, so roughly 48M for a start.

The float was 0.012 SOL, sized on devnet. A fresh key cleared the old "below
0.004, top up" check untouched and was then drained by delegation, and the last
seat failed as `custom program error: 0x1` three CPIs down where nothing names
it. Raising the float to 0.15 SOL by hand did not fix it, which is what sent
the investigation elsewhere; what settled it was reading the failed transaction
on chain — `Transfer: insufficient lamports 1215920, need 1600800`.

`startTable` sizes the top-up to the work and moves it from the wallet before
delegating; `PLAY_FLOOR_LAMPORTS` went 0.018 → 0.032 → 0.06 as the measurement
was taken and then corrected, and the meters read the constant rather than
carrying a copy. The rent is refunded on undelegation, so this parks SOL rather
than spending it.

**`CREATE_TABLE_LAMPORTS` is checked before the wallet is asked to sign at
all**, because creation is three transactions and the third is the expensive
one. A wallet that runs out between them leaves a table with seats and no card
slots: it appears in the lobby, accepts players, and can never deal. That
happened on mainnet, and two people sat at that table for three hours.

**The balance a wallet reports is not the money a wallet has.** Chips live in
three places — on the seat while seated, in the `Player` balance after leaving,
and as USDC before ever buying in — and sitting down moves them from the second
to the first. Funding on the first two alone re-bought the entire stack every
run, which cost $22 of treasury USDC across two sessions before it was
understood.

## The backend that had to exist, 27–29 August

For a year this was a client with no server, and that was a design position
rather than an accident. Three things broke it, and each was worth the cost.

**The chain deliberately forgets, so something has to remember.** Hand accounts
are reused every hand, so pots and hand records cannot be recomputed from
Solana later. Clients already capture the full record at settle for shuffle
verification; they now also report it to a Postgres, fire-and-forget with
`keepalive` so the report survives the tab closing right after a hand, which is
exactly when players leave.

**Nothing is trusted as submitted.** The server re-runs the same shuffle
verification the browser runs before storing anything, so a row means the deck
provably followed from the published salts and VRF output — not that someone
said so. The verifier is pure TypeScript and runs identically on both sides.

**The whole thing is optional.** With no `DATABASE_URL` every route degrades to
nulls and the lobby renders exactly what the chain alone supports. Read under
four spellings, because providers disagree on the name and Vercel's marketplace
flow lets the installer add a prefix.

**Devnet and mainnet share a database and never share a statistic.** Every hand
is filed under its cluster and the id namespaced by it. Without that,
play-money hands inflate a real volume figure and a devnet table can silently
collide with a mainnet one on the same id.

**Hand counts are backfilled from `hand_number` and stored as a high-water
mark.** The program's own counter covers hands played before any reporting
existed. It is read on the server, because a figure the page can post to us is
a figure anyone can post to us. It is written down rather than read live
because `close_table` deletes the table account and takes the count off chain,
so a live read would silently fall whenever someone tidied a table away. The
monotonic rule is enforced in the upsert rather than trusted.

**The pot travels beside the record, not inside it.** The record is what the
verifier proves and has to stay exactly what was proven; the pot is summed from
seat state and is not provable, so it is not pretended to be. A repeat report
may raise a stored pot and never lower it, because a client that joined
mid-hand saw part of it.

**`prepare: false` is pooler safety; `max: 1` never was.** They were filed
together as though both were, and only the first is — a pooler exists precisely
so many client connections can share few server ones. Four independent
aggregates take 2170ms through one connection and 496ms through four. The
database is in us-east-1 and we are not, so a round trip costs ~250ms before
doing any work: **nothing here was a query that needed optimising, it was four
trips where one would do.**

**Secrets are guarded by the build, not by a naming convention.** Next.js only
inlines `NEXT_PUBLIC_` vars into the bundle, which is true and is one careless
import away from being wrong. `db.ts` and `funder.ts` declare `server-only`, so
importing either from a client component exits 1. Confirmed by doing it.

## One signature per session, 28 August

**`sit_down` and `stand_up` take the same session-key guard every in-game
instruction already uses,** so a wallet signs exactly once — the sit that
creates the session key — and everything after that, including the whole
cash-out, is promptless.

`stand_up` is safe outright: the account constraints pin both ends, so whatever
signs it, chips can only travel from the occupant's seat to the occupant's own
balance.

**`sit_down` is a deliberate trade, made with eyes open.** A browser-held key
may now commit the player's balance into play, where before it could only bet
what was already on a seat. The seat is still assigned to the session's own
authority and the buy-in still bounded by the table config, so the chips never
leave the player's name, but a stolen key plus a colluding opponent could put
them at risk. Judged worth it: the key already signs bets that can lose the
whole stack, and a signature on every sit was the product's single worst
moment.

**New instructions rather than changes to `join_table` and `leave_table`,** so
clients built before the deploy keep working through it. Which sets the
ordering rule: **deploy the program before shipping the client**, or a live
session tries an instruction the chain does not know yet.

## The table as a room, 28 August

**Photographs beat the model, and the 3D round was still worth running.**
Chairs went CSS → four photographed angles → a CC0 GLTF → a Chesterfield
modelled in code from primitives with procedural tufting → back to the
photographs. What the 3D round taught about light is now layered into the
*room* rather than baked into the pictures: a pool of ground shadow per chair,
far seats rendered smaller, and the room's light falling from the table's
centre. `three`, `@react-three/fiber` and `drei` arrived and left the same day.

**Nothing floats over the felt.** The raised working-overlay card is gone; the
house mark printed into the cloth turns its ring and lifts slightly while the
table works. A card over a table reads as an interruption; the table's own mark
turning reads as the room quietly at work. The same rule deleted the pot's
black pill — on cloth, emphasis is weight and light rather than chrome.

**Copy is in the language of the game.** Shuffling up, setting the table,
dealing you in — not "delegating accounts" or "moving the table into the
enclave". The machinery is still real and still explained on the fairness page.

**Lettering screened onto a table can wrap; it cannot run off the edge.** Short
labels keep wide tracking, medium ones tighten and may take a second line, and
anything longer is not upholstery at all but a sentence asking the player to do
something, so it becomes a toast with a short stand-in left behind. Before that
rule, "next hand has not started, so try reloading, or pause the table" arrived
as "...pause the TA". The corollary caught a self-inflicted case immediately: a
felt caption at 80 characters tripped the long-message rule and was promoted
into a popup.

**An empty seat says "open" and nothing else.** "sit · 3" and "sit here" were
both tried and both shout at a player who can already see which chairs are
free. The pill's background and border went with the sales pitch, so the word
is printed in the felt's own ink and six free chairs read as a calm room rather
than six buttons.

**The table is drawn at a canvas size and scaled as one object.** Fluid felt
with fixed-pixel furniture on it drew furniture too big for its own cloth at
any width under 1120px. One set of seat percentages now serves every screen;
the compact canvas is 740px because that is where phone-sized furniture takes
the same fraction of the cloth that full-size furniture takes at 1120. Bet
spots are derived against that seat's cards, the pot and the board rather than
eyeballed against its chair — the hero's bet and the hero's hand both sat at
y 71, so the chips printed across the hero's own second card.

**`layout` is wrong on anything whose children unmount routinely.** A seat pod
loses its cards at the end of every hand, and framer responded by scaling the
whole subtree and easing it back, so every avatar and name squashed and
stretched twice a hand. The pod is positioned by the felt and has nothing to
gain from layout animation; the cards and the badge reserve their own space
instead. Measured after: 0px of movement between a live hand and none.

**Folding is not a loss and not an error.** It was drawn as a black disc over
the player's face with the word in loss-red — the loudest treatment on the
table given to its least eventful event. It desaturates with a single band
now, two cues and no colour alone, and you can still see who it is. All-in
keeps its warning colour, because that one *is* an event.

**Animation beats are measured from what is being animated.** A flat 1,500ms
award beat cut split pots off mid-payment, which needs about 1,760ms —
precisely the moment a player most needs to see where the money went.

**The deck is Byron Knoll's public-domain artwork shown exactly as printed.**
Hand-drawn geometric courts lasted one look, and grafting classic courts into
our own faces doubled every symbol, because the art carries its own pips and
indices. The back stays ours and carries the house logo: a real casino brands
the back and leaves the face to the printer. Nothing about which card comes off
the deck changes.

**Two rendering traps, both non-obvious.** A chair at `z: -1` inside its seat
needs `isolation: isolate` on the parent, or the image falls behind the page
whenever framer resets the idle transform. And the global `img` max-width reset
collapses a fixed-width image inside a shrink-to-fit absolute wrapper to its
minimum size.

## Reads: push first, scan last, 28–29 August

**Websockets carry the room's news; polling is the safety net.** A table
account changes exactly when somebody joins, leaves, starts, pauses or closes
it; a player account exactly when chips move. Two program scans per six-second
tick per open tab does not survive arithmetic — fifty people in the lobby is a
scan-storm every second against a limiter that counts per second, on any plan.
Polls remain as once-a-minute reconciles, because a socket can drop events
across a reconnect and a subscription can quietly lapse.

**Table subscriptions run on both owners.** A delegating table is next written
as the delegation program's and one coming home as ours, so listening on ours
alone loses the table exactly when it becomes interesting.

**Creation-time facts are read once per table per visit.** A config is written
at creation and never after, and the deck and hole accounts that decide
`outdated` either were made with the table or never will be. Cached at module
level so a remount forgets nothing — and only cached once an account was
actually read, so one null from a flaky batch cannot freeze a table as
stakes-less for the whole visit.

**Balance subscriptions are shared per wallet, not per hook.** There are around
five copies of the hook per page and each opening its own three subscriptions
would ask the endpoint the same question fifteen times.

**Balances are cached per wallet and a miss is simply a miss.** Switching
wallets must never show the previous one's money.

**Unknown is not zero.** The gate accused funded wallets of holding nothing
because "not read yet" and "read, and empty" were the same value. It opens as
itself with skeletons now, because a skeleton claims nothing.

**Unknown stakes are shown as unknown.** The old fallbacks of 40 and 200 were
not a safe guess in either direction: at a table whose minimum is 400, the seat
button was promising a transaction that could only fail.

**A failed read leaves the last known value alone.** Reporting "not delegated"
because a read failed redraws a live game as an empty lobby, which is far worse
than briefly showing a stale one.

**Backoff is exponential with jitter.** Fixed delays are identical to the
millisecond in every browser, and a rate limit refuses several clients at once
by definition — so they all backed off together, came back together, and
re-created the burst that got them refused.

**The program scans moved to the server and then moved back.** They were moved
because `getProgramAccounts` is billed at ten credits with its own much lower
ceiling; they were moved back because the dashboards showed the room running at
0.8 requests a second with a 100% success rate. It was insurance against a
crowd that does not exist, paid for with a hop on every read. **The trade
reverses in production once that crowd arrives** — a function beside the
endpoint reads it far faster than a browser on the other side of the world can
— so the routes were deleted rather than left unused, and this note is why.

**Every RPC call is logged.** Both connections are built over a fetch that
records method, layer, account, duration and outcome into a ring buffer at
`window.__rpc`. It is what turned "the app is slow" into "`getSlot` averages
901ms here against 271ms on public mainnet-beta", which no amount of caching
addresses. Errors are classified — not-found, rate-limited, transient,
rpc-error — because they call for opposite responses, and not-found logs the
whole address, since a truncated one cannot be looked up.

## The key a browser holds, 29 August

**An RPC url a browser calls is an RPC url the world can read.** It is compiled
into the bundle because the browser genuinely has to reach an endpoint, and it
sits in the network panel for anyone to copy.

**Two keys, not one.** Server paths read `BASE_RPC` with no `NEXT_PUBLIC_`
prefix, falling back to the public variable so a single-key setup keeps
working. The public key is then locked to this site's domains and the server
key stays unrestricted and unshipped.

**Origin locking is free but not airtight, and both halves matter.** The check
happens at the provider's edge where the request already lands, so it costs no
hop — but it is browser-enforced and a script can forge the header: thirty
forged requests in a third of a second, measured. It stops other websites and
casual copying, not a determined attacker.

**Two findings from testing it changed the plan.** The lock works only on the
api-key urls; the "Secure RPC URL" subdomain serves everybody, including
`evil.example`. And the locked url is three times faster — 327ms against 948ms
on the same call, back to back — which was most of the slowness chased earlier
that week. So the server sends its own site's origin, which is not a bypass:
the key is ours, the origin is ours, and forging the header still requires the
key.

**`/api/rpc` is the overflow path, not the hot one.** Browser reads go direct
to the keyless per-IP-limited endpoint, so a single attacker is capped whatever
they do and there is nothing on that url to lift; only a 429 falls back to the
proxy where the key lives. Measured overhead: 391ms against 376ms direct.
Development routes everything through the proxy instead, because the fast
endpoint is domain-locked and Helius will not allowlist localhost.

**The proxy's ticket is built so stealing it is worth little, not so it cannot
be stolen.** Any token a browser sends is a token the browser holds, and a
fixed one in the bundle would be the key problem under a new name. So: an HMAC
over its own expiry, so it cannot be invented or extended; fifteen minutes, so
a scraped one dies quickly; minted at a separate rate-limited endpoint; and
`Sec-Fetch-Site` checked, which a browser sets and a page cannot forge.
**Nothing stops a script that mints a ticket and uses it — in a browser nothing
can.** What it stops is copying one value out of the network panel.

**Rejected: proxying every read.** Airtight, and it puts a whole round trip in
front of every call, which is the thing that week was spent removing.

## The house pays the table's rent, 29 August

**Rent-exemption for fifteen rollup accounts is not the price of playing, and a
wallet prompt cannot say so.** About 0.05 SOL with no explanation reads as the
cost of a hand; it is refunded in full when the table returns to Solana, and
the actual cost of a game is around 0.00007 SOL in fees. Two answers: the
deposit sheet explains it, and a funder wallet signs it so the player signs
nothing to start a table.

**The safety comes from where the money goes, not from who is asking.**
`delegate_core` and `delegate_seat` take the payer as their only signer, so the
funder pays directly and the lamports land in buffers owned by the delegation
program. **Rejected: transferring SOL to the player's session key**, which
would have been the opposite — a session costs about 0.014 SOL to create, so
draining 0.05 at a time would have been profitable for whoever asked most
often.

**What remains is griefing, so the checks are aimed at griefing.** The table
must exist and be ours, two players must already be seated, a table cannot be
restarted in a tight loop, and there is a daily ceiling and a kill switch.

**The funder is deliberately not the treasury authority.** It signs on demand
from a server, which is a different risk from the key that owns the house
tables and the chip vault, and it should hold a working float and nothing more.

**The client still owns the sequence and the rollback,** because undoing a
delegation happens on the rollup and needs the session key. With no funder
configured, or a float too low for a whole start, the old player-funded path
runs unchanged.

**Server-side confirmation polls rather than subscribes.**
`confirmTransaction` waits on a websocket, which in this Node build fails as
`bufferUtil.mask is not a function` and then retries forever rather than
throwing, wedging the route and every request queued behind it.

**"Already done?" is a question about the account being asked for, not about
the table.** The route checked the table's owner on every step, but
`delegate_core` is what makes the table delegation-owned — so once the core
landed, all six seat requests saw a table that was no longer ours and returned
ok having done nothing. Six successes, no seats moved, and a half-delegated
table built by the thing meant to help.

**A start waits for the accounts the next step writes to, and no others.**
Waiting on the table, hand and seats and then writing to the *hole* accounts is
how a hand went live with the whole room sat out. But listing every occupied
hole is the opposite error: the validator serves a permission-gated hole to its
member and to nobody else, so the starter polls an opponent's hole, reads null
forever, and burns its window. Our own hole stands proxy for the rest, because
every hole delegates in the same transaction as its seat.

**A hand going live mid-start is the finish line, not something to wait
through.** Every seated client runs its own crank, so somebody else can finish
the start. Cards on the felt are the proof it succeeded, which is also the
rule the UI follows: a start-phase overlay never outranks a live hand.

**A live rollup link *is* the lock being in place.** The secured badge draws
from the link and the felt was reading the on-chain `cards_secured` bit
separately, so a stale read with the link plainly live had the felt telling a
seated, playing player to go and sit somewhere else.

**Six seats delegate together.** Nothing about them is ordered — six
independent accounts, six independent transactions, and only the core has to
land first — so the wait is the slowest seat rather than the sum of six. About
eight seconds off every start.

## Transactions that land, 30 August

**Every base-layer transaction this app had ever sent paid the bare 5,000
lamport signature fee, with no priority fee and no rebroadcast.** That is the
shape a leader under load drops first, and a dropped transaction leaves nothing
to find afterwards: null from `getSignatureStatuses` with
`searchTransactionHistory` and null from `getTransaction`, on two independent
endpoints.

**`sendSolana` bids from measurement, not from a guess.** 20,000 micro-lamports
per unit over a 200,000 unit limit, against measured consumption of 125,027 and
149,027 for `DelegateCore` and 77,291–140,292 for `DelegateSeat`. Landed on
mainnet in 2,294ms for 9,000 lamports total.

**Rebroadcast sends the same signed bytes, which cannot double-apply** because
the signature is fixed at signing. And `lastValidBlockHeight` from the
blockhash is what distinguishes "not yet" from "never", so a dropped
transaction is reported as one that never happened rather than one whose fate
is unknown.

**Not yet applied to wallet-signed sends.** Join, cash out, create table and
deposits still send once at zero priority. They keep preflight on, so they fail
loudly rather than vanishing.

## A profile, and a name that is not chain state, 30 August

**A profile page is public because gating it would break the one thing a
profile is for.** It is built from hands already recorded against a public key
on a public chain, so there is nothing about it to gate.

**The display name is the first thing in the product not derived from chain
state,** so it is the first thing somebody could set on a wallet that is not
theirs. The wallet signs the exact name it is claiming, the server verifies
that signature, and the signature expires ten minutes after it was made. No
session, no cookie, no token — a signature that proves one specific claim is a
smaller thing to hold than a credential that proves identity generally.

**Telemetry reports the route, not the URL,** so a table id never leaves the
client attached to a measurement. Both packages are gated on `VERCEL_ENV` so
neither logs an error off Vercel.

**`.npmrc` pins `legacy-peer-deps` in a file rather than a flag.**
`@vercel/speed-insights` lists optional peers including `@sveltejs/kit`, which
drags vite 8 against the vite 7 vitest wants and fails the install locally and
on the build server alike. In a file, both resolve identically.

## The mark became a drawing, 30 August

**Poker charts are measured in hands, not days.** Bucketing the series by day
collapsed a three-hundred-hand session to one point, so the line between two
days was a straight interpolation and every swing inside the session was
invisible. The grain is one point per hand, thinned to at most four hundred
evenly spaced samples with the last hand always kept — so the final point is
the player's real position rather than wherever the sampling landed, and a
heavy player's history is not a megabyte of JSON.

**The identity is illustrated; the interaction language is not.** The chip ring
was the geometry the old spade-on-a-chip mark was built from, and it stayed:
turn clock, every loading state, the privacy indicator, and the print at the
centre of the felt. Replacing a brand is not a reason to replace the vocabulary
players have already learned.

**Art is trimmed to its own ink before it ships.** Untrimmed, a height in CSS
is the height of a box with transparent margin in it, so a nominally correct
34px lockup read as undersized. Trimming makes one number mean one thing.

**Pre-lit art gets no CSS lighting.** The drawing arrives with its own neon, so
the brand link has no hover glow: a second light thrown at it reads as the
image blooming rather than as the link answering. Where the product does want
motion on it — the hero — the light travels THROUGH the art's own alpha rather
than sitting on top of it.

**An illustration needs different opacities from a flat mark.** Near-white rim
light on dark green carries far more contrast than the chip it replaced, so the
numbers that read as weave for one read as a picture hung behind the board for
the other. On the felt the raccoon is a watermark that never brightens and the
ring alone answers when the room is working — which is only safe because the
loud state cannot coincide with cards on the cloth. On the card back the
greyscale came off for the opposite reason: at 40px this art's legibility IS
its rim light, and desaturating it left a smudge.

**A character cannot be a garnish on the cards.** The chip could stand in front
of them because a chip is a prop. The mascot leads the hero and the cards are
small and low in front of him. Only the face-down card turns on hover: turning
one the reader can already see is a shuffle, not a reveal, and revealing an ace
of hearts beside the ace of spades keeps exactly one of each card on the table.

**A share card is one object, not a screenshot of a page.** It used to draw a
background, float a panel on it and export both. The canvas IS the card now.

**Composition beat opacity for the mascot on that card.** He is a dark figure
on transparent, so anything dark enough to print a figure over is dark enough
to erase him — a centred stack over a centred image measured a peak luminance
of 45 out of 255. Giving the type its own column with a horizontal wipe, and
putting the gradients down as ground rather than overlay, let the art run at an
opacity where it actually reads. Nothing is drawn past the column's edge, so no
rule or figure crosses the drawing.

**Every figure on the card is fitted, not assumed.** A size chosen to look
right on the happy case runs off the column on the unhappy one, and this is the
most quotable surface the product has. The profit steps down until it fits; the
three facts are fitted as a row so one huge number shrinks all three rather
than putting three sizes in one line; and the domain sizes down and then
truncates from the front, because size-down alone bottomed out and a
ninety-character hostname still overflowed into the address beside it.

**Colour is the second signal on a result, never the only one.** Profit is
green and loss is red, and the sign stays in the string, because a posted card
gets screenshotted and recompressed and the one thing that must survive is
whether it was a win. A win keeps its glow and a loss does not — a red halo
around a bad night is rubbing it in.

**The same number twice, once large and once small, is the page arguing with
itself.** The four figures that used to sit above the profile's share card are
gone from the page; the card states them at a size nothing else competes with.
Nothing left the record — every value is still fetched, still stored, and still
on screen inside the card.

**A grid row is as tall as its tallest item, which is the wrong way round when
one item should follow another.** Holding the rewards boards to the chart's
height needed a positioning shell: as a direct child, a long board grew the row
and dragged the chart up with it — measured, a card ballooned from 273px to
1447px. Inside the shell the row is measured from the chart alone and the
boards are handed the result, cropping and scrolling to fit it.

**One control that is always there beats two that take turns.** The board's
expand icon appeared only above six rows and was hidden on touch, with a
written "Show all N" row covering for it. An affordance that comes and goes is
one nobody learns. It is a single 44px button now, on every board at every
length, for every pointer.

**A control sized to the exact minimum is a control that misses it.** At device
pixel ratio 3 layout snaps to thirds of a pixel, so an element at exactly 44px
measures 43.99 about a third of the time. Anything tappable now clears the
floor with slack rather than landing on it.

**Inline styles beat stylesheets, and a dead rule is worse than no rule.**
`Button` sets `display` inline, so the rule hiding the header CTA on phones had
never once applied — the button was on every phone header from the day the rule
was written, and it took a larger lockup being crushed to make room for it
before anyone noticed. The rule now carries `!important`, which is the only
thing that outranks an inline style.
