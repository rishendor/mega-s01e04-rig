# Manual preview publication

`.github/workflows/preview.yml` publishes one sample digest through GitHub Pages.
It runs **only** on `workflow_dispatch`, from this repository's `main` branch.
There are no push triggers, scheduled deployments, or automatic banner cleanup.
The `with_marker` boolean defaults to `true`. Using `false` replaces the public
page and requires separate human approval after review is in (plan §4 / ADR 0003).
A workflow input is not proof of that approval.

Expected site: `https://rishendor.github.io/mega-s01e04-rig/`. This is a target,
not evidence of deployment. Only a successful deployment and subsequent live
verification establish the published URL.

## Safety and artifact caveat

- Use only reviewed source and the supplied sample runs. The workflow checks the
  28 October fixture's SHA-256 and the configured runs directory before generation.
- Installation, tests, typecheck and isolated exporter checks run before the lane
  secret is exposed. No dependency cache is enabled; checkout does not persist credentials.
- The repository secret `LANE_MARKER` is available only in the generation step,
  and only in marked mode. A missing/blank value fails that mode. The other mode
  explicitly unsets it before starting the server.
- Both modes use `node --import tsx src/server.ts`, **not** `pnpm start`: no
  environment file is loaded. Generation also fails if a root `.env` exists.
- The server binds `127.0.0.1`. Its output goes to a runner-local temporary log.
  The exporter writes only `index.html` under `$RUNNER_TEMP/rig-preview`, outside
  the checkout. The banner and self-contained document are checked without
  printing their contents. Never enable shell tracing or dump environment/HTML.
- Pages requires an Actions artifact. Even though HTML is never committed,
  this is a **temporary repository artifact**, an explicit exception to ADR 0003's
  “no previews in the repo” wording that must be approved before publication.
  People who can download artifacts may see the page during this interval.
- The official upload action packages this one HTML file. It uses a unique name
  containing the run ID and attempt, with one-day retention as a fallback, not as
  a substitute for deletion. Do not upload logs or the checkout.
- After `deploy-pages` finishes, cleanup uses the upload's `artifact_id`, checks
  its name/run ownership, deletes it, and requires a subsequent GET to return
  404. Cleanup also runs with `always()` on failure/cancellation where the runner
  remains available. If upload failed before returning its ID, discovery is
  limited to the exact name within the current run. API or verification errors
  fail the job; they are not ignored.
- Only after successful deletion does the workflow fetch the production URL and
  compare its HTML bytes to the export. It permits bounded CDN propagation,
  never logs the body, and outputs the actual deployment URL only after a match.
- Public HTML and retained copies can outlive artifact deletion. Later replacement
  cannot retract downloads, caches or screenshots. Deleting the Actions artifact
  does **not** remove the live Pages site; the post-delete check verifies this.

## Operator procedure — commands are not automatic authorization

The parent/operator must refresh the challenge, verify the exact planned writes,
and check the human approval before running any mutating command below. Do not
put a secret value in a command argument, issue, log, workflow input or commit.
These commands assume the approved workflow has been reviewed and pushed to `main`.

### 1. Confirm account and Pages source

```sh
gh api user --jq .login
gh api --include repos/rishendor/mega-s01e04-rig/pages
```

If and only if GET returned 404 because no site exists, create the site using the
declared `build_type` field (no publishing branch is needed):

```sh
gh api --method POST repos/rishendor/mega-s01e04-rig/pages -f build_type=workflow
```

If GET returned 200 for an existing site, select Actions instead:

```sh
gh api --method PUT repos/rishendor/mega-s01e04-rig/pages -f build_type=workflow
```

Then enforce HTTPS and read back the settings:

```sh
gh api --method PUT repos/rishendor/mega-s01e04-rig/pages -F https_enforced=true
gh api repos/rishendor/mega-s01e04-rig/pages --jq '{build_type,https_enforced,html_url}'
```

Require `build_type: workflow`, HTTPS, and the expected project URL. Stop on
403/409/422 instead of trying guessed settings. The account needs repository
administration/Pages-management permission; Actions must be enabled and permit
the pinned official actions. The deployment uses the `github-pages` environment;
keep any configured protection rules, permit `main`, and satisfy required reviews.
Do not silently weaken protections or enable Pages inside the workflow.

### 2. Set the one approved repository secret

Use the CLI's hidden interactive value prompt, or pipe the value from the parent's
existing secure source to the same command's standard input. Never echo it or use
`--body` with the literal value. Do not import an entire environment file.

```sh
gh secret set LANE_MARKER --repo rishendor/mega-s01e04-rig
```

The CLI encrypts this repository secret before transmission. The secret name,
not its value, is stored in this workflow. Workflow maintainers can change code
to access repository secrets, so review changes and protect the default branch.

### 3. Dispatch the initial marked publication explicitly

