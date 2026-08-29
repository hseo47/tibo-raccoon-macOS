export const FEED_URL = 'https://api.dayclaw.com/api/source/public/x/thsottiaux/items' as const;
export const PROFILE_URL = 'https://x.com/thsottiaux' as const;

export type Post = {
  id: string;
  text: string;
  publishedAt: string | null;
  url: string | null;
};

export type FeedErrorKind = 'timeout' | 'http' | 'oversize' | 'malformed' | 'network';
export type RuntimeNotice = 'state' | null;
export type IconState = 'calm' | 'unread' | 'offline';
export type Appearance = 'light' | 'dark';

export type RaccoonState = {
  version: 1;
  initializedAt: string | null;
  recoveryPending: boolean;
  knownIds: string[];
  unreadIds: string[];
  cachedPosts: Post[];
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  nextRetryAt: string | null;
  lastError: string | null;
};

export interface Clock {
  now(): Date;
}
