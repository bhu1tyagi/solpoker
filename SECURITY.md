# Security policy

Pokerable holds real money. The program at
`Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker` custodies the USDC backing every
chip in play, so a bug in it is somebody's balance rather than somebody's
afternoon. Reports are welcome and taken seriously.

## Reporting

**Email bhuwantyagi2000@gmail.com**, or open a private advisory at
<https://github.com/bhu1tyagi/solpoker/security/advisories/new>.

Please do not open a public issue for anything that could move funds, reveal
hole cards, or wedge a table with chips on it. Give us a chance to ship a fix
first; we will not sit on it.

Useful things to include, in rough order of how much they help:

- what an attacker gets, in one sentence
- the transaction or account state that demonstrates it, on devnet if possible
- which instruction and which check you believe is missing or wrong

Devnet is open and the test mint is ours, so a proof of concept costs nothing
to run. `app/scripts/usdc-smoke.mjs` is a working example of driving the
program directly if you want a starting point.

## What we will do

- Acknowledge within **72 hours**.
- Tell you honestly whether we think it is exploitable, and why.
- Fix anything that can move funds or expose cards as fast as we can deploy,
  and say publicly what happened afterwards.

There is no bug bounty programme. This is a small project and pretending
otherwise would be dishonest. Credit in the acknowledgements below is what we
can offer, and we will offer it to anyone who wants it.

## Scope

**In scope**

- The on-chain program under `programs/solpoker` — custody, the rules engine,
  delegation, the shuffle protocol, the session-key surface.
- The client under `app/` where it handles keys, signs, or displays balances.
- Anything that lets one player see another's hole cards.

**Out of scope, and already documented rather than hidden**

These are known and written up in `docs/TRUST_MODEL.md` and `docs/STATUS.md`.
Reporting them is not a finding, though arguing that our reasoning is wrong very
much is:

- **The shuffle seed reveals every folded hand.** The seed that makes the
  shuffle provably fair also reconstructs the hole cards of players who mucked.
  "Provably fair" and "your mucked cards stay yours" are in tension and this
  design currently resolves it entirely toward the first.
- **Hole-card secrecy rests on Intel TDX and on MagicBlock operating the
  enclave honestly.** Attestation checks the hardware, not our code, and the
  client does not currently run it at all.
- **The upgrade authority is a single key on one laptop.** It can replace the
  program that holds the vault. A multisig is a known and deliberate omission,
  not an oversight.
- **No age gate, jurisdiction check, or terms of service.** Real-money poker is
  a licensed activity in most places and none of that is implemented.

## Verifying what is deployed

The deployed binary is meant to be reproducible from this repository:

```
solana-verify verify-from-repo \
  --program-id Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker \
  --base-image solanafoundation/solana-verifiable-build:3.1.14 \
  --library-name solpoker \
  https://github.com/bhu1tyagi/solpoker
```

The base image is not optional and is not a preference. The default container
ships cargo 1.84, which cannot parse a crate that reaches the tree through
`anchor-attribute-account` 1.0.2 — so without that flag the build fails to
compile rather than producing a hash that disagrees. A compile error here is
our packaging, not a finding.

A hash that *does* disagree is a finding. If this command builds successfully
and the result differs from what an explorer shows, treat the disagreement
itself as a security finding and tell us.

## Acknowledgements

Nobody yet. This section exists so the first person has somewhere to go.
