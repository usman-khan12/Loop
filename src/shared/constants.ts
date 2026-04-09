export const STORAGE_KEYS = {
  WORKFLOWS: 'loop_workflows',
  RUNS: 'loop_runs',
  SETTINGS: 'loop_settings',
} as const;

export const RETRY_COUNT = 2;
export const DEFAULT_TIMEOUT = 10_000; // ms
export const STEP_DELAY = 300; // ms between steps
export const POLL_INTERVAL = 200; // ms for element polling

export const VERSION = '1.0.0';
