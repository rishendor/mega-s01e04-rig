export type RunStatus = 'ok' | 'retry' | 'fail';

/** Counts of valid events, not counts of jobs or their final statuses. */
export type StatusCounts = {
  readonly ok: number;
  readonly retry: number;
  readonly fail: number;
};

/** One job's valid events, ordered by event time; file order breaks ties. */
export type DigestRow = {
  readonly job: string;
  /** Owner from the latest event, including an explicit null. */
  readonly owner: string | null;
  /** All valid events for this job, including retries and failures. */
  readonly runs: number;
  /** Events whose status is retry. */
  readonly retries: number;
  readonly lastStatus: RunStatus;
  /** Latest error by event time; retained after recovery, null if never supplied. */
  readonly lastError: string | null;
  /** Original earliest/latest at strings; offsets are unchanged. */
  readonly firstAt: string;
  readonly lastAt: string;
  /** True if any event failed, even when lastStatus is now ok or retry. */
  readonly hasFailure: boolean;
};

export type NightDigest = {
  readonly night: string;
  /** One row per job, ascending by case-sensitive JS string comparison, not locale. */
  readonly rows: readonly DigestRow[];
  /** Invalid JSON/events; blank lines are ignored. Rejections contribute no events. */
  readonly badLines: number;
  /** Totals across all valid events in the night, for the status board. */
  readonly counts: StatusCounts;
};

/**
 * Synchronously read runsDir/<night>.jsonl. Implemented as readNight in reader.ts.
 * night must be a real calendar date in YYYY-MM-DD form; an invalid night or
 * missing file returns null. Empty or wholly malformed files return a digest
 * with no rows and zero counts (and the applicable badLines count), not null.
 * Blank lines are ignored; unexpected filesystem errors propagate to the caller.
 * Consumers use the reader's row order unchanged for both HTML and JSON.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
