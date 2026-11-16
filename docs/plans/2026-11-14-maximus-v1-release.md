# Maximus v1 release lock

Canonical sequence: **[2026-11-15 Maximus roadmap](2026-11-15-maximus-roadmap.md)**
(Ship 1 = this freeze, Ship 2 = Agent OS).

Do not add a parallel plan. v1 gates are V1.1–V1.6 in that file. Agent OS,
ERP and Flutter ChatKit RPC wait until the matching
section there — v2 does not start until the v1 cut.

## V1.4 persistence bench (this machine)

`pnpm bench:persistence` on 2026-11-15, Node v26.12.1, darwin arm64, 50_000
synthetic rows. Not a quiet-lab run and not model throughput.

| concurrency | search | durationMs | writeP95Ms | writeMaxMs | eventLoopMaxMs | searchP95Ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | no | 6 | 0.31 | 0.31 | 3.47 | — |
| 10 | no | 35 | 0.18 | 3.4 | 5.16 | — |
| 50 | no | 274 | 0.26 | 10.82 | 22.99 | — |
| 1 | yes | 544 | 7.26 | 7.26 | 129.37 | 128.12 |
| 10 | yes | 532 | 0.18 | 3.86 | 119.6 | 100.85 |
| 50 | yes | 687 | 0.18 | 7.42 | 112.53 | 101.7 |

Writes stay on the main thread. Search p95 ~100–128 ms; do not move SQLite
writes off-thread unless a normal send stalls. Re-run on a quiet machine
before the GitHub release notes for the cut.
