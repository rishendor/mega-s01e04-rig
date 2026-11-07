import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type EventTime = {
  second: number;
  fraction: string;
};

type RunEvent = {
  at: string;
  time: EventTime;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

type JobState = {
  row: DigestRow;
  firstTime: EventTime;
  lastTime: EventTime;
  errorTime: EventTime | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDate(value: string): boolean {
  if (value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) {
    return false;
  }
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

// Require a real date, clock time, and explicit offset (or Z).
function eventTime(at: string): EventTime | null {
  const pattern = /^(\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d+))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  const match = pattern.exec(at);
  if (!match || match[0] !== at || !isDate(at.slice(0, 10))) return null;
  const time = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(time)) return null;
  // Keep the decimal fraction separate: Date.parse truncates sub-millisecond times.
  return { second: time / 1000, fraction: (match[2] ?? '').replace(/0+$/, '') };
}

function compareTimes(a: EventTime, b: EventTime): number {
  return a.second - b.second
    || (a.fraction < b.fraction ? -1 : a.fraction > b.fraction ? 1 : 0);
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(value)
    || typeof value.at !== 'string'
    || typeof value.job !== 'string' || value.job.trim() === ''
    || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')
    || (value.owner !== null && (typeof value.owner !== 'string' || value.owner.trim() === ''))
    || (value.error !== undefined && typeof value.error !== 'string')) {
    return null;
  }
  const time = eventTime(value.at);
  if (time === null) return null;
  return {
    at: value.at,
    time,
    job: value.job,
    status: value.status,
    owner: value.owner,
    error: value.error,
  };
}

function addEvent(jobs: Map<string, JobState>, event: RunEvent): void {
  const state = jobs.get(event.job);
  if (!state) {
    jobs.set(event.job, {
      row: {
        job: event.job,
        owner: event.owner,
        runs: 1,
        retries: event.status === 'retry' ? 1 : 0,
        lastStatus: event.status,
        lastError: event.error ?? null,
        firstAt: event.at,
        lastAt: event.at,
        hasFailure: event.status === 'fail',
      },
      firstTime: event.time,
      lastTime: event.time,
      errorTime: event.error === undefined ? null : event.time,
    });
    return;
  }

  const isFirst = compareTimes(event.time, state.firstTime) < 0;
  const isLast = compareTimes(event.time, state.lastTime) >= 0;
  const hasLatestError = event.error !== undefined
    && (state.errorTime === null || compareTimes(event.time, state.errorTime) >= 0);
  state.row = {
    ...state.row,
    owner: isLast ? event.owner : state.row.owner,
    runs: state.row.runs + 1,
    retries: state.row.retries + (event.status === 'retry' ? 1 : 0),
    lastStatus: isLast ? event.status : state.row.lastStatus,
    lastError: hasLatestError && event.error !== undefined ? event.error : state.row.lastError,
    firstAt: isFirst ? event.at : state.row.firstAt,
    lastAt: isLast ? event.at : state.row.lastAt,
    hasFailure: state.row.hasFailure || event.status === 'fail',
  };
  if (isFirst) state.firstTime = event.time;
  if (isLast) state.lastTime = event.time;
  if (hasLatestError) state.errorTime = event.time;
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isDate(night)) return null;
  let source: string;
  try {
    source = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    throw error;
  }

  const jobs = new Map<string, JobState>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;
  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const event = parseEvent(line);
    if (!event) {
      badLines += 1;
      continue;
    }
    counts[event.status] += 1;
    addEvent(jobs, event);
  }
  const rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { night, rows, badLines, counts };
};
