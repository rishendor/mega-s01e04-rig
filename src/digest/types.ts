export type RunStatus = 'ok' | 'retry' | 'fail';

/** Counts of valid events, not counts of jobs or their final statuses. */
export type StatusCounts = {
  readonly ok: number;
  readonly retry: number;
  readonly fail: number;
};

/** One job's valid events, observed in JSONL file order. */
export type DigestRow = {
  readonly job: string;
  /** Owner from the last event, including an explicit null. */
  readonly owner: string | null;
  /** All valid events for this job, including retries and failures. */
  readonly runs: number;
  /** Events whose status is retry. */
  readonly retries: number;
  readonly lastStatus: RunStatus;
  /** Latest supplied error string; retained after recovery, null if never supplied. */
  readonly lastError: string | null;
  /** Original at strings from the first and last events; offsets are unchanged. */
  readonly firstAt: string;
  readonly lastAt: string;
  /** True if any event failed, even when lastStatus is now ok or retry. */
  readonly hasFailure: boolean;
};

export type NightDigest = {
  readonly night: string;
  /** One row per job, ascending by case-sensitive JS string comparison, not locale. */
  readonly rows: readonly DigestRow[];
  /** Rejected lines do not contribute to rows, runs, retries, or counts. */
  readonly badLines: number;
  /** Totals across all valid events in the night, for the status board. */
  readonly counts: StatusCounts;
};

/**
 * Synchronously read runsDir/<night>.jsonl. Implemented as readNight in reader.ts.
 * night must be a real calendar date in YYYY-MM-DD form; an invalid night or
 * missing file returns null. Empty or wholly malformed files return a digest
 * with no rows and zero counts (and the applicable badLines count), not null.
 * Consumers use the reader's row order unchanged for both HTML and JSON.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
