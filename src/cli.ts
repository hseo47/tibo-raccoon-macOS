import type { RaccoonState, RuntimeNotice } from './domain';
import type { PollMode, PollResult } from './poll';
import { markAllRead } from './state/model';

export type CliDependencies = {
  poll(mode: PollMode): Promise<PollResult>;
  mutateState(mutation: (state: RaccoonState) => RaccoonState): Promise<RaccoonState>;
  render(state: RaccoonState, notice: RuntimeNotice): string;
};

export type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

const USAGE = 'Usage: tibo-raccoon.2m.js [mark-read|refresh-now]\n';
const SCHEDULED_ERROR = 'Scheduled refresh could not be completed\n';
const REFRESH_ERROR = 'Refresh could not be completed\n';
const STATE_REFRESH_ERROR = 'State refresh could not be saved\n';
const MARK_READ_ERROR = 'State update could not be saved\n';

export async function runCli(argv: readonly string[], dependencies: CliDependencies): Promise<CliResult> {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== 'mark-read' && argv[0] !== 'refresh-now')) {
    return { stdout: '', stderr: USAGE, exitCode: 64 };
  }

  if (argv.length === 0) return runScheduled(dependencies);
  if (argv[0] === 'mark-read') return runMarkRead(dependencies);
  return runRefreshNow(dependencies);
}

async function runScheduled(dependencies: CliDependencies): Promise<CliResult> {
  try {
    const result = await dependencies.poll('scheduled');
    const stdout = dependencies.render(result.state, result.notice);
    if (stdout.length === 0) return { stdout: '', stderr: SCHEDULED_ERROR, exitCode: 1 };
    return { stdout, stderr: '', exitCode: 0 };
  } catch {
    return { stdout: '', stderr: SCHEDULED_ERROR, exitCode: 1 };
  }
}

async function runMarkRead(dependencies: CliDependencies): Promise<CliResult> {
  try {
    await dependencies.mutateState(markAllRead);
    return { stdout: '', stderr: '', exitCode: 0 };
  } catch {
    return { stdout: '', stderr: MARK_READ_ERROR, exitCode: 1 };
  }
}

async function runRefreshNow(dependencies: CliDependencies): Promise<CliResult> {
  try {
    const result = await dependencies.poll('force');
    return result.notice === 'state'
      ? { stdout: '', stderr: STATE_REFRESH_ERROR, exitCode: 1 }
      : { stdout: '', stderr: '', exitCode: 0 };
  } catch {
    return { stdout: '', stderr: REFRESH_ERROR, exitCode: 1 };
  }
}
