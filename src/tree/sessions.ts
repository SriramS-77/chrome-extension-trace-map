import type { Session } from '../shared/types';

export const DEFAULT_IDLE_MINUTES = 30;

export function idleMsFromMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_IDLE_MINUTES * 60_000;
  return minutes * 60_000;
}

export function isIdleExpired(lastActivityAt: number, now: number, idleMs: number): boolean {
  if (!Number.isFinite(lastActivityAt) || lastActivityAt <= 0) return true;
  return now - lastActivityAt > idleMs;
}

export function createSession(now: number, id: () => string, title: string): Session {
  return { id: id(), title, startedAt: now };
}

export function endSession(session: Session, endedAt: number): Session {
  return { ...session, endedAt };
}

/** A readable session title derived from the first page title. */
export function deriveSessionTitle(pageTitle: string, fallback: string): string {
  const clean = pageTitle.trim().replace(/\s+/g, ' ');
  if (!clean) return fallback;
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}
