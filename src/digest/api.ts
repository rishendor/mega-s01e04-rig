import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import type { ReadNight } from './types.js';

export function registerDigestApi(app: Hono, config: RigConfig, readNight: ReadNight) {
  app.get('/api/digest/:night', (c) => {
    const digest = readNight(config.runsDir, c.req.param('night'));
    if (digest === null) return c.notFound();
    return c.json(digest);
  });
}
