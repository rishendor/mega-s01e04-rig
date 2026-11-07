// Usage: node --test scripts/check-export-preview.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('./export-preview.mjs', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));

test('exports only successful loopback HTML to a new file outside the repo', async (t) => {
  const dir = await mkdtemp('/tmp/opencode/rig-export-test-');
  t.after(() => rm(dir, { recursive: true }));
  let status = 200;
  let type = 'text/html; charset=UTF-8';
  let body = '';
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(status, { 'Content-Type': type, Location: '/redirect-target' });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const run = (args) => exec(process.execPath, [script, ...args]);
  const output = join(dir, 'preview.html');
  const args = ['--origin', origin, '--output', output];
  const rejects = (extra, message) => assert.rejects(run(extra), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, message);
    assert.equal(error.stdout, '');
    return true;
  });

  await t.test('preserves either banner state byte for byte without logging HTML', async () => {
    for (const banner of ['synthetic test banner', 'no marker set']) {
      body = `<!doctype html><html><body><header>${banner}</header>é</body></html>`;
      const target = join(dir, `preview-${requests.length}.html`);
      const result = await run(['--origin', origin, '--output', target]);
      assert.deepEqual(await readFile(target), Buffer.from(body));
      assert.equal(result.stdout, 'Preview exported.\n');
      assert.equal(result.stderr, '');
      assert.equal(requests.at(-1), '/digest/2026-10-28');
    }
    await run([...args, '--night', '2026-10-27']);
    assert.equal(requests.at(-1), '/digest/2026-10-27');
  });

  await t.test('rejects unsafe arguments before any request', async () => {
    const before = requests.length;
    await rejects([], /--output/);
    await rejects(['--output', 'relative.html'], /absolute path/);
    await rejects(['--output', join(repo, 'preview.html')], /outside the repository/);
    for (const address of ['https://example.com', 'http://localhost:8787', `${origin}/other`, `${origin}/?q=1`]) {
      await rejects(['--origin', address, '--output', output], /--origin/);
    }
    await rejects([...args, '--night', '2026-02-30'], /valid YYYY-MM-DD/);
    await rejects([...args, '--night', '../other'], /valid YYYY-MM-DD/);
    await rejects([...args, '--unknown'], /Unknown option/);
    await symlink(repo, join(dir, 'repo-link'));
    await rejects(['--output', join(dir, 'repo-link', 'preview.html')], /outside the repository/);
    assert.equal(requests.length, before);
  });

  await t.test('rejects errors, non-HTML, incomplete documents and redirects without writing', async () => {
    const rejectedOutput = join(dir, 'rejected.html');
    const rejectedArgs = ['--origin', origin, '--output', rejectedOutput];
    status = 404;
    await rejects(rejectedArgs, /HTTP 404/);
    status = 200;
    type = 'application/json';
    await rejects(rejectedArgs, /Content-Type text\/html/);
    type = 'text/html';
    body = 'not an HTML document';
    await rejects(rejectedArgs, /complete HTML document/);
    status = 302;
    const before = requests.length;
    await rejects(rejectedArgs, /fetch failed/);
    assert.equal(requests.length, before + 1);
    assert.ok(!requests.includes('/redirect-target'));
    await assert.rejects(readFile(rejectedOutput), { code: 'ENOENT' });
  });

  await t.test('refuses to overwrite existing files or output symlinks', async () => {
    status = 200;
    body = '<!doctype html><html><body>sample</body></html>';
    const existing = join(dir, 'existing.html');
    await writeFile(existing, 'keep');
    await rejects(['--origin', origin, '--output', existing], /EEXIST/);
    const link = join(dir, 'output-link.html');
    await symlink(existing, link);
    await rejects(['--origin', origin, '--output', link], /EEXIST/);
    assert.equal(await readFile(existing, 'utf8'), 'keep');
  });
});
