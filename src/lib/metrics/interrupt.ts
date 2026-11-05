import { constants } from "node:os";

const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export class Interrupted extends Error {
  readonly signal: NodeJS.Signals;
  constructor(signal: NodeJS.Signals) {
    super(`metrics interrupted by ${signal}`);
    this.signal = signal;
  }

  get exitCode(): number {
    return 128 + constants.signals[this.signal];
  }
}

/**
 * So the run unwinds instead of starting its next child. Only a child killed by
 * the signal shows here: one that catches it and exits with a code (pytest) reads
 * as that command failing, and a git spawn never passes through here, so one
 * the signal kills surfaces from `gitChecked` as git failing.
 */
export function throwIfInterrupted(res: { signal: NodeJS.Signals | null }): void {
  if (res.signal && (STOP_SIGNALS as readonly string[]).includes(res.signal)) {
    throw new Interrupted(res.signal);
  }
}

export function rethrowInterrupt(err: unknown): void {
  if (err instanceof Interrupted) throw err;
}

/**
 * Keeps an interrupt from killing the process outright, so a guard's restore
 * runs. The run is synchronous, so a signal sent to the process alone is held
 * until the run ends; one sent to the process group stops the child too, which
 * `throwIfInterrupted` turns into an unwind. mutator starts its test children
 * in their own session, so a process-group signal stops mutator but not them.
 */
export function holdStopSignals(): () => void {
  const ignore = () => {};
  for (const s of STOP_SIGNALS) process.on(s, ignore);
  return () => {
    for (const s of STOP_SIGNALS) process.off(s, ignore);
  };
}
