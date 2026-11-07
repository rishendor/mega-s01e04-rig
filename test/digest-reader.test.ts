import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const fixtureDir = fileURLToPath(new URL('../runs/', import.meta.url));
const night = '2026-10-28';
const validEvent = {
  at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook',
};
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync('/tmp/opencode/digest-reader-');
  tempDirs.push(dir);
  return dir;
}

function writeNight(source: string, date = night): string {
  const dir = tempDir();
  writeFileSync(join(dir, `${date}.jsonl`), source);
  return dir;
}

function writeEvents(events: unknown[], date = night): string {
  return writeNight(events.map((event) => JSON.stringify(event)).join('\n'), date);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) rmdirSync(path);
      else unlinkSync(path);
    }
    rmdirSync(dir);
  }
});

describe('readNight fixture: sample-night-2026-10-28', () => {
  it('returns all five sorted jobs, one bad line, and event counts without changing the fixture', () => {
    const path = join(fixtureDir, `${night}.jsonl`);
    const original = readFileSync(path);
    expect(readNight(fixtureDir, night)).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok',
          lastError: null, firstAt: '2026-10-29T05:41:09+01:00',
          lastAt: '2026-10-29T05:41:09+01:00', hasFailure: false,
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
          lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00',
          lastAt: '2026-10-29T01:37:00+01:00', hasFailure: false,
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok',
          lastError: 'lock held', firstAt: '2026-10-28T23:00:06+01:00',
          lastAt: '2026-10-29T05:00:04+01:00', hasFailure: false,
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail',
          lastError: 'quota exceeded', firstAt: '2026-10-29T04:00:01+01:00',
          lastAt: '2026-10-29T04:00:01+01:00', hasFailure: true,
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok',
          lastError: null, firstAt: '2026-10-28T23:00:02+01:00',
          lastAt: '2026-10-28T23:00:02+01:00', hasFailure: false,
        },
      ],
    });
    expect(readFileSync(path)).toEqual(original);
  });
});

describe('readNight fixture: sample-night-2026-10-27', () => {
  it('counts seven ok events rather than four final job states', () => {
    const digest = readNight(fixtureDir, '2026-10-27');
    expect(digest).toMatchObject({
      night: '2026-10-27', badLines: 0, counts: { ok: 7, retry: 0, fail: 0 },
    });
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows.find((row) => row.job === 'lane/sync')).toMatchObject({
      runs: 4, retries: 0, firstAt: '2026-10-27T23:00:05+01:00',
      lastAt: '2026-10-28T05:00:04+01:00', lastError: null, hasFailure: false,
    });
  });
});

