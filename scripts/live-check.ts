import { fetchDayclawPosts } from '../src/feed/client';
import { printableOneLine } from './cli-output';

export async function runLiveCheck(options: {
  fetchPosts?: typeof fetchDayclawPosts;
} = {}): Promise<{ count: number; newestId: string | null }> {
  const posts = await (options.fetchPosts ?? fetchDayclawPosts)();
  return { count: posts.length, newestId: posts[0]?.id ?? null };
}

type Writable = { write(value: string): unknown };

export type LiveCheckCliIo = {
  run?: typeof runLiveCheck;
  writer: { stdout: Writable; stderr: Writable; process: { exitCode: number | string | null | undefined } };
};

export async function runLiveCheckCli(io: LiveCheckCliIo): Promise<void> {
  try {
    const result = await (io.run ?? runLiveCheck)();
    io.writer.stdout.write(`Dayclaw schema valid: ${result.count} posts; newest ID: ${printableOneLine(result.newestId ?? 'none')}\n`);
    io.writer.process.exitCode = 0;
  } catch {
    io.writer.stderr.write('Live check failed\n');
    io.writer.process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  await runLiveCheckCli({ writer: { stdout: process.stdout, stderr: process.stderr, process } });
}

if (import.meta.main) {
  void main();
}