```sh
gh workflow run preview.yml --repo rishendor/mega-s01e04-rig --ref main -f with_marker=true
gh run list --repo rishendor/mega-s01e04-rig --workflow preview.yml --event workflow_dispatch --limit 5 --json databaseId,headSha,status,conclusion,url
```

Record the actual run ID and commit; watch that run, not just the latest run:

```sh
gh run watch RUN_ID --repo rishendor/mega-s01e04-rig --exit-status
gh api repos/rishendor/mega-s01e04-rig/actions/runs/RUN_ID/artifacts --jq '{total_count,artifacts:[.artifacts[]|{id,name,expired}]}'
```

Require successful generation, deployment, artifact deletion/GET 404 and live
byte verification. Record the real URL from the verified step/environment and
independently render it; do not infer success from this runbook's expected URL.
Only then perform the separately verified reviewer handoff and close #6. Do not
dispatch again, especially with `with_marker=false`, without the relevant approval.

## Cancellation and failure recovery

`always()` is best effort: forced cancellation, job timeout, a runner loss or an
API outage can interrupt cleanup. Avoid cancelling a run after upload. The job
has a 25-minute limit; deployment has its action's 10-minute timeout, leaving
room for cleanup. One-day retention bounds the normal fallback but is not proof
that immediate deletion happened. A deployment can have gone live even if later
cleanup or verification failed: inspect the existing run before doing anything else.

After confirming the run/attempt and whether deployment is finished or cancelled,
list its artifacts with the command above. Identify **only**
`digest-preview-RUN_ID-RUN_ATTEMPT`; do not delete unrelated artifacts or runs.
The existing approval covers deletion of this temporary preview artifact.

```sh
gh api --include repos/rishendor/mega-s01e04-rig/actions/artifacts/ARTIFACT_ID
gh api --method DELETE --include repos/rishendor/mega-s01e04-rig/actions/artifacts/ARTIFACT_ID
gh api --include repos/rishendor/mega-s01e04-rig/actions/artifacts/ARTIFACT_ID
```

Check the first response's `name` and `workflow_run.id`, require DELETE 204 and
the final GET **404**, not a permission error or generic command failure. Record
the ID/statuses, not the artifact content. Re-check the existing production page
after deletion. Do not rerun or replace the site as a cleanup shortcut. A failed
run stays failed; document any manual artifact recovery alongside its receipt.

## Verified versions and declared contracts

Checked live on 2026-11-07 using read-only `gh api` release/tag/action metadata.
All `uses:` refs are full commit SHAs; the annotated github-script tag was peeled
to its commit. The pinned Pages upload composite also pins its nested upload action.

| Action | Release | Commit |
| --- | --- | --- |
| actions/checkout | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-node | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| actions/upload-pages-artifact | v5.0.0 | `fc324d3547104276b827a68afc52ff2a11cc49c9` |
| actions/deploy-pages | v5.0.1 | `368f82528645a54fb793d4d04e342629a3f51346` |
| actions/github-script | v9.0.0 | `3a2844b7e9c422d3c10d287c895573f7108da1b3` |
| actions/upload-artifact (nested) | v7.0.0 | `bbbca2ddaa5d8feaa63e36b76fdaad77386f024f` |

The runner installs Node `24.22.2` (the live Node 24 distribution) and pnpm
`12.18.0` (the lockfile's generating version). The pnpm registry declares Node
`>=18`; locked Vitest `5.1.0` requires `^22.12.0 || ^24.0.0 || >=26.0.0`, and
locked Vite `8.3.6` requires `^20.19.0 || >=22.12.0`. Node 24.22.2 satisfies both.
These official JavaScript actions use their runner-provided Node 24 runtime.

Sources (API field names, not guessed request shapes):

- [Custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Manual triggers and typed inputs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [Pages GET/POST/PUT API: build_type and https_enforced](https://docs.github.com/en/rest/pages/pages)
- [Artifact list/GET/DELETE API](https://docs.github.com/en/rest/actions/artifacts)
- [Secret stdin/prompt contract](https://cli.github.com/manual/gh_secret_set)
- [Workflow dispatch CLI contract](https://cli.github.com/manual/gh_workflow_run)
- [Node 24 distribution checksums](https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt)
- [pnpm 12.18.0 registry metadata](https://registry.npmjs.org/pnpm/12.18.0)
- Action tag receipts: `GET https://api.github.com/repos/actions/<action>/git/ref/tags/<release>`.
  For github-script, also `GET /repos/actions/github-script/git/tags/d746ffe35508b1917358783b479e04febd2b8f71`.
  Each pinned `action.yml` was read with `GET /repos/actions/<action>/contents/action.yml?ref=<commit>`;
  this establishes `artifact_id` (upload), `artifact_name`/`page_url` (deploy), and runtime inputs.
