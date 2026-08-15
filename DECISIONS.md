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
