// Usage: node scripts/export-preview.mjs --output /absolute/outside-repo/preview.html
// Optional: --night 2026-10-28 --origin http://127.0.0.1:8787
import { realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

async function main() {
  const { values } = parseArgs({
    options: {
      output: { type: 'string' },
      night: { type: 'string', default: '2026-10-28' },
      origin: { type: 'string', default: 'http://127.0.0.1:8787' },
    },
  });
  if (!values.output || !isAbsolute(values.output)) {
    throw new Error('--output must be an absolute path outside the repository.');
  }
  const night = values.night;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)
      || new Date(`${night}T00:00:00Z`).toISOString().slice(0, 10) !== night) {
    throw new Error('--night must be a valid YYYY-MM-DD date.');
  }
  const origin = new URL(values.origin);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1'
      || origin.username || origin.password || origin.pathname !== '/'
      || origin.search || origin.hash) {
    throw new Error('--origin must be an HTTP origin on 127.0.0.1 (optional port).');
  }

  const repo = await realpath(fileURLToPath(new URL('..', import.meta.url)));
  const requestedOutput = resolve(values.output);
  const output = join(await realpath(dirname(requestedOutput)), basename(requestedOutput));
  for (const candidate of [requestedOutput, output]) {
    const path = relative(repo, candidate);
    if (path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))) {
      throw new Error('--output must be outside the repository, including symlinks.');
    }
  }

  const response = await fetch(new URL(`/digest/${night}`, origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Digest request failed (HTTP ${response.status}).`);
  if (!/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('Digest response must have Content-Type text/html.');
  }
  const html = Buffer.from(await response.arrayBuffer());
  if (!/^\s*<!doctype html\s*>\s*<html[\s>]/i.test(html.toString('utf8'))
      || !/<\/html>\s*$/i.test(html.toString('utf8'))) {
    throw new Error('Digest response must be a complete HTML document.');
  }
  // Exclusive creation also rejects existing files and symlinks; never print the HTML.
  await writeFile(output, html, { flag: 'wx', mode: 0o600 });
  console.log('Preview exported.');
}

main().catch((error) => {
  console.error(`Preview export failed: ${error.message}`);
  process.exitCode = 1;
});
