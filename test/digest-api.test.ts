import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { RigConfig } from '../src/config.js';
import { registerDigestApi } from '../src/digest/api.js';
import type { NightDigest, ReadNight } from '../src/digest/types.js';

const config: RigConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: 'injected-runs',
};

function setup(digest: NightDigest | null) {
  const app = new Hono();
  const readNight = vi.fn<ReadNight>().mockReturnValue(digest);
  registerDigestApi(app, config, readNight);
  return { app, readNight };
}

describe('digest JSON API', () => {
  it('returns the complete shared digest without changing row values or codepoint order', async () => {
    const digest: NightDigest = {
      night: '2026-10-28',
      rows: [
        {
          job: 'Z-job',
          owner: null,
          runs: 4,
          retries: 3,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T01:00:00+01:00',
          lastAt: '2026-10-28T01:03:00+01:00',
          hasFailure: false,
        },
        {
          job: 'a-job',
          owner: 'night shift',
          runs: 2,
          retries: 0,
          lastStatus: 'ok',
          lastError: 'failed before recovery',
          firstAt: '2026-10-28T02:00:00+01:00',
          lastAt: '2026-10-28T02:01:00+01:00',
          hasFailure: true,
        },
      ],
      badLines: 1,
      counts: { ok: 2, retry: 3, fail: 1 },
    };
    const { app, readNight } = setup(digest);

    const res = await app.request('/api/digest/2026-10-28');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(digest);
    expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, digest.night);
  });

  it.each(['2026-10-30', 'not-a-night', '2026-02-30'])(
    'returns 404 when the shared reader rejects missing or invalid night %s',
    async (night) => {
      const { app, readNight } = setup(null);

      const res = await app.request(`/api/digest/${night}`);

      expect(res.status).toBe(404);
      expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, night);
    },
  );

  it.each([0, 2])('returns empty rows with 200 and preserves badLines=%i', async (badLines) => {
    const digest: NightDigest = {
      night: '2026-10-29',
      rows: [],
      badLines,
      counts: { ok: 0, retry: 0, fail: 0 },
    };
    const { app, readNight } = setup(digest);

    const res = await app.request('/api/digest/2026-10-29');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(digest);
    expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, digest.night);
  });
});
