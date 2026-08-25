# Phantom false-positive appeal

Send to **review@phantom.com**. That is the address a Phantom maintainer points
developers at for exactly this warning; there is no form and no self-serve
allowlist.

Worth knowing before sending: **pokerable.fun is not on Phantom's published
blocklist.** The list at `github.com/phantom/blocklist` has zero matches for the
domain, so there is nothing to request removal of. This is Blowfish — the
real-time scanner Phantom runs — making a risk judgement on a domain it has
never seen before. That distinction matters, because it means the fix is
evidence and time rather than a takedown request.

---

## Subject

False positive: pokerable.fun blocked, verified open-source Solana program

## Body

Hello,

Phantom is showing "Request blocked — This dApp could be malicious" for
**pokerable.fun**. I believe this is a false positive from the automated
scanner, and I can offer more evidence than most new dApps can.

**What it is.** A six-player Texas Hold'em poker room on Solana. Players buy
chips with USDC at a fixed rate, play hands on a MagicBlock ephemeral rollup,
and cash chips back out for USDC at the same rate. There is no token, no
presale, no airdrop, and no mechanism that takes a user's funds without an
explicit signature.

**The program is verified and reproducible.**

- Program ID: `Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker`
- OtterSec verified build: <https://verify.osec.io/status/Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker>
  reports `"is_verified": true`, with the on-chain hash matching a build
  reproduced from source by OtterSec's own builder.
- Source: <https://github.com/bhu1tyagi/solpoker>

**The binary carries a security.txt.** Contact details, a security policy and
the source URL are compiled into the deployed program itself, readable on any
explorer. Contact is bhuwantyagi2000@gmail.com; policy at
<https://github.com/bhu1tyagi/solpoker/blob/main/SECURITY.md>.

**What a signature actually authorises.** Two things move money, both requiring
the wallet: buying chips (USDC in) and cashing out (USDC back). A third
signature creates a short-lived session key so the player is not prompted on
every bet — that key is scoped to acting at one table and provably cannot buy,
sell, or move chips out of a balance, because those instructions accept only the
wallet. The program refuses every mint but the one it is compiled against, so it
cannot be used to move arbitrary tokens.

**Why it likely tripped the scanner.** The domain is days old, `.fun` carries a
poor baseline reputation, and the transaction shape — an unfamiliar program
moving USDC and creating token accounts — resembles the drainer pattern
heuristically. I understand why the call was made; I am asking for a human look
given the verification evidence above.

Happy to provide anything else useful — a walkthrough, test funds, or a call.

Thank you,
Bhuwan Tyagi
bhuwantyagi2000@gmail.com

---

## What else moves the needle

**Time is the biggest factor.** Several developers in Phantom's own discussions
report the flag clearing on its own in roughly a week, as domain age accumulates
and no abuse reports arrive. Nothing you do speeds that up as much as simply not
being reported.

**Social proof is the documented accelerant.** Phantom's community threads note
that Blowfish struggles to verify developers with no public footprint, and that
vouching from recognised Solana people shortens the process. A public post from
the MagicBlock team — whose rollup this runs on and who you already have a line
to — would be worth more than another email.

**One technical lever, not yet pulled.** A developer in the same thread reported
Blowfish suggesting `signAndSendTransaction` instead of signing and sending
separately, since it lets the wallet simulate and attribute the transaction
itself. This client currently signs with `signTransaction` and sends through its
own RPC connection, which is deliberate — it controls preflight and confirmation
in ways the money paths depend on. Worth trying if the appeal stalls; not worth
destabilising the deposit path pre-emptively on a second-hand report.

## Sources

- Phantom discussion where a maintainer names the review address:
  <https://github.com/orgs/phantom/discussions/426>
- The blocklist itself, which does not contain this domain:
  <https://github.com/phantom/blocklist>
