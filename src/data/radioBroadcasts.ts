export type RadioBroadcastId =
  | 'broadcast_1100pm'
  | 'broadcast_1145pm'
  | 'broadcast_1230am'
  | 'broadcast_0130am'
  | 'broadcast_0230am'
  | 'broadcast_0300am'
  | 'broadcast_0500am';

export type RadioVoiceFilterProfile =
  | 'studio_anchor'
  | 'studio_anchor_tense'
  | 'studio_anchor_desperate'
  | 'studio_anchor_weak'
  | 'field_walkie'
  | 'field_whisper'
  | 'unknown_whisper'
  | 'evac_command';

export type RadioSfxCueKind =
  | 'breaking_news_intro'
  | 'breaking_news_distorted'
  | 'static_burst'
  | 'long_static'
  | 'heavy_static'
  | 'tense_pause'
  | 'transmission_lost'
  | 'transmission_cuts'
  | 'squelch_out';

export interface RadioSpeechSegmentDef {
  kind: 'speech';
  segmentId: string;
  speaker: string;
  voiceName: 'Kore' | 'Fenrir' | 'Charon' | 'Puck' | 'Zephyr';
  voiceStyle: string;
  filterProfile: RadioVoiceFilterProfile;
  ttsPromptText: string;
  lines: string[];
  fallbackRate?: number;
  fallbackPitch?: number;
}

export interface RadioSfxStepDef {
  kind: 'sfx';
  sfxKind: RadioSfxCueKind;
  durationMs: number;
  cueLabel?: string;
}

export type RadioBroadcastStep = RadioSpeechSegmentDef | RadioSfxStepDef;

export interface RadioBroadcastTranscriptBlock {
  type: 'speaker' | 'cue';
  speaker?: string;
  cue?: string;
  lines?: string[];
}

export interface RadioBroadcastDef {
  id: RadioBroadcastId;
  number: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  timeLabel: string;
  triggerGameHours: number;
  headline: string;
  subtitle: string;
  toneSummary: string;
  urgent: boolean;
  steps: RadioBroadcastStep[];
  transcript: RadioBroadcastTranscriptBlock[];
}

