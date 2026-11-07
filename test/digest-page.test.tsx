import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDigestPage } from '../src/digest/page.js';
import type { DigestRow, NightDigest, ReadNight } from '../src/digest/types.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'injected-runs' };
const night = '2026-10-28';
const baseRow: DigestRow = {
  job: 'Alpha',
  owner: null,
  runs: 4,
  retries: 3,
  lastStatus: 'ok',
  lastError: null,
  firstAt: '2026-10-28T01:00:00+01:00',
  lastAt: '2026-10-28T01:03:00+01:00',
  hasFailure: false,
};

function page(digest: NightDigest | null) {
  const app = new Hono();
  const readNight = vi.fn<ReadNight>(() => digest);
  registerDigestPage(app, config, readNight);
  return { app, readNight };
}

function result(rows: readonly DigestRow[], badLines = 0): NightDigest {
  return { night, rows, badLines, counts: { ok: 0, retry: 0, fail: 0 } };
}

afterEach(() => vi.unstubAllEnvs());

describe('digest page', () => {
  it('renders every field in reader order, with the shared layout and no scripts', async () => {
    vi.stubEnv('LANE_MARKER', 'PAGE-TEST-MARKER');
    const rows = [baseRow, { ...baseRow, job: 'Zulu', owner: 'rook', lastError: 'socket <closed> & paused' }, { ...baseRow, job: 'alpha' }];
    const { app, readNight } = page(result(rows, 1));
    const res = await app.request(`/digest/${night}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, night);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('PAGE-TEST-MARKER');
    expect(html).toContain(`<h1>digest · ${night}</h1>`);
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html).not.toContain('<script');
    expect(html).toContain('<p class="warn">bad lines: 1</p>');
    expect(html).toContain(`<th scope="row">Alpha</th><td>—</td><td>4</td><td>3</td><td>ok</td><td>—</td><td>${baseRow.firstAt}</td><td>${baseRow.lastAt}</td>`);
    expect(html).toContain('<td>rook</td>');
    expect(html).toContain('socket &lt;closed&gt; &amp; paused');
    expect(html).not.toContain('socket <closed>');
    expect([...html.matchAll(/<th scope="row">(.*?)<\/th>/g)].map((match) => match[1]))
      .toEqual(rows.map((row) => row.job));
  });

  it('warns for three retries or any failure, including a recovered job', async () => {
    const { app } = page(result([
      baseRow,
      { ...baseRow, job: 'Bravo', retries: 2 },
      { ...baseRow, job: 'Charlie', retries: 0, hasFailure: true, lastStatus: 'ok' },
      { ...baseRow, job: 'Delta', retries: 0, hasFailure: true, lastStatus: 'fail' },
    ]));
    const html = await (await app.request(`/digest/${night}`)).text();
    const body = html.match(/<tbody>(.*?)<\/tbody>/s)?.[1] ?? '';
    const rows = [...body.matchAll(/<tr([^>]*)>(.*?)<\/tr>/g)];

    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row[1])).toEqual([' class="warn"', '', ' class="warn"', ' class="warn"']);
    expect(html).toContain('<p class="mute">bad lines: 0</p>');
  });

  it('returns 404 with the normal layout when the reader finds no night', async () => {
    vi.stubEnv('LANE_MARKER', 'PAGE-404-MARKER');
    const { app } = page(null);
    const res = await app.request('/digest/2026-10-30');
    const html = await res.text();

    expect(res.status).toBe(404);
    expect(html).toContain('night not found');
    expect(html).toContain('PAGE-404-MARKER');
    expect(html).not.toContain('nothing ran');
    expect(html).not.toContain('<table>');
  });

  it('renders nothing ran for an empty night and the fallback lane banner', async () => {
    vi.stubEnv('LANE_MARKER', '');
    const { app } = page(result([]));
    const res = await app.request(`/digest/${night}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).toContain('no marker set');
    expect(html).toContain('bad lines: 0');
    expect(html).not.toContain('<table>');
  });

  it('keeps the bad-line warning visible even when no valid rows remain', async () => {
    const { app } = page(result([], 2));
    const res = await app.request(`/digest/${night}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).toContain('<p class="warn">bad lines: 2</p>');
  });
});
