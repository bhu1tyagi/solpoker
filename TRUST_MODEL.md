# Trust model

Written for someone who does not want to be cheated and does not take marketing
copy at face value. It says what SolPoker actually guarantees, what it only
claims, and what breaks if a given assumption is wrong.

## The one-line version

**SolPoker is not trustless.** The shuffle is provably fair and you can check it
yourself. Your hole cards are protected by Intel TDX and MagicBlock's TEE
validator, which is a hardware and operator assumption, not a mathematical one.

The honest phrase is "provably fair shuffle, TEE-protected hole cards". Anyone
saying "provably fair poker" or "trustless poker" about this system is
overstating it.

## What you can verify yourself

**The shuffle.** Every hand publishes the raw VRF output, every player's salt,
each player's prior commitment to that salt, and the final seed. Run:

```bash
node tools/verify-shuffle.mjs hand-history.json
```

That script shares no code with the program. It recomputes the deck from scratch
and checks each salt against its commitment, that the seed really is
`VRF XOR salts`, and that the cards dealt match. If the operator rigged a deck,
this fails.

Why the deck cannot be steered:

1. Every player commits `sha256(salt)` before anyone reveals anything.
2. Everyone reveals. The commitments bind them, so nobody can pick a salt after
   seeing someone else's.
3. Only then is VRF drawn, with a caller seed derived from the salts, so nobody
   can re-request until they like the answer.
4. Seed is `VRF XOR salt_1 XOR ... XOR salt_n`.

Biasing it requires the VRF oracle **and every seated player** to collude. One
honest player is enough to keep it fair.

**Chip conservation.** Chips only move between a player's balance and a seat
stack on the base layer, while the table is undelegated. During a hand the
rollup can move chips between seats but cannot change the table total, mint a
chip, or reach anyone's balance. This is enforced by Solana account ownership.

**The rules.** Hand evaluation, betting and side pots live in a separate crate
with no Solana dependencies, covered by property tests asserting chips are
conserved across any legal action sequence and that pots always sum to
contributions.

## What you are trusting

### Intel TDX

Hole cards are unreadable because the TEE validator refuses to serve them.
That rests on Intel's hardware isolation. A TDX break, side-channel attack, or
vulnerability in the enclave firmware would expose cards.

This is not hypothetical in general. TEEs have had real breaks. It is a
meaningful assumption, not a formality.

### MagicBlock as validator operator

The TEE validator runs the game. If the enclave is compromised, or if the
operator can extract memory from it, the operator sees:

- every hole card at every table, live
- the deck order before cards are dealt

That is total information. Someone with it could play perfectly against you, or
sell the feed. Nothing on chain would look wrong, because the cards would still
match the published seed. **Shuffle verification does not detect this.**

### Attestation proves hardware, not code

The client calls `verifyTeeRpcIntegrity` before trusting the endpoint. Be precise
about what that buys: it verifies a genuine Intel TDX quote bound to a fresh
challenge. It does **not** compare the enclave's measurements against an expected
allowlist, so **it does not prove which code is running inside**.

So attestation tells you "this is real TDX hardware", not "this is running the
validator build I expect". Closing that gap needs an MRTD/RTMR allowlist check
that is not implemented. Until it is, do not read attestation as proof of the
software.

### Liveness

If the TEE validator goes down mid-hand, the table stops. State commits back to
Solana and chips are safe, but the hand does not finish until the rollup returns.

## What an attacker cannot do

- **Another player** cannot read your hole cards. Each hole-card account carries
  an `EphemeralPermission` whose only member is that seat's occupant. Measured,
  not assumed: an authenticated request from a different wallet returns nothing.
- **Anyone reading Solana** sees no cards. Card accounts are delegated and
  private during play, and the deck and all hole cards are zeroized at hand end
  before any commit can carry them back.
- **The operator cannot rig the deck** without every player colluding, per above.
- **A leaked session key** can make bad betting decisions at the one table it was
  scoped to. It cannot cash out, move chips to a balance, or join another table,
  because those paths are wallet-only.

## Why not mental poker

Mental poker (threshold ElGamal with zero-knowledge shuffle proofs) removes the
hardware assumption. It is the cryptographically honest answer and we are not
using it, so here is why.

Every card reveal needs a multi-party decryption round trip, and the ceremony
grows with player count. Worse, a player who disconnects mid-hand takes their key
share with them and **the hand stalls**. Every shipped implementation bolts on
timeouts and key escrow, which quietly reintroduces trust anyway.

Making the enclave the dealer turns a disconnect into an ordinary auto-fold. The
hand continues without them, exactly like a real table. That is the concrete
advantage, and it is why this approach is buildable and mental poker has not
shipped at scale.

The trade is explicit: we swapped a cryptographic assumption for a hardware and
operator assumption, and got liveness in return.

## Play money

Chips are non-purchasable and non-redeemable. The faucet is the only source and
no instruction converts them to SOL, a token, or anything of value.

This is not incidental. It bounds every risk on this page: if the enclave is
compromised tomorrow, the cost is a spoiled game rather than stolen money. A
real-money variant would need a materially stronger story than this document
describes, starting with the attestation gap above.

## Summary

| Property | Guarantee |
| --- | --- |
| Shuffle fairness | Verifiable by anyone, no trust needed |
| Chip conservation | Enforced by Solana account ownership |
| Rules correctness | Property-tested, deterministic |
| Cards hidden from opponents | Trusts Intel TDX plus the validator operator |
| Cards hidden from the operator | Trusts TDX isolation, and attestation does not check the code |
| Hand completes if you disconnect | Yes, auto-fold, unlike mental poker |
| Funds at risk | None, play money only |
