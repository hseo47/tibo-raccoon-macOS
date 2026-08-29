import type { Clock, Post, RaccoonState, RuntimeNotice } from './domain';
import { FeedError } from './feed/client';
import { applyFailedPoll, applySuccessfulPoll, createInitialState } from './state/model';
import type { StateLoad } from './state/store';

const DUPLICATE_ATTEMPT_WINDOW_MS = 30_000;

export type PollMode = 'scheduled' | 'force';

export type PollDependencies = {
  clock: Clock;
  loadState(): Promise<StateLoad>;
  mutateState(mutation: (state: RaccoonState) => RaccoonState): Promise<RaccoonState>;
  fetchPosts(): Promise<Post[]>;
};

export type PollResult = {
  state: RaccoonState;
  networkAttempted: boolean;
  notice: RuntimeNotice;
};

export async function poll(mode: PollMode, dependencies: PollDependencies): Promise<PollResult> {
  let loaded: StateLoad;
  try {
    loaded = await dependencies.loadState();
  } catch {
    return { state: createInitialState({ recoveryPending: true }), networkAttempted: false, notice: 'state' };
  }

  const cached = loaded.state;
  const nowIso = dependencies.clock.now().toISOString();
  if (mode === 'scheduled' && shouldSkipScheduledPoll(cached, nowIso)) {
    return { state: cached, networkAttempted: false, notice: null };
  }

  let posts: Post[] | undefined;
  let failureKind: FeedError['kind'] | undefined;
  try {
    posts = await dependencies.fetchPosts();
  } catch (error) {
    failureKind = error instanceof FeedError ? error.kind : 'network';
  }

  try {
    const state = await dependencies.mutateState((current) => (
      posts === undefined
        ? applyFailedPoll(current, failureKind ?? 'network', nowIso)
        : applySuccessfulPoll(current, posts, nowIso)
    ));
    return { state, networkAttempted: true, notice: null };
  } catch {
    return { state: cached, networkAttempted: true, notice: 'state' };
  }
}

function shouldSkipScheduledPoll(state: RaccoonState, nowIso: string): boolean {
  const now = Date.parse(nowIso);
  if (state.lastAttemptAt !== null && now < Date.parse(state.lastAttemptAt) + DUPLICATE_ATTEMPT_WINDOW_MS) {
    return true;
  }
  return state.nextRetryAt !== null && now < Date.parse(state.nextRetryAt);
}
