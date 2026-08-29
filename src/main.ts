import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { runCli, type CliDependencies, type CliResult } from './cli';
import type { Clock } from './domain';
import { fetchDayclawPosts } from './feed/client';
import { poll } from './poll';
import { defaultStatePaths, loadState, mutateState, type StatePaths } from './state/store';
import { renderSwiftBarMenu } from './swiftbar/render';

type Environment = Readonly<Record<string, string | undefined>>;

type Writable = { write(value: string): unknown };

export type CliWriter = {
  stdout: Writable;
  stderr: Writable;
  process: { exitCode: number | string | null | undefined };
};

export function resolvePluginPath(environment: Environment, executablePath: string): string {
  const configured = environment.SWIFTBAR_PLUGIN_PATH;
  if (configured !== undefined && isAbsolute(configured)) return configured;
  return isAbsolute(executablePath) ? executablePath : resolve(executablePath);
}

export function resolveStatePaths(
  environment: Environment,
  productionDirectory?: string,
): StatePaths {
  const productionPaths = defaultStatePaths();
  const fallback = productionDirectory === undefined
    ? productionPaths
    : defaultStatePaths({ testDirectory: productionDirectory });
  const testDirectory = environment.TIBO_RACCOON_TEST_STATE_DIR;
  if (
    environment.TIBO_RACCOON_TEST_MODE === '1' &&
    testDirectory !== undefined &&
    isAbsolute(testDirectory) &&
    isExistingDirectory(testDirectory)
  ) {
    return defaultStatePaths({ testDirectory });
  }
  return fallback;
}

function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function createProductionDependencies(options: {
  environment?: Environment;
  executablePath?: string;
} = {}): CliDependencies {
  const environment = options.environment ?? process.env;
  const executablePath = options.executablePath ?? process.argv[1] ?? import.meta.path;
  const paths = resolveStatePaths(environment);
  const pluginPath = resolvePluginPath(environment, executablePath);
  const clock: Clock = { now: () => new Date() };
  const mutate = (mutation: Parameters<CliDependencies['mutateState']>[0]) => mutateState(paths, mutation);

  return {
    poll: (mode) => poll(mode, {
      clock,
      loadState: () => loadState(paths),
      mutateState: mutate,
      fetchPosts: () => fetchDayclawPosts(),
    }),
    mutateState: mutate,
    render: (state, notice) => renderSwiftBarMenu({ state, notice, pluginPath }),
  };
}

export function writeCliResult(result: CliResult, writer: CliWriter): void {
  if (result.stdout !== '') writer.stdout.write(result.stdout);
  if (result.stderr !== '') writer.stderr.write(result.stderr);
  writer.process.exitCode = result.exitCode;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const result = await runCli(argv, createProductionDependencies());
  writeCliResult(result, { stdout: process.stdout, stderr: process.stderr, process });
}

if (import.meta.main) {
  void main();
}
