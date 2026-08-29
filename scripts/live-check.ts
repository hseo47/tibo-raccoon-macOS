import { fetchDayclawPosts } from '../src/feed/client';

export async function runLiveCheck(options: {
  fetchPosts?: typeof fetchDayclawPosts;
} = {}): Promise<{ count: number; newestId: string | null }> {
  const posts = await (options.fetchPosts ?? fetchDayclawPosts)();
  return { count: posts.length, newestId: posts[0]?.id ?? null };
}

async function main(): Promise<void> {
  try {
    const result = await runLiveCheck();
    process.stdout.write(`Dayclaw schema valid: ${result.count} posts; newest ID: ${result.newestId ?? 'none'}\n`);
  } catch {
    process.stderr.write('Live check failed\n');
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  void main();
}