describe('readNight aggregation', () => {
  it('uses event chronology across offsets, retaining earlier failures/errors after recovery', () => {
    const dir = writeEvents([
      { ...validEvent, at: '2026-10-29T02:00:00+01:00', owner: null },
      { ...validEvent, at: '2026-10-28T23:00:00Z', status: 'retry', error: 'latest error' },
      { ...validEvent, at: '2026-10-29T00:30:00+02:00', status: 'fail', error: 'older error' },
    ]);
    expect(readNight(dir, night)).toEqual({
      night, badLines: 0, counts: { ok: 1, retry: 1, fail: 1 },
      rows: [{
        job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok',
        lastError: 'latest error', firstAt: '2026-10-29T00:30:00+02:00',
        lastAt: '2026-10-29T02:00:00+01:00', hasFailure: true,
      }],
    });
  });

  it('breaks equal-time ties by file order while retaining the first observed timestamp', () => {
    const dir = writeEvents([
      { ...validEvent, status: 'fail', error: 'old error' },
      { ...validEvent, at: '2026-10-28T22:00:00Z', status: 'retry', error: 'new error' },
      { ...validEvent, owner: null },
    ]);
    expect(readNight(dir, night)?.rows[0]).toEqual({
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok',
      lastError: 'new error', firstAt: validEvent.at, lastAt: validEvent.at, hasFailure: true,
    });
  });

  it('preserves millisecond timestamps and counts duplicate events as separate runs', () => {
    const event = { ...validEvent, at: '2026-10-28T22:00:00.123Z' };
    const digest = readNight(writeEvents([event, event]), night);
    expect(digest?.rows[0]).toMatchObject({ runs: 2, firstAt: event.at, lastAt: event.at });
    expect(digest?.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
  });

  it('orders fractional seconds without truncating precision and treats trailing zeros as ties', () => {
    const firstAt = '2026-10-28T22:00:00.1234566Z';
    const lastAt = '2026-10-28T23:00:00.12345670+01:00';
    const dir = writeEvents([
      { ...validEvent, at: '2026-10-28T22:00:00.1234567Z', status: 'retry', error: 'new error' },
      { ...validEvent, at: firstAt, status: 'fail', error: 'old error' },
      { ...validEvent, at: lastAt, owner: null },
    ]);
    expect(readNight(dir, night)?.rows[0]).toMatchObject({
      firstAt, lastAt, lastStatus: 'ok', owner: null, lastError: 'new error', hasFailure: true,
    });
  });

  it('keeps the latest supplied error string, including an empty string', () => {
    const dir = writeEvents([
      { ...validEvent, status: 'fail', error: 'old error' },
      { ...validEvent, error: '' },
      validEvent,
    ]);
    expect(readNight(dir, night)?.rows[0]).toMatchObject({ lastError: '', hasFailure: true });
  });

  it('sorts by case-sensitive JS string order and safely handles object-key job names', () => {
    const jobs = ['é', 'a', 'Z', 'constructor', '__proto__'];
    const dir = writeEvents(jobs.map((job) => ({ ...validEvent, job })));
    expect(readNight(dir, night)?.rows.map((row) => row.job)).toEqual([
      'Z', '__proto__', 'a', 'constructor', 'é',
    ]);
  });

  it.each(['', '\n\r\n \t\r\n'])('returns an empty digest for empty/blank input %j', (source) => {
    expect(readNight(writeNight(source), night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('ignores blank lines and CRLF but counts invalid JSON between valid records', () => {
    const line = JSON.stringify(validEvent);
    const dir = writeNight(`\r\n${line}\r\n \t\r\n{"broken":\r\n${line}\r\n`);
    expect(readNight(dir, night)).toMatchObject({
      badLines: 1, counts: { ok: 2, retry: 0, fail: 0 }, rows: [{ runs: 2 }],
    });
  });

  it('returns a digest rather than null when every nonblank line is malformed', () => {
    expect(readNight(writeNight('not json\n{}\n[]\nnull\n'), night)).toEqual({
      night, rows: [], badLines: 4, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });
});

const invalidEvents: { label: string; value: unknown }[] = [
  { label: 'null', value: null },
  { label: 'array', value: [validEvent] },
  { label: 'number', value: 1 },
  { label: 'boolean', value: true },
  { label: 'string', value: 'event' },
  { label: 'empty object', value: {} },
  { label: 'missing at', value: { job: 'job', status: 'ok', owner: null } },
  { label: 'non-string at', value: { ...validEvent, at: 0 } },
  { label: 'missing job', value: { at: validEvent.at, status: 'ok', owner: null } },
  { label: 'non-string job', value: { ...validEvent, job: 1 } },
  { label: 'blank job', value: { ...validEvent, job: ' \t' } },
  { label: 'missing status', value: { at: validEvent.at, job: 'job', owner: null } },
  { label: 'unknown status', value: { ...validEvent, status: 'success' } },
  { label: 'missing owner', value: { at: validEvent.at, job: 'job', status: 'ok' } },
  { label: 'non-string owner', value: { ...validEvent, owner: false } },
  { label: 'blank owner', value: { ...validEvent, owner: '' } },
  { label: 'null error', value: { ...validEvent, error: null } },
  { label: 'non-string error', value: { ...validEvent, error: { message: 'no' } } },
  ...[
    'not-a-time', '2026-02-30T00:00:00Z', '2026-10-28', '2026-10-28T22:00:00',
    '2026-10-28T24:00:00Z', '2026-10-28T22:60:00Z', '2026-10-28T22:00:60Z',
    '2026-10-28T22:00:00+24:00', '2026-10-28T22:00:00+01:60', '2026-10-28T22:00:00Z\n',
  ].map((at) => ({ label: `invalid timestamp ${JSON.stringify(at)}`, value: { ...validEvent, at } })),
];

describe('readNight boundary validation', () => {
  it.each(invalidEvents)('counts $label as a bad line without losing valid events', ({ value }) => {
    const dir = writeEvents([validEvent, value, validEvent]);
    expect(readNight(dir, night)).toMatchObject({
      badLines: 1, counts: { ok: 2, retry: 0, fail: 0 }, rows: [{ runs: 2 }],
    });
  });

  it.each([
    '', '../2026-10-28', '/2026-10-28', '2026-10-28/../../other', '2026-10-28.jsonl',
    '2026-10-28\0', '2026-10-28\n', '2026-1-28', '0000-01-01', '2026-00-01',
    '2026-13-01', '2026-01-00', '2026-04-31', '2026-02-29', '1900-02-29',
  ])('returns null before filesystem access for invalid night %j', (date) => {
    const dir = writeNight('');
    // Using a regular file as runsDir would throw ENOTDIR if validation did not happen first.
    expect(readNight(join(dir, `${night}.jsonl`), date)).toBeNull();
  });

  it.each(['2024-02-29', '2000-02-29', '0099-01-01'])('accepts valid calendar night %s', (date) => {
    expect(readNight(writeEvents([validEvent], date), date)?.night).toBe(date);
  });

  it('returns null for a missing file or missing runs directory', () => {
    const dir = tempDir();
    expect(readNight(dir, night)).toBeNull();
    expect(readNight(join(dir, 'missing'), night)).toBeNull();
  });

  it('propagates unexpected filesystem errors instead of returning null', () => {
    const dir = tempDir();
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrowError(expect.objectContaining({ code: 'EISDIR' }));
  });

  it('does not hide ENOTDIR as a missing file', () => {
    const dir = writeNight('');
    expect(() => readNight(join(dir, `${night}.jsonl`), night))
      .toThrowError(expect.objectContaining({ code: 'ENOTDIR' }));
  });
});
