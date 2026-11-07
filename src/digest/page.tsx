import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { lane } from '../lane.js';
import { Digest } from '../views/digest.js';
import { Layout } from '../views/layout.js';
import type { ReadNight } from './types.js';

export function registerDigestPage(app: Hono, config: RigConfig, readNight: ReadNight): void {
  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const digest = readNight(config.runsDir, night);

    if (digest === null) {
      return c.html(
        <Layout title={`digest · ${night}`} lane={lane()}>
          <h1>digest · {night}</h1>
          <p>night not found</p>
        </Layout>,
        404,
      );
    }

    return c.html(
      <Layout title={`digest · ${night}`} lane={lane()}>
        <Digest digest={digest} />
      </Layout>,
    );
  });
}
