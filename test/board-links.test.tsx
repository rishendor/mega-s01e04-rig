import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RigConfig } from '../src/config.js';
import type { NightDigest, ReadNight } from '../src/digest/types.js';
import * as heartbeat from '../src/heartbeat.js';
import { readStatus, type Status } from '../src/status.js';
import { Layout } from '../src/views/layout.js';
import { StatusBoard } from '../src/views/status.js';

describe('status board night links', () => {
  let runsDir: string;
  let config: RigConfig;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-board-'));
    config = {
      adapter: 'test-adapter',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    };
    vi.spyOn(heartbeat, 'lastBeat').mockReturnValue({
      at: '2026-10-29T08:00:00Z', pid: 42, laneId: 'test-lane',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(runsDir, { recursive: true, force: true });
  });

  async function render(status: Status) {
    const app = new Hono();
    app.get('/', (c) => c.html(
      <Layout title="status" lane={{ id: 'test-lane', marker: 'TEST-MARKER' }}>
        <StatusBoard status={status} />
      </Layout>,
    ));
    const res = await app.request('/');
    expect(res.status).toBe(200);
    return res.text();
  }

  it('links every night newest first and uses shared-reader event counts, not final job states', async () => {
    writeFileSync(join(runsDir, '2026-10-27.jsonl'), '');
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), 'malformed line\n');
    writeFileSync(join(runsDir, 'notes.jsonl'), '');
    const digests: Record<string, NightDigest> = {
      '2026-10-27': {
        night: '2026-10-27', rows: [], badLines: 0,
        counts: { ok: 0, retry: 0, fail: 0 },
      },
      '2026-10-28': {
        night: '2026-10-28', badLines: 1,
        counts: { ok: 2, retry: 6, fail: 2 },
        rows: [{
          job: 'recovered-job', owner: null, runs: 10, retries: 6,
          lastStatus: 'ok', lastError: 'temporary failure', hasFailure: true,
          firstAt: '2026-10-28T01:00:00+01:00', lastAt: '2026-10-28T02:00:00+01:00',
        }],
      },
    };
    const readNight = vi.fn<ReadNight>((_dir, night) => digests[night] ?? null);

    const status = readStatus(config, readNight);
    expect(status.nights).toEqual(['2026-10-28', '2026-10-27']);
    expect(readNight.mock.calls).toEqual([
      [runsDir, '2026-10-28'], [runsDir, '2026-10-27'],
    ]);
    expect(status.nightCounts['2026-10-28']).toEqual({ ok: 2, retry: 6, fail: 2 });

    const html = await render(status);
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · event counts: ok 2 / retry 6 / fail 2');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a> · event counts: ok 0 / retry 0 / fail 0');
    expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
    expect(html).not.toContain('notes.jsonl');
    expect(html).toContain('test-adapter');
    expect(html).toContain('2026-10-29T14:06:00+01:00');
    expect(html).toContain('2026-10-29T08:00:00Z · pid 42');
    expect(html).toContain('TEST-MARKER');
    expect(html).not.toContain('<script');
  });

  it('retains a listed night but shows missing counts when the reader returns null', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');
    const readNight = vi.fn<ReadNight>(() => null);

    const html = await render(readStatus(config, readNight));
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · event counts: ok — / retry — / fail —');
  });

  it('keeps one-argument callers working without inventing zero counts', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');

    const html = await render(readStatus(config));
    expect(html).toContain('event counts: ok — / retry — / fail —');
  });

  it('keeps the empty-board message and does not call the reader with no nights', async () => {
    const readNight = vi.fn<ReadNight>(() => null);

    const html = await render(readStatus(config, readNight));
    expect(html).toContain('nothing in runs/');
    expect(readNight).not.toHaveBeenCalled();
    expect(html).not.toContain('/digest/');
  });
});
