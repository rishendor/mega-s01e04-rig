---
plan: morning-digest
status: done
owner: rook
opened: 2026-10-29
---

# Morning digest

The night's run log is a JSONL file nobody reads. By breakfast someone has to know what ran,
what retried, what failed, and whose it was, without opening `runs/`. rig already serves the
status board; the digest is one more page on it.

Out of scope: notifications, history across nights, auth (rig only listens on localhost).

## 1. Run log reader

Read `runs/<night>.jsonl` into one row per job: job, owner, runs, retries, last status, last
error, first and last time. One JSON object per line (`at`, `job`, `status`: `ok | retry | fail`,
`owner`, optional `error`).

- A line that doesn't parse is counted, never thrown. The night still renders.
- `owner` can be `null`. Keep the row; show the owner as `—`.
- Lives in `src/digest/`. Commit `src/digest/types.ts` first (the `DigestRow` type and the
  `readNight(runsDir, night)` signature), so every part of section 2 can start against it.

Done when: reader tests pass on `runs/2026-10-28.jsonl` (5 jobs, 1 bad line).

## 2. Digest page

Four small parts. Each needs only `src/digest/types.ts` from section 1, so once that is in they
can go to four workers at once. Small, well-specified work: a cheaper model is fine here.

### 2a. Page

`GET /digest/:night` renders the rows with the usual layout: one table, sorted by job, retries of
3 or more and any `fail` marked. A night with no file returns 404; an empty file renders
"nothing ran".

Done when: `/digest/2026-10-28` renders locally.

### 2b. JSON

`GET /api/digest/:night` returns the same rows as JSON. Agents read this one; the page and the
JSON must never disagree (ADR 0001).

Done when: the JSON for 2026-10-28 has the same jobs, in the same order, as the page.

### 2c. Board link

The status board links each night on disk to its digest, with its ok / retry / fail counts beside
it.

Done when: both nights on disk link to a digest that renders.

### 2d. Route tests

Route tests for 2a and 2b: 200, 404 for a night with no file, the empty night, a night with a bad
line. Use a temp runs dir; `runs/` is read-only.

Done when: `pnpm test` is green with the new tests.

## 3. Preview for review

The reviewer reads the page from a copy, not from the lane. Run rig and save `/digest/2026-10-28` as
one HTML file, lane banner included (a command, not a browser's "save as"; the page is
self-contained, ADR 0001). Put it on your own public host, one where you can upload over it later (any bucket
or static host, ADR 0003), so it opens from a public HTTPS link. Send the reviewer the link and the
issues for this plan.

Done when: the preview link is sent to the reviewer.

## 4. Clean up

The preview carries this lane's marker on a public link (ADR 0003). Take the marker off: save the
page again with `LANE_MARKER` unset (the banner reads "no marker set") and upload it over the same
link. Move this plan to `docs/plans/done/` with its issue list.

Done when: the preview link no longer shows the lane marker.

## Issues

| Plan section | Issue | Work |
| --- | --- | --- |
| §1 | https://github.com/rishendor/mega-s01e04-rig/issues/1 | Run-log reader and shared digest types |
| §2a | https://github.com/rishendor/mega-s01e04-rig/issues/2 | Digest page: GET /digest/:night |
| §2b | https://github.com/rishendor/mega-s01e04-rig/issues/3 | Digest JSON: GET /api/digest/:night |
| §2c | https://github.com/rishendor/mega-s01e04-rig/issues/4 | Status board: night links and event counts |
| §2d | https://github.com/rishendor/mega-s01e04-rig/issues/5 | Digest HTML and JSON route tests |
| §3 | https://github.com/rishendor/mega-s01e04-rig/issues/6 | Export and publish the digest preview for review |
| §4 | https://github.com/rishendor/mega-s01e04-rig/issues/7 | After review: remove preview marker and archive the plan |

## Completion — 2026-11-07

- The [course reviewer](https://hq.mega.dev/challenges/before-i-looked) confirmed that the
  marked preview had been reviewed. Separate human approval was then obtained for
  marker-free replacement at the existing URL and deletion of that run's temporary artifact.
  Review and approval records are retained privately; they are not public repository files.
- [Replacement run 42418194600](https://github.com/rishendor/mega-s01e04-rig/actions/runs/42418194600)
  succeeded with `with_marker=false` at source commit
  `dcaaf10f437b0abc3287dd8419cb7f11fa652a38`. Its temporary artifact `13592536445` was
  deleted; an independent artifact request returned HTTP 404 and the run's artifact list
  was empty.
- The [original preview URL](https://rishendor.github.io/mega-s01e04-rig/) returned HTTP 200
  without redirects and matched a fresh command-exported unmarked page byte for byte:
  2354 bytes, SHA-256 `4ae0918ebba7109a7ac2fdfcded5153caf1ee92f2cf6653143cdbdbf1c3d53f1`.
  The banner reads exactly `no marker set`; the supplied marker is absent. The original
  page differs only in that banner text. Isolated Chrome rendering preserved all five
  sample jobs, table cells, warning classes, missing values and timestamp offsets.
- Archive-branch verification passed: `vitest run` (84 tests), `tsc --noEmit`, and
  `node --test scripts/check-export-preview.mjs` (5 exporter checks). Source run fixtures
  remain unchanged.
- The original plan body above is preserved verbatim; only its frontmatter status changed
  from ready to done. This archive records completed implementation and cleanup, not final
  course acceptance.
