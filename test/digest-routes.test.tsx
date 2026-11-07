import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T01:00:00+02:00';
const lastAt = '2026-10-28T02:00:00+01:00';

function event(job: string, status: 'ok' | 'retry' | 'fail', owner: string | null, at = firstAt, error?: string) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

// No DOM dependency is needed. Tag boundaries keep adjacent elements' text apart.
// Decode last so escaped job names/errors remain text, rather than markup.
function text(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name] ?? entity;
  }).trim();
}

function tableRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    // Data rows may start with a semantic th; all-th column headings are not data.
    .filter(([markup]) => /<td\b/i.test(markup))
    .map(([markup]) => ({
      markup,
      cells: [...markup.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) => text(cell[2])),
    }));
}

function expectBadLines(html: string, count: number) {
  expect(text(html)).toMatch(new RegExp(`(?:\\b${count}\\s+bad\\s+lines?\\b|\\bbad\\s+lines?\\s*:\\s*${count}\\b)`, 'i'));
}

describe('digest routes', () => {
  let runsDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    runsDir = mkdtempSync(join(process.env.RUNNER_TEMP || '/tmp/opencode', 'rig-digest-routes-'));
    app = createApp({
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    });
  });

  afterEach(() => {
    // Only remove the exact directory this test created; never the real runs/.
    if (runsDir) rmSync(runsDir, { recursive: true });
  });

  function writeNight(lines: readonly string[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.length ? `${lines.join('\n')}\n` : '');
  }

  async function requestDigest() {
    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^text\/html\b/);
    expect(api.headers.get('content-type')).toMatch(/^application\/json\b/);
    const digest: NightDigest = await api.json();
    return { html: await page.text(), digest };
  }

  it('returns matching sorted rows, values, offsets and warnings for an existing night', async () => {
    writeNight([
      event('gamma-two-retries', 'retry', 'gamma-owner'),
      event('beta-three-retries', 'retry', 'beta-owner'),
      event('alpha-recovered', 'fail', null, firstAt, 'temporary <fault> & retry'),
      event('Zulu-failed', 'fail', 'zulu-owner', firstAt, 'still broken'),
      event('gamma-two-retries', 'retry', 'gamma-owner'),
      event('beta-three-retries', 'retry', 'beta-owner'),
      event('alpha-recovered', 'ok', null, lastAt),
      event('beta-three-retries', 'retry', 'beta-owner'),
      event('gamma-two-retries', 'ok', 'gamma-owner', lastAt),
      event('beta-three-retries', 'ok', 'beta-owner', lastAt),
    ]);
    const { html, digest } = await requestDigest();
    expect(digest).toEqual({
      night,
      rows: [
        { job: 'Zulu-failed', owner: 'zulu-owner', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'still broken', firstAt, lastAt: firstAt, hasFailure: true },
        { job: 'alpha-recovered', owner: null, runs: 2, retries: 0, lastStatus: 'ok', lastError: 'temporary <fault> & retry', firstAt, lastAt, hasFailure: true },
        { job: 'beta-three-retries', owner: 'beta-owner', runs: 4, retries: 3, lastStatus: 'ok', lastError: null, firstAt, lastAt, hasFailure: false },
        { job: 'gamma-two-retries', owner: 'gamma-owner', runs: 3, retries: 2, lastStatus: 'ok', lastError: null, firstAt, lastAt, hasFailure: false },
      ],
      badLines: 0,
      counts: { ok: 3, retry: 5, fail: 2 },
    } satisfies NightDigest);

    expect(html.match(/<table\b/gi)).toHaveLength(1);
    const rows = tableRows(html);
    expect(rows.map((row) => row.cells)).toEqual(digest.rows.map((row) => [
      row.job,
      row.owner ?? '—',
      String(row.runs),
      String(row.retries),
      row.lastStatus,
      row.lastError ?? '—',
      row.firstAt,
      row.lastAt,
    ]));
    expect(text(html)).toContain(digest.night);
    for (const [index, row] of digest.rows.entries()) {
      const warned = /class=["'][^"']*\bwarn\b[^"']*["']/i.test(rows[index].markup);
      expect(warned, `warning for ${row.job}`).toBe(row.retries >= 3 || row.hasFailure);
    }
  });

  it.each(['/digest', '/api/digest'])('returns 404 from %s when the night file is missing', async (route) => {
    const response = await app.request(`${route}/${night}`);
    expect(response.status).toBe(404);
  });

  it('returns an empty digest and nothing ran for an empty file, not 404', async () => {
    writeNight([]);
    const { html, digest } = await requestDigest();
    expect(digest).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    expect(text(html)).toMatch(/nothing ran/i);
    expect(tableRows(html)).toEqual([]);
  });

  it('counts a malformed line without losing valid rows or changing their JSON/HTML values', async () => {
    writeNight([
      event('retained-job', 'ok', null),
      '{not valid JSON',
      event('retained-job', 'retry', null, lastAt, 'try again'),
    ]);
    const { html, digest } = await requestDigest();
    expect(digest).toEqual({
      night,
      rows: [{ job: 'retained-job', owner: null, runs: 2, retries: 1, lastStatus: 'retry', lastError: 'try again', firstAt, lastAt, hasFailure: false }],
      badLines: 1,
      counts: { ok: 1, retry: 1, fail: 0 },
    } satisfies NightDigest);
    expect(tableRows(html).map((row) => row.cells)).toEqual([
      ['retained-job', '—', '2', '1', 'retry', 'try again', firstAt, lastAt],
    ]);
    expectBadLines(html, digest.badLines);
  });

  it('returns a counted empty digest for an entirely malformed file, not 404 or 500', async () => {
    writeNight(['not JSON', '{"job":', 'null']);
    const { html, digest } = await requestDigest();
    expect(digest).toEqual({ night, rows: [], badLines: 3, counts: { ok: 0, retry: 0, fail: 0 } });
    expect(text(html)).toMatch(/nothing ran/i);
    expect(tableRows(html)).toEqual([]);
    expectBadLines(html, digest.badLines);
  });
});