export const RADIO_BROADCASTS: RadioBroadcastDef[] = [
  // 1. 11:00 PM — Emergency announcement (0.0h)
  {
    id: 'broadcast_1100pm',
    number: 1,
    timeLabel: '11:00 PM',
    triggerGameHours: 0,
    headline: 'Emergency Broadcast — Civil Protection Department',
    subtitle: 'Citywide Public Safety Incident · Remain Indoors',
    toneSummary: 'Calm, professional, official emergency announcement',
    urgent: true,
    steps: [
      {
        kind: 'sfx',
        sfxKind: 'breaking_news_intro',
        durationMs: 1750,
      },
      {
        kind: 'speech',
        segmentId: 'b1_dispatch',
        speaker: 'EMERGENCY DISPATCH',
        voiceName: 'Kore',
        voiceStyle:
          'Urgent, authoritative, calm professional breaking news radio anchor delivering an official Civil Protection emergency broadcast',
        filterProfile: 'studio_anchor',
        ttsPromptText:
          "Attention. This is an emergency broadcast issued by the city's Civil Protection Department. A major public safety incident has been reported across multiple districts. All civilians are instructed to remain indoors. Lock your doors and windows. Do not approach injured or unidentified individuals. Emergency services are currently responding. Further instructions will follow. This is not a drill.",
        lines: [
          "Attention. This is an emergency broadcast issued by the city's Civil Protection Department.",
          'A major public safety incident has been reported across multiple districts.',
          'All civilians are instructed to remain indoors. Lock your doors and windows. Do not approach injured or unidentified individuals.',
          'Emergency services are currently responding.',
          'Further instructions will follow.',
          'This is not a drill.',
        ],
        fallbackRate: 0.98,
        fallbackPitch: 0.95,
      },
      {
        kind: 'sfx',
        sfxKind: 'squelch_out',
        durationMs: 450,
      },
    ],
    transcript: [
      {
        type: 'speaker',
        speaker: 'EMERGENCY DISPATCH',
        lines: [
          "Attention. This is an emergency broadcast issued by the city's Civil Protection Department.",
          'A major public safety incident has been reported across multiple districts.',
          'All civilians are instructed to remain indoors. Lock your doors and windows. Do not approach injured or unidentified individuals.',
          'Emergency services are currently responding.',
          'Further instructions will follow.',
          'This is not a drill.',
        ],
      },
    ],
  },

  // 2. 11:45 PM — Emergency services overwhelmed (0.75h)
  {
    id: 'broadcast_1145pm',
    number: 2,
    timeLabel: '11:45 PM',
    triggerGameHours: 0.75,
    headline: 'Emergency Services Overwhelmed Across City Districts',
    subtitle: 'Severe Response Delays · Seek Nearest Secure Building',
    toneSummary: 'Calm dispatcher under pressure · Slight radio interference',
    urgent: true,
    steps: [
      {
        kind: 'sfx',
        sfxKind: 'breaking_news_intro',
        durationMs: 1750,
      },
      {
        kind: 'speech',
        segmentId: 'b1145_dispatch',
        speaker: 'EMERGENCY DISPATCH',
        voiceName: 'Kore',
        voiceStyle:
          'Calm breaking news emergency dispatcher speaking under growing pressure, maintaining composed authority',
        filterProfile: 'studio_anchor_tense',
        ttsPromptText:
          'Attention, all remaining civilians. Emergency response units are experiencing severe delays across the city. If you are currently outside, seek the nearest secure building immediately. Do not gather in public areas. Do not attempt to reach emergency stations. We are asking everyone to remain calm and avoid unnecessary movement.',
        lines: [
          'Attention, all remaining civilians.',
          'Emergency response units are experiencing severe delays across the city.',
          'If you are currently outside, seek the nearest secure building immediately.',
          'Do not gather in public areas. Do not attempt to reach emergency stations.',
          'We are asking everyone to remain calm and avoid unnecessary movement.',
        ],
        fallbackRate: 1.0,
        fallbackPitch: 0.94,
      },
      {
        kind: 'sfx',
        sfxKind: 'static_burst',
        durationMs: 1300,
        cueLabel: '[STATIC]',
      },
      {
        kind: 'speech',
        segmentId: 'b1145_field',
        speaker: 'FIELD OPERATOR',
        voiceName: 'Fenrir',
        voiceStyle:
          'Stressed, urgent field responder shouting over street chaos into a handheld tactical radio',
        filterProfile: 'field_walkie',
        ttsPromptText:
          "Dispatch, <breath> we're seeing people running through the streets. There are too many of them. We need backup. Now!",
        lines: [
          "Dispatch, we're seeing people running through the streets.",
          'There are too many of them.',
          'We need backup. Now.',
        ],
        fallbackRate: 1.06,
        fallbackPitch: 0.87,
      },
      {
        kind: 'sfx',
        sfxKind: 'transmission_lost',
        durationMs: 1500,
        cueLabel: '[TRANSMISSION LOST]',
      },
    ],
    transcript: [
      {
        type: 'speaker',
        speaker: 'EMERGENCY DISPATCH',
        lines: [
          'Attention, all remaining civilians.',
          'Emergency response units are experiencing severe delays across the city.',
          'If you are currently outside, seek the nearest secure building immediately.',
          'Do not gather in public areas. Do not attempt to reach emergency stations.',
          'We are asking everyone to remain calm and avoid unnecessary movement.',
        ],
      },
      { type: 'cue', cue: '[STATIC]' },
      {
        type: 'speaker',
        speaker: 'FIELD OPERATOR',
        lines: [
          "Dispatch, we're seeing people running through the streets.",
          'There are too many of them.',
          'We need backup. Now.',
        ],
      },
      { type: 'cue', cue: '[TRANSMISSION LOST]' },
    ],
  },

  // 3. 12:30 AM — The situation is deteriorating (1.5h)
  {
    id: 'broadcast_1230am',
    number: 3,
    timeLabel: '12:30 AM',
    triggerGameHours: 1.5,
    headline: 'Violent Incidents Reported — Emergency Units Unresponsive',
    subtitle: 'Do Not Approach Unusual Individuals · Remain Inside',
    toneSummary: 'Tense, maintaining authority · Slight radio interference',
    urgent: true,
    steps: [
      {
        kind: 'sfx',
        sfxKind: 'breaking_news_intro',
        durationMs: 1750,
      },
      {
        kind: 'speech',
        segmentId: 'b2_dispatch',
        speaker: 'EMERGENCY DISPATCH',
        voiceName: 'Kore',
        voiceStyle:
          'Tense, urgent breaking news anchor trying to maintain authority while reading alarming reports on live radio',
        filterProfile: 'studio_anchor_tense',
        ttsPromptText:
          'We are receiving reports of violent incidents throughout the city. Several emergency units have stopped responding. If you encounter individuals displaying unusual behaviour, do not approach them. Do not attempt to help them. Remain inside buildings whenever possible.',
        lines: [
          'We are receiving reports of violent incidents throughout the city.',
          'Several emergency units have stopped responding.',
          'If you encounter individuals displaying unusual behaviour, do not approach them. Do not attempt to help them.',
          'Remain inside buildings whenever possible.',
        ],
        fallbackRate: 1.02,
        fallbackPitch: 0.94,
      },
      {
        kind: 'sfx',
        sfxKind: 'static_burst',
        durationMs: 1350,
        cueLabel: '[STATIC]',
      },
      {
        kind: 'speech',
        segmentId: 'b2_field',
        speaker: 'FIELD OPERATOR',
        voiceName: 'Fenrir',
        voiceStyle:
          'Panicked, breathless emergency field responder speaking urgently over a tactical radio in disbelief',
        filterProfile: 'field_walkie',
        ttsPromptText:
          "Dispatch... <breath> something is wrong. They're not dead. I repeat, they're not dead! <gasp> One of them just stood up.",
        lines: [
          'Dispatch... something is wrong.',
          "They're not dead. I repeat, they're not dead.",
          'One of them just stood up.',
        ],
        fallbackRate: 1.08,
        fallbackPitch: 0.86,
      },
      {
        kind: 'sfx',
        sfxKind: 'transmission_lost',
        durationMs: 1550,
        cueLabel: '[TRANSMISSION LOST]',
      },
    ],
    transcript: [
      {
        type: 'speaker',
        speaker: 'EMERGENCY DISPATCH',
        lines: [
          'We are receiving reports of violent incidents throughout the city.',
          'Several emergency units have stopped responding.',
          'If you encounter individuals displaying unusual behaviour, do not approach them. Do not attempt to help them.',
          'Remain inside buildings whenever possible.',
        ],
      },
      { type: 'cue', cue: '[STATIC]' },
      {
        type: 'speaker',
        speaker: 'FIELD OPERATOR',
        lines: [
          'Dispatch... something is wrong.',
          "They're not dead. I repeat, they're not dead.",
          'One of them just stood up.',
        ],
      },
      { type: 'cue', cue: '[TRANSMISSION LOST]' },
    ],
  },

  // 4. 1:30 AM — The shelters are no longer safe (2.5h)
  {
    id: 'broadcast_0130am',
    number: 4,
    timeLabel: '1:30 AM',
    triggerGameHours: 2.5,
    headline: 'Updated Advisory — Civilian Shelters Evacuated',
    subtitle: 'Shelters No Longer Secure · Avoid Crowded Locations',
    toneSummary: 'Exhausted dispatcher · Frightened quiet field operator',
    urgent: true,
    steps: [
      {
        kind: 'sfx',
        sfxKind: 'breaking_news_distorted',
        durationMs: 1800,
      },
      {
        kind: 'speech',
        segmentId: 'b0130_dispatch',
        speaker: 'EMERGENCY DISPATCH',
        voiceName: 'Kore',
        voiceStyle:
          'Exhausted, shaken breaking news emergency dispatcher reading a grim evacuation advisory late at night',
        filterProfile: 'studio_anchor_desperate',
        ttsPromptText:
          'This is an updated emergency advisory. <breath> All designated civilian shelters are being evacuated. Repeat. Shelters are no longer considered secure. Survivors are instructed to avoid crowded locations and remain away from infected individuals.',
        lines: [
          'This is an updated emergency advisory.',
          'All designated civilian shelters are being evacuated.',
          'Repeat. Shelters are no longer considered secure.',
          'Survivors are instructed to avoid crowded locations and remain away from infected individuals.',
        ],
        fallbackRate: 0.96,
        fallbackPitch: 0.91,
      },
      {
        kind: 'sfx',
        sfxKind: 'long_static',
        durationMs: 2350,
        cueLabel: '[LONG STATIC]',
      },
      {
        kind: 'speech',
        segmentId: 'b0130_field_1',
        speaker: 'FIELD OPERATOR — WHISPERING',
        voiceName: 'Fenrir',
        voiceStyle:
          'Frightened, hushed, quiet whisper spoken closely into a radio while hiding inside a dark building',
        filterProfile: 'field_whisper',
        ttsPromptText:
          "We locked the doors. We thought that would keep them out. <breath> But they're not trying to get inside anymore. They're just standing there. All of them. Facing the building.",
        lines: [
          'We locked the doors.',
          'We thought that would keep them out.',
          "But they're not trying to get inside anymore.",
          "They're just standing there.",
          'All of them.',
          'Facing the building.',
        ],
        fallbackRate: 0.88,
        fallbackPitch: 0.79,
      },
      {
        kind: 'sfx',
        sfxKind: 'tense_pause',
        durationMs: 1600,
        cueLabel: '[PAUSE]',
      },
      {
        kind: 'speech',
        segmentId: 'b0130_field_2',
        speaker: 'FIELD OPERATOR — WHISPERING',
        voiceName: 'Fenrir',
        voiceStyle: 'Dread-filled, trembling, barely audible whisper',
        filterProfile: 'field_whisper',
        ttsPromptText: "I think they know we're here.",
        lines: ["I think they know we're here."],
        fallbackRate: 0.84,
        fallbackPitch: 0.76,
      },
      {
        kind: 'sfx',
        sfxKind: 'transmission_lost',
        durationMs: 1550,
        cueLabel: '[TRANSMISSION LOST]',
      },
    ],
    transcript: [
      {
        type: 'speaker',
        speaker: 'EMERGENCY DISPATCH',
        lines: [
          'This is an updated emergency advisory.',
          'All designated civilian shelters are being evacuated.',
          'Repeat. Shelters are no longer considered secure.',
          'Survivors are instructed to avoid crowded locations and remain away from infected individuals.',
        ],
      },
      { type: 'cue', cue: '[LONG STATIC]' },
      {
        type: 'speaker',
        speaker: 'FIELD OPERATOR — WHISPERING',
        lines: [
          'We locked the doors.',
          'We thought that would keep them out.',
          "But they're not trying to get inside anymore.",
          "They're just standing there.",
          'All of them.',
          'Facing the building.',
        ],
      },
      { type: 'cue', cue: '[PAUSE]' },
      {
        type: 'speaker',
        speaker: 'FIELD OPERATOR — WHISPERING',
        lines: ["I think they know we're here."],
      },
      { type: 'cue', cue: '[TRANSMISSION LOST]' },
    ],
  },

  // 5. 2:30 AM — The last warning (3.5h)
  {
    id: 'broadcast_0230am',
    number: 5,
    timeLabel: '2:30 AM',
    triggerGameHours: 3.5,
    headline: 'Restricted Zone Declared — The Last Warning',
    subtitle: 'Medical Facilities Compromised · Keep Lights Off',
    toneSummary: 'Exhausted, frightened, increasingly desperate',
    urgent: true,
    steps: [
      {
        kind: 'sfx',
        sfxKind: 'breaking_news_distorted',
        durationMs: 1850,
      },
      {
        kind: 'speech',
        segmentId: 'b3_dispatch',
        speaker: 'EMERGENCY DISPATCH',
        voiceName: 'Kore',
        voiceStyle:
          'Exhausted, frightened, increasingly desperate breaking news radio anchor issuing a final citywide warning',
        filterProfile: 'studio_anchor_desperate',
        ttsPromptText:
          'Attention, all remaining survivors. <breath> The city has been declared a restricted zone. Medical facilities and emergency shelters are no longer considered secure. Avoid open streets. Keep your lights off. Do not respond to unidentified voices.',
        lines: [
          'Attention, all remaining survivors.',
          'The city has been declared a restricted zone.',
          'Medical facilities and emergency shelters are no longer considered secure.',
          'Avoid open streets. Keep your lights off. Do not respond to unidentified voices.',
        ],
        fallbackRate: 0.96,
        fallbackPitch: 0.9,
      },
      {
        kind: 'sfx',
        sfxKind: 'long_static',
        durationMs: 2450,
        cueLabel: '[LONG STATIC]',
      },
      {
        kind: 'speech',
        segmentId: 'b3_field_1',
        speaker: 'FIELD OPERATOR — WHISPERING',
        voiceName: 'Fenrir',
        voiceStyle:
          'Terrified, hushed, trembling whisper spoken closely into a handheld radio in the dark',
        filterProfile: 'field_whisper',
        ttsPromptText:
          "They're everywhere. <breath> We lost the station. We lost everyone. If anyone can hear this... don't trust what you see.",
        lines: [
          "They're everywhere.",
          'We lost the station. We lost everyone.',
          "If anyone can hear this... don't trust what you see.",
        ],
        fallbackRate: 0.88,
        fallbackPitch: 0.78,
      },
      {
        kind: 'sfx',
        sfxKind: 'tense_pause',
        durationMs: 1550,
        cueLabel: '[PAUSE]',
      },
      {
        kind: 'speech',
        segmentId: 'b3_field_2',
        speaker: 'FIELD OPERATOR — WHISPERING',
        voiceName: 'Fenrir',
        voiceStyle: 'Frozen, breathless, terrified whisper',
        filterProfile: 'field_whisper',
        ttsPromptText: 'Something is outside.',
        lines: ['Something is outside.'],
        fallbackRate: 0.84,
        fallbackPitch: 0.75,
      },
      {
        kind: 'sfx',
        sfxKind: 'transmission_cuts',
        durationMs: 1400,
        cueLabel: '[TRANSMISSION CUTS]',
      },
    ],
    transcript: [
      {
        type: 'speaker',
        speaker: 'EMERGENCY DISPATCH',
        lines: [
          'Attention, all remaining survivors.',
          'The city has been declared a restricted zone.',
          'Medical facilities and emergency shelters are no longer considered secure.',
          'Avoid open streets. Keep your lights off. Do not respond to unidentified voices.',
        ],
      },
      { type: 'cue', cue: '[LONG STATIC]' },
      {
        type: 'speaker',
        speaker: 'FIELD OPERATOR — WHISPERING',
        lines: [
          "They're everywhere.",
          'We lost the station. We lost everyone.',
          "If anyone can hear this... don't trust what you see.",
        ],
      },
      { type: 'cue', cue: '[PAUSE]' },
      {
        type: 'speaker',
        speaker: 'FIELD OPERATOR — WHISPERING',
        lines: ['Something is outside.'],
      },
      { type: 'cue', cue: '[TRANSMISSION CUTS]' },
    ],
  },

  // 6. 3:00 AM — No one is coming (4.0h)
  {
    id: 'broadcast_0300am',
    number: 6,
    timeLabel: '3:00 AM',
    triggerGameHours: 4.0,
    headline: 'Final Operational Update — Ground Units Withdrawn',
    subtitle: 'Central Command Lost · Weak Signal',
    toneSummary: 'Almost no composure left · Long pauses · Weak signal',
    urgent: true,
    steps: [
      {
        kind: 'sfx',
        sfxKind: 'breaking_news_distorted',
        durationMs: 1850,
      },
      {
        kind: 'speech',
        segmentId: 'b0300_dispatch',
        speaker: 'EMERGENCY DISPATCH',
        voiceName: 'Kore',
        voiceStyle:
          'Broken, hollow, trembling dispatcher with almost no composure left, speaking slowly with long heavy pauses over a weak dying radio signal',
        filterProfile: 'studio_anchor_weak',
        ttsPromptText:
          'Attention... <breath> anyone receiving this transmission. This is the final operational update. All ground units have withdrawn. <breath> Communication with the central command has been lost. We are unable to confirm the status of remaining personnel.',
        lines: [
          'Attention... anyone receiving this transmission.',
          'This is the final operational update.',
          'All ground units have withdrawn.',
          'Communication with the central command has been lost.',
          'We are unable to confirm the status of remaining personnel.',
        ],
        fallbackRate: 0.89,
        fallbackPitch: 0.88,
      },
      {
        kind: 'sfx',
        sfxKind: 'static_burst',
        durationMs: 1500,
        cueLabel: '[STATIC]',
      },
      {
        kind: 'speech',
        segmentId: 'b0300_field_1',
        speaker: 'FIELD OPERATOR',
        voiceName: 'Fenrir',
        voiceStyle:
          'Quiet, unnerved, exhausted survivor speaking slowly and cautiously over a weak walkie-talkie',
        filterProfile: 'field_walkie',
        ttsPromptText:
          'I can see the station from here. There are lights inside. Someone is moving. <breath> I thought everyone had left.',
        lines: [
          'I can see the station from here.',
          'There are lights inside.',
          'Someone is moving.',
          'I thought everyone had left.',
        ],
        fallbackRate: 0.91,
        fallbackPitch: 0.84,
      },
      {
        kind: 'sfx',
        sfxKind: 'tense_pause',
        durationMs: 1850,
        cueLabel: '[PAUSE]',
      },
      {
        kind: 'speech',
        segmentId: 'b0300_field_2',
        speaker: 'FIELD OPERATOR',
        voiceName: 'Fenrir',
        voiceStyle:
          'Sudden chill of realization, hushed voice dropping in horror with a long pause',
        filterProfile: 'field_walkie',
        ttsPromptText: "Wait... <gasp> That's not a person.",
        lines: ['Wait...', "That's not a person."],
        fallbackRate: 0.85,
        fallbackPitch: 0.8,
      },
      {
        kind: 'sfx',
        sfxKind: 'heavy_static',
        durationMs: 2400,
        cueLabel: '[HEAVY STATIC]',
      },
      {
        kind: 'speech',
        segmentId: 'b0300_unknown',
        speaker: 'UNKNOWN VOICE — VERY QUIET',
        voiceName: 'Charon',
        voiceStyle:
          'Uncanny, deadpan, chillingly quiet hollow whisper spoken right against the microphone in the dark',
        filterProfile: 'unknown_whisper',
        ttsPromptText: "You're still here.",
        lines: ["You're still here."],
        fallbackRate: 0.78,
        fallbackPitch: 0.62,
      },
      {
        kind: 'sfx',
        sfxKind: 'transmission_cuts',
        durationMs: 1450,
        cueLabel: '[TRANSMISSION CUTS]',
      },
    ],
    transcript: [
      {
        type: 'speaker',
        speaker: 'EMERGENCY DISPATCH',
        lines: [
          'Attention... anyone receiving this transmission.',
          'This is the final operational update.',
          'All ground units have withdrawn.',
          'Communication with the central command has been lost.',
          'We are unable to confirm the status of remaining personnel.',
        ],
      },
      { type: 'cue', cue: '[STATIC]' },
      {
        type: 'speaker',
        speaker: 'FIELD OPERATOR',
        lines: [
          'I can see the station from here.',
          'There are lights inside.',
          'Someone is moving.',
          'I thought everyone had left.',
        ],
      },
      { type: 'cue', cue: '[PAUSE]' },
      {
        type: 'speaker',
        speaker: 'FIELD OPERATOR',
        lines: ['Wait...', "That's not a person."],
      },
      { type: 'cue', cue: '[HEAVY STATIC]' },
      {
        type: 'speaker',
        speaker: 'UNKNOWN VOICE — VERY QUIET',
        lines: ["You're still here."],
      },
      { type: 'cue', cue: '[TRANSMISSION CUTS]' },
    ],
  },

  // 7. 5:00 AM — Final evacuation announcement (6.0h)
  {
    id: 'broadcast_0500am',
    number: 7,
    timeLabel: '5:00 AM',
    triggerGameHours: 6.0,
    headline: 'Final Evacuation Announcement — Rooftop Sector C',
    subtitle: 'Extraction Helicopter Inbound · Activate Signal',
    toneSummary: 'Urgent, exhausted, last chance',
    urgent: true,
    steps: [
      {
        kind: 'sfx',
        sfxKind: 'breaking_news_intro',
        durationMs: 1750,
      },
      {
        kind: 'speech',
        segmentId: 'b4_dispatch_1',
        speaker: 'EMERGENCY DISPATCH',
        voiceName: 'Kore',
        voiceStyle:
          'Urgent, exhausted breaking news evacuation commander delivering the final rescue instructions on emergency radio',
        filterProfile: 'evac_command',
        ttsPromptText:
          'This is evacuation command. An extraction helicopter is approaching rooftop sector C. All remaining survivors must reach the designated extraction point immediately. Activate your signal. Remain visible. Do not leave the rooftop once the aircraft establishes visual contact. We cannot guarantee another extraction.',
        lines: [
          'This is evacuation command.',
          'An extraction helicopter is approaching rooftop sector C.',
          'All remaining survivors must reach the designated extraction point immediately.',
          'Activate your signal. Remain visible. Do not leave the rooftop once the aircraft establishes visual contact.',
          'We cannot guarantee another extraction.',
        ],
        fallbackRate: 1.0,
        fallbackPitch: 0.93,
      },
      {
        kind: 'sfx',
        sfxKind: 'tense_pause',
        durationMs: 1500,
        cueLabel: '[PAUSE]',
      },
      {
        kind: 'speech',
        segmentId: 'b4_dispatch_2',
        speaker: 'EMERGENCY DISPATCH',
        voiceName: 'Kore',
        voiceStyle:
          'Exhausted, emotional, resolute voice offering a final message of hope over emergency radio',
        filterProfile: 'evac_command',
        ttsPromptText: 'To anyone still out there... <breath> Hold on. We are coming.',
        lines: ['To anyone still out there...', 'Hold on.', "We're coming."],
        fallbackRate: 0.9,
        fallbackPitch: 0.9,
      },
      {
        kind: 'sfx',
        sfxKind: 'squelch_out',
        durationMs: 550,
      },
    ],
    transcript: [
      {
        type: 'speaker',
        speaker: 'EMERGENCY DISPATCH',
        lines: [
          'This is evacuation command.',
          'An extraction helicopter is approaching rooftop sector C.',
          'All remaining survivors must reach the designated extraction point immediately.',
          'Activate your signal. Remain visible. Do not leave the rooftop once the aircraft establishes visual contact.',
          'We cannot guarantee another extraction.',
        ],
      },
      { type: 'cue', cue: '[PAUSE]' },
      {
        type: 'speaker',
        speaker: 'EMERGENCY DISPATCH',
        lines: ['To anyone still out there...', 'Hold on.', "We're coming."],
      },
    ],
  },
];

export const ALL_SPEECH_SEGMENTS: Map<string, RadioSpeechSegmentDef> = new Map(
  RADIO_BROADCASTS.flatMap((b) =>
    b.steps.filter((s): s is RadioSpeechSegmentDef => s.kind === 'speech')
  ).map((seg) => [seg.segmentId, seg])
);

export function formatBroadcastSummaryText(b: RadioBroadcastDef): string {
  return b.transcript
    .map((block) => {
      if (block.type === 'cue') return block.cue || '';
      return `${block.speaker}: ${(block.lines || []).join(' ')}`;
    })
    .join('\n');
}
