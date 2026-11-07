# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
(next) a morning digest of what ran overnight.

```sh
cp .env.example .env
pnpm install
pnpm dev               # http://127.0.0.1:8787
```

The service binds only to `127.0.0.1`, not to the public network. `PORT` changes
the port (default `8787`), not the listen address.

## Export a preview

With rig running, save the digest as one self-contained HTML file:

```sh
node scripts/export-preview.mjs --output /tmp/opencode/rig-preview.html
```

The default night is `2026-10-28`. For another night or local port:

```sh
node scripts/export-preview.mjs --night 2026-10-27 --origin http://127.0.0.1:8788 --output /tmp/opencode/rig-preview-27.html
```

The output must be an absolute path outside the repository, with an existing
parent directory and a filename that does not already exist. Symlinked paths
back into the repository are rejected. Use a fresh filename for each export.
The command requires a successful HTML response, preserves the rendered page
unchanged, and never prints its contents. It accepts only loopback HTTP on
`127.0.0.1` and refuses redirects. It does not publish or deploy anything;
public hosting requires separate approval. Keep exported HTML out of Git,
issues and chat attachments (ADR 0003).

Validate the exporter against an isolated loopback test server:

```sh
node --test scripts/check-export-preview.mjs
```

For the separately approved, manual-only GitHub Pages publication, see
[the preview deployment runbook](docs/preview.md). Pushing code never deploys it.

Working on it with an agent: start at [AGENTS.md](AGENTS.md).
