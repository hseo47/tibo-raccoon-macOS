import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { runCli, type CliDependencies, type CliResult } from './cli';
import type { Clock } from './domain';
import { fetchDayclawPosts } from './feed/client';
import { poll } from './poll';
import { defaultStatePaths, loadState, mutateState, type StatePaths } from './state/store';
import { renderSwiftBarMenu } from './swiftbar/render';
import { isRepresentableSwiftBarPluginPath } from './swiftbar/plugin-path';

type Environment = Readonly<Record<string, string | undefined>>;

type Writable = { write(value: string): unknown };

const TEST_STATE_MARKER = '.tibo-raccoon-test-state';
const TEST_STATE_MARKER_CONTENT = 'tibo-raccoon-test-state-v1\n';
const PLUGIN_PATH_ERROR = 'SwiftBar action path is unavailable';

export type CliWriter = {
  stdout: Writable;
  stderr: Writable;
  process: { exitCode: number | string | null | undefined };
};

export function resolvePluginPath(environment: Environment, executablePath: string): string {
  const configured = environment.SWIFTBAR_PLUGIN_PATH;
  if (configured !== undefined && isAbsolute(configured) && isRepresentableSwiftBarPluginPath(configured)) return configured;
  const fallback = isAbsolute(executablePath) ? executablePath : resolve(executablePath);
  if (isRepresentableSwiftBarPluginPath(fallback)) return fallback;
  throw new Error(PLUGIN_PATH_ERROR);
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
    isDedicatedTestStateDirectory(testDirectory, fallback.directory)
  ) {
    return defaultStatePaths({ testDirectory });
  }
  return fallback;
}

function isDedicatedTestStateDirectory(path: string, productionDirectory: string): boolean {
  if (resolve(path) === resolve(productionDirectory)) return false;
  try {
    if (!lstatSync(path).isDirectory()) return false;
    const marker = join(path, TEST_STATE_MARKER);
    if (!lstatSync(marker).isFile()) return false;
    return readFileSync(marker, 'utf8') === TEST_STATE_MARKER_CONTENT;
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

export async function runProductionCli(argv: readonly string[], options: {
  environment?: Environment;
  executablePath?: string;
  writer: CliWriter;
}): Promise<void> {
  let result: CliResult;
  try {
    const dependencyOptions: { environment?: Environment; executablePath?: string } = {};
    if (options.environment !== undefined) dependencyOptions.environment = options.environment;
    if (options.executablePath !== undefined) dependencyOptions.executablePath = options.executablePath;
    result = await runCli(argv, createProductionDependencies(dependencyOptions));
  } catch {
    result = { stdout: '', stderr: `${PLUGIN_PATH_ERROR}\n`, exitCode: 1 };
  }
  writeCliResult(result, options.writer);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  await runProductionCli(argv, {
    writer: { stdout: process.stdout, stderr: process.stderr, process },
  });
}

if (import.meta.main) {
  void main();
}
