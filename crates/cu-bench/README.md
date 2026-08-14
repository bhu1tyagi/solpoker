# cu-bench

Measures the real on-chain compute-unit cost of `poker-engine` by running it
inside the SBF VM on devnet. It exists purely to produce a number for the Phase 1
gate — it is not part of the game.

Native benchmarks cannot answer the question that matters here ("does showdown
evaluation fit in a Solana compute budget?"), so this deploys a throwaway program
and reads the actual consumption out of the transaction logs.

## Running it

```bash
cargo build-sbf
solana program deploy target/deploy/cu_bench.so \
  --program-id target/deploy/cu_bench-keypair.json \
  --url https://rpc.magicblock.app/devnet

npm install
node -e "require('fs').writeFileSync('program-id.json', JSON.stringify(
  require('child_process').execSync(
    'solana address -k target/deploy/cu_bench-keypair.json').toString().trim()))"
npm run bench
```

## Measured results

Devnet, program `4PpPbp3Y6G1wQqYAPys8iJE3QS8nNEKSJEnDMBVWuuGi`:

| Workload | CU | Share of the 200,000 default budget |
| --- | ---: | ---: |
| `evaluate()` — one 7-card hand | 865 | 0.43% |
| Showdown — 6 evaluates + side pots + payout | 7,075 | 3.54% |
| Shuffle — 52-card deterministic Fisher-Yates | 18,289 | 9.14% |

Showdown settlement fits the default budget roughly 28 times over, so **no compute
budget increase is needed** for the path the spec was worried about.

The shuffle is the most expensive operation by a wide margin because it runs
SHA-256 in counter mode. It still fits comfortably, but it is the thing to watch
if Phase 5 adds work to the deal path.

## How the measurement works

The program brackets its work with `sol_log_compute_units()`, which emits
`Program consumption: N units remaining`. The harness subtracts consecutive
readings. Two back-to-back calls at the start measure the cost of the
instrumentation itself (101 CU), which is subtracted from every reported figure,
so the numbers above are engine work alone.

`sol_remaining_compute_units()` would be tidier since it returns the value
directly, but that syscall fails to link on the devnet runtime — deploying a
program that calls it is rejected with `Unresolved symbol
(sol_remaining_compute_units)`. The log form is used instead.

`core::hint::black_box` wraps the inputs and results so the optimiser cannot
delete the work being measured.
