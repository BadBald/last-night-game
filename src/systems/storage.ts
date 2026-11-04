import { GameSettings, PersistentRecords, RunStats } from '../types';

const SETTINGS_KEY = 'last_night_settings_v1';
const RECORDS_KEY = 'last_night_records_v1';

export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 0.8,
  musicVolume: 0.7,
  radioVolume: 0.95,
  sfxVolume: 0.85,
  ambientVolume: 0.65,
  muted: false,
  screenShake: true,
  controllerVibration: true,
  mobileControlsMode: 'auto',
  showAcousticRings: true,
};

export const DEFAULT_RECORDS: PersistentRecords = {
  totalRuns: 0,
  extractions: 0,
  longestSurvivalSeconds: 0,
  totalHollowSlain: 0,
  totalContainersLooted: 0,
  lastRun: null,
};

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadRecords(): PersistentRecords {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    if (!raw) return { ...DEFAULT_RECORDS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_RECORDS, ...parsed };
  } catch {
    return { ...DEFAULT_RECORDS };
  }
}

export function recordCompletedRun(run: RunStats): PersistentRecords {
  const prev = loadRecords();
  const updated: PersistentRecords = {
    totalRuns: prev.totalRuns + 1,
    extractions: prev.extractions + (run.extracted ? 1 : 0),
    longestSurvivalSeconds: Math.max(prev.longestSurvivalSeconds, run.survivedSeconds),
    totalHollowSlain: prev.totalHollowSlain + run.enemiesKilled,
    totalContainersLooted: prev.totalContainersLooted + run.containersSearched,
    lastRun: run,
  };
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage quota errors
  }
  return updated;
}
