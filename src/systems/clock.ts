import { CONFIG } from '../config';

export function formatGameClock(elapsedSeconds: number): string {
  const clamped = Math.max(0, Math.min(CONFIG.RUN_DURATION_SECONDS, elapsedSeconds));
  const gameMinutesTotal = (clamped / CONFIG.RUN_DURATION_SECONDS) * (CONFIG.TOTAL_GAME_HOURS * 60);
  const wholeGameMinutes = Math.floor(gameMinutesTotal);

  // Starts at 23:00 (11:00 PM) -> wraps through 00:00 (12:00 AM) to 06:00 (6:00 AM)
  const rawHour24 = (23 + Math.floor(wholeGameMinutes / 60)) % 24;
  const minute = wholeGameMinutes % 60;

  const isPM = rawHour24 >= 12;
  const displayHour = rawHour24 % 12 === 0 ? 12 : rawHour24 % 12;
  const minStr = minute.toString().padStart(2, '0');
  return `${displayHour}:${minStr} ${isPM ? 'PM' : 'AM'}`;
}

export function formatCountdown(elapsedSeconds: number): string {
  const rem = Math.max(0, Math.ceil(CONFIG.RUN_DURATION_SECONDS - elapsedSeconds));
  const mins = Math.floor(rem / 60);
  const secs = rem % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function getHourIndex(elapsedSeconds: number): number {
  const idx = Math.floor(elapsedSeconds / CONFIG.SECONDS_PER_GAME_HOUR);
  return Math.max(0, Math.min(7, idx));
}
