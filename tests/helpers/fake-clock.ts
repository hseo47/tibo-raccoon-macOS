import type { Clock } from '../../src/domain';

export class FakeClock implements Clock {
  private current: Date;

  constructor(nowIso: string) {
    this.current = new Date(nowIso);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(nowIso: string): void {
    this.current = new Date(nowIso);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
