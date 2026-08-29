import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

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
const TEST_STATE_DIRECTORY_PREFIX = 'tibo-raccoon-state-';
const PLUGIN_PATH_ERROR = 'SwiftBar action path is unavailable';
const TEST_STATE_CONFIGURATION_ERROR = 'Test state configuration is invalid';

class TestStateConfigurationError extends Error {}

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
  if (environment.TIBO_RACCOON_TEST_MODE !== '1') return fallback;
  const testDirectory = environment.TIBO_RACCOON_TEST_STATE_DIR;
  const dedicatedDirectory = testDirectory !== undefined && isAbsolute(testDirectory)
    ? resolveDedicatedTestStateDirectory(testDirectory, fallback.directory)
    : null;
  if (typeof dedicatedDirectory === 'string') return defaultStatePaths({ testDirectory: dedicatedDirectory });
  throw new TestStateConfigurationError(TEST_STATE_CONFIGURATION_ERROR);
}

function resolveDedicatedTestStateDirectory(path: string, productionDirectory: string): string | null {
  try {
    if (!lstatSync(path).isDirectory()) return null;
    const directory = realpathSync(path);
    const canonicalProductionDirectory = canonicalPath(productionDirectory);
    if (canonicalProductionDirectory !== null && directory === canonicalProductionDirectory) return null;
    if (dirname(directory) !== realpathSync(tmpdir())) return null;
    const leaf = basename(directory);
    if (!leaf.startsWith(TEST_STATE_DIRECTORY_PREFIX) || leaf.length === TEST_STATE_DIRECTORY_PREFIX.length) return null;
    const marker = join(directory, TEST_STATE_MARKER);
    if (!lstatSync(marker).isFile()) return null;
    if (readFileSync(marker, 'utf8') !== TEST_STATE_MARKER_CONTENT) return null;
    if (!hasOnlyAllowedTestStateEntries(directory)) return null;
    return directory;
  } catch {
    return null;
  }
}

function canonicalPath(path: string): string | null {
  try { return realpathSync(path); } catch { return null; }
}

function hasOnlyAllowedTestStateEntries(directory: string): boolean {
  return readdirSync(directory).every((entry) => {
    if (!isAllowedTestStateEntry(entry)) return false;
    return lstatSync(join(directory, entry)).isFile();
  });
}

function isAllowedTestStateEntry(entry: string): boolean {
  if (entry === TEST_STATE_MARKER || entry === 'state.json' || entry === 'state.lock' || entry === 'state.lock.reclaim' || entry === 'state.json.recovery') {
    return true;
  }
  return (
    /^state\.json\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry) ||
    /^state\.json\.recovery\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry) ||
    /^state\.lock(?:\.reclaim)?\.owner-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry) ||
    /^state\.lock(?:\.reclaim)?\.orphan-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry) ||
    /^state\.json\.corrupt-\d{8}T\d{9}Z$/.test(entry)
  );
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
  } catch (error) {
    const message = error instanceof TestStateConfigurationError ? TEST_STATE_CONFIGURATION_ERROR : PLUGIN_PATH_ERROR;
    result = { stdout: '', stderr: `${message}\n`, exitCode: 1 };
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
