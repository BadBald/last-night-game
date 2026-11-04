import { ExtractionSiteDef } from '../types';

export interface DynamicEventDef {
  id: string;
  title: string;
  description: string;
  minHourIndex: number;
  maxHourIndex: number;
  weight: number;
  durationSeconds: number;
  kind:
    | 'heavy_rain'
    | 'distant_screams'
    | 'radio_interference'
    | 'spore_outbreak'
    | 'emergency_siren'
    | 'survivor_signal';
}

export const DYNAMIC_EVENT_POOL: DynamicEventDef[] = [
  {
    id: 'heavy_rain',
    title: 'Cloudburst Downpour',
    description:
      'Torrential rain lashes the road and rooftops—visibility narrows, but footsteps are partially masked.',
    minHourIndex: 0,
    maxHourIndex: 6,
    weight: 24,
    durationSeconds: 95,
    kind: 'heavy_rain',
  },
  {
    id: 'distant_screams',
    title: 'Echoes in the Dark',
    description:
      'Human cries echo down the dark corridor before abruptly cutting off. Nearby Hollow stir.',
    minHourIndex: 1,
    maxHourIndex: 5,
    weight: 22,
    durationSeconds: 20,
    kind: 'distant_screams',
  },
  {
    id: 'radio_interference',
    title: 'Ionospheric Static',
    description:
      'Geomagnetic interference garbles emergency frequencies with eerie harmonic bursts.',
    minHourIndex: 1,
    maxHourIndex: 5,
    weight: 16,
    durationSeconds: 45,
    kind: 'radio_interference',
  },
  {
    id: 'spore_outbreak',
    title: 'Airborne Spore Drift',
    description:
      'Wind gusts carry ruptured Bloom spores across the streets. Avoid greenish haze.',
    minHourIndex: 2,
    maxHourIndex: 6,
    weight: 20,
    durationSeconds: 70,
    kind: 'spore_outbreak',
  },
  {
    id: 'emergency_siren',
    title: 'Civil Defense Siren',
    description:
      'An automated quarantine klaxon wails briefly, pulling roaming Hollow toward the main avenues.',
    minHourIndex: 1,
    maxHourIndex: 6,
    weight: 18,
    durationSeconds: 30,
    kind: 'emergency_siren',
  },
  {
    id: 'survivor_signal',
    title: 'Weak Shortwave Ping',
    description:
      'A dropped evacuee transponder pings nearby—high-grade supplies left unguarded.',
    minHourIndex: 1,
    maxHourIndex: 5,
    weight: 16,
    durationSeconds: 120,
    kind: 'survivor_signal',
  },
];

export interface HourlyMilestone {
  hourIndex: number;
  timeLabel: string;
  sender: string;
  radioMessage: string;
  worldAlert: string;
  urgent: boolean;
}

export function buildHospitalRadioBroadcast(site: ExtractionSiteDef): string {
  return `TACTICAL TRANSPONDER SYNCED: Evacuation Command helicopter Echo-7 GPS beacon locked to ${site.name.toUpperCase()} (${site.sectorLabel}) for 06:00 AM pickup! ${site.routeHint} Monitor 162.55 MHz for live emergency bulletins.`;
}

export function buildHourlyMilestones(site: ExtractionSiteDef): HourlyMilestone[] {
  return [
    {
      hourIndex: 0,
      timeLabel: '11:00 PM',
      sender: 'OUTBREAK ALERT',
      radioMessage:
        'Oakhaven Village has fallen. Escape east along Highway F45 to reach St. Jude Memorial Hospital in the city for an Antiviral Injection.',
      worldAlert:
        'You inhaled spores during Oakhaven’s collapse. Escape east onto Road F45 toward the city hospital!',
      urgent: true,
    },
    {
      hourIndex: 1,
      timeLabel: '12:00 AM',
      sender: 'PRECINCT 14 DISPATCH',
      radioMessage: `Midnight Advisory: Infected packs respond to gunfire, sprinting, and broken glass. Keep moving toward ${site.shortName}.`,
      worldAlert:
        '12:00 AM — Infected packs are growing restless in the dark. Crouch to mask your footsteps.',
      urgent: false,
    },
    {
      hourIndex: 2,
      timeLabel: '1:00 AM',
      sender: 'MUNICIPAL GRID',
      radioMessage: `SUBSTATION FAILURE: City & Highway F45 power grid offline. Conserve your phone battery and keep a Power Bank ready on your trek to ${site.shortName}.`,
      worldAlert:
        '1:00 AM — Transformer explosion! Highway and city streetlights have gone pitch-black.',
      urgent: true,
    },
    {
      hourIndex: 3,
      timeLabel: '2:00 AM',
      sender: 'CDC QUARANTINE',
      radioMessage:
        'Bio-Alert: Fungal Bloom hosts rupturing across city alleys. Keep Antiviral injectors or Antiseptic ready.',
      worldAlert:
        '2:00 AM — Toxic Bloom spore clouds are thickening across the quarantine zone.',
      urgent: true,
    },
    {
      hourIndex: 4,
      timeLabel: '3:00 AM',
      sender: 'UNKNOWN SURVIVOR',
      radioMessage: `Do not trust voices crying for help in the dark—Mimics are hunting survivors en route to ${site.shortName}.`,
      worldAlert:
        '3:00 AM — Uncanny human cries echo down the avenues. Beware of Mimics.',
      urgent: true,
    },
    {
      hourIndex: 5,
      timeLabel: '4:00 AM',
      sender: 'FLIGHT ECHO-7',
      radioMessage: `TWO HOURS TO DAWN: Echo-7 is outbound on final vector to ${site.name} (${site.sectorLabel}). Move into position before 06:00 AM!`,
      worldAlert:
        '4:00 AM — Two hours until 06:00 AM extraction. Make sure you have tuned the Hospital Radio and are moving to the LZ!',
      urgent: true,
    },
    {
      hourIndex: 6,
      timeLabel: '5:00 AM',
      sender: 'FLIGHT ECHO-7',
      radioMessage: `LANDING ZONE ACTIVE! ${site.name} [H] strobes are live—stand inside the [H] landing pad at 06:00 AM for extraction!`,
      worldAlert:
        '5:00 AM — One hour to dawn! Helicopter landing strobes are igniting—get to the extraction zone!',
      urgent: true,
    },
  ];
}
