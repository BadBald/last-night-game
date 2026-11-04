export const CONFIG = {
  TILE_SIZE: 40,
  MAP_WIDTH: 216,
  MAP_HEIGHT: 92,

  // Authoritative 30 real-time minutes = 1800 seconds = 7 in-game hours (11:00 PM -> 6:00 AM)
  RUN_DURATION_SECONDS: 1800,
  TOTAL_GAME_HOURS: 7,
  SECONDS_PER_GAME_HOUR: 1800 / 7,

  // Player physics & movement
  PLAYER_RADIUS: 10.5,
  SPEED_WALK: 138,
  SPEED_SPRINT: 216,
  SPEED_CROUCH: 78,
  ENCUMBERED_THRESHOLD_KG: 14.5,
  MAX_CARRY_WEIGHT_KG: 18.0,
  BACKPACK_SLOTS: 12,

  // Survival drain & recovery rates
  HUNGER_DRAIN_PER_SEC: 0.056,
  STAMINA_SPRINT_DRAIN_PER_SEC: 18.0,
  STAMINA_RECOVERY_IDLE_PER_SEC: 15.0,
  STAMINA_RECOVERY_WALK_PER_SEC: 9.5,
  FLASHLIGHT_DRAIN_PER_SEC: 0.15,
  BLEEDING_DPS: 0.72,
  BLEEDING_DURATION_SEC: 18.0,
  INFECTION_CONTAM_PER_SEC: 0.26,
  INFECTION_DURATION_SEC: 28.0,
  UNTREATED_CONTAM_CREEP_PER_SEC: 0.032,
  STARVATION_DPS: 0.55,
  HIGH_CONTAMINATION_DPS: 0.85,
  STABILIZED_HEAL_PER_SEC: 0.35,

  // Noise radii (px)
  NOISE_CROUCH_STEP: 36,
  NOISE_WALK_STEP: 100,
  NOISE_SPRINT_STEP: 235,
  NOISE_DOOR: 170,
  NOISE_SEARCH: 135,
  NOISE_WINDOW_BREAK: 430,
  NOISE_ALARM: 680,

  // Flashlight geometry
  FLASHLIGHT_RANGE: 395,
  FLASHLIGHT_HALF_ANGLE: 0.46,
  AMBIENT_PERSONAL_GLOW: 68,
} as const;

export const DISTRICT_LABELS: Record<string, string> = {
  village: 'Oakhaven Countryside Village',
  road_f45: 'Highway F45 Corridor',
  residential: 'Oakwood Suburbs',
  commercial: 'Mercer Commercial Row',
  supermarket: 'Mercer Fresh Mart',
  pharmacy: 'Vale Apothecary',
  hospital: 'St. Jude Memorial Hospital',
  police: 'Precinct 14 Station',
  industrial: 'Southgate Industrial Yard',
  parking: 'Civic Parking Lot',
  stadium: 'Civic Memorial Stadium',
  military_base: 'Fort Vanguard Military Base',
  rooftop: 'Meridian Tower Helipad',
  streets: 'Quarantine City Streets',
};
