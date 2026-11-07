import React from 'react';

export const LastNightTitleSVG: React.FC = () => (
  <svg
    viewBox="0 0 400 176"
    className="w-full h-auto select-none block"
    role="img"
    aria-label="LAST NIGHT"
  >
    <defs>
      <linearGradient id="lnCampfireGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#cf2d33" />
        <stop offset="55%" stopColor="#9f1d22" />
        <stop offset="100%" stopColor="#6e1116" />
      </linearGradient>

      {/* Organic weathered bark, skyscraper windows & stencil fissure mask */}
      <mask id="lnWoodcutDistress">
        <rect x="0" y="0" width="400" height="176" fill="#ffffff" />
        {/* Cracks & weathered notches on N */}
        <polygon points="14,104 26,108 14,112" fill="#000000" />
        <polygon points="82,122 71,126 82,129" fill="#000000" />
        <polygon points="46,96 53,108 48,110" fill="#000000" />
        {/* Skyscraper "I" architectural window cutouts & weathered roofline fissure */}
        <rect x="105" y="75" width="4.2" height="5.5" rx="0.5" fill="#000000" />
        <rect x="112.8" y="75" width="4.2" height="5.5" rx="0.5" fill="#000000" />
        <rect x="101.5" y="86" width="4.2" height="6.2" rx="0.5" fill="#000000" />
        <rect x="108.9" y="86" width="4.2" height="6.2" rx="0.5" fill="#000000" />
        <rect x="116.3" y="86" width="4.2" height="6.2" rx="0.5" fill="#000000" />
        <rect x="101.5" y="97.5" width="4.2" height="6.2" rx="0.5" fill="#000000" />
        <rect x="116.3" y="97.5" width="4.2" height="6.2" rx="0.5" fill="#000000" />
        <rect x="101.5" y="109" width="4.2" height="6.2" rx="0.5" fill="#000000" />
        <rect x="108.9" y="109" width="4.2" height="6.2" rx="0.5" fill="#000000" />
        <rect x="108.9" y="120.5" width="4.2" height="6.2" rx="0.5" fill="#000000" />
        <rect x="116.3" y="120.5" width="4.2" height="6.2" rx="0.5" fill="#000000" />
        <rect x="101.5" y="132" width="4.2" height="6.2" rx="0.5" fill="#000000" />
        <rect x="116.3" y="132" width="4.2" height="6.2" rx="0.5" fill="#000000" />
        {/* Ground-level lobby entrance arch cutout */}
        <rect x="107.5" y="145" width="7" height="11" rx="1" fill="#000000" />
        {/* Subtle battle-damaged notch on tower flank */}
        <polygon points="96,116 102,118.5 96,121" fill="#000000" />
        {/* Cracks & weathered notches on G */}
        <polygon points="142,108 156,112 142,115" fill="#000000" />
        <polygon points="178,70 182,84 185,70" fill="#000000" />
        <polygon points="200,142 192,134 205,137" fill="#000000" />
        {/* Helipad stencil breaks on the (H) outer ring (N/S/E/W aviation gaps) */}
        <rect x="265" y="68" width="6" height="12" fill="#000000" />
        <rect x="265" y="150" width="6" height="12" fill="#000000" />
        <rect x="221" y="112" width="12" height="6" fill="#000000" />
        <rect x="303" y="112" width="12" height="6" fill="#000000" />
        {/* Cracks & weathered notches on T */}
        <polygon points="344,70 348,83 351,70" fill="#000000" />
        <polygon points="359,124 349,128 359,132" fill="#000000" />
      </mask>
    </defs>

    {/* ===================================================================
        UPPER TIER: · L A S T · (Geometric Stencil Caps + Eclipse Motif)
       =================================================================== */}
    <g fill="url(#lnCampfireGrad)">
      {/* Flanking star dots */}
      <circle cx="103" cy="34" r="1.6" opacity="0.85" />
      <circle cx="295" cy="34" r="1.6" opacity="0.85" />

      {/* Orbiting eclipse moon dot above L/A */}
      <circle cx="143" cy="11" r="2.6" />

      {/* L (stencil stem + separated base bar) */}
      <rect x="121" y="18" width="5.5" height="31" rx="0.8" />
      <rect x="130" y="43.5" width="16" height="5.5" rx="0.8" />

      {/* A (clean apex + stencil-gapped crossbar) */}
      <path d="M172 17 L157 49 L163.2 49 L172 28.5 L180.8 49 L187 49 Z" />
      <rect x="166" y="38.5" width="12" height="4.8" rx="0.8" />

      {/* S (two stencil-separated geometric arcs) */}
      <path
        d="M225 23.5 C221 18.5 205 18.5 205 26 C205 31.5 213 33 218 34.2"
        fill="none"
        stroke="url(#lnCampfireGrad)"
        strokeWidth="5.4"
        strokeLinecap="round"
      />
      <path
        d="M204 43.5 C208 48.5 225 48.5 225 40.5 C225 36.2 219 34.8 214.5 33.8"
        fill="none"
        stroke="url(#lnCampfireGrad)"
        strokeWidth="5.4"
        strokeLinecap="round"
      />

      {/* T (top bar + stencil-separated vertical pillar) */}
      <rect x="242" y="18" width="32" height="5.4" rx="0.8" />
      <rect x="255.3" y="27" width="5.4" height="22" rx="0.8" />
    </g>

    {/* ===================================================================
        LOWER TIER: N [Skyscraper-I] G [Helipad-(H)] T
       =================================================================== */}
    <g fill="url(#lnCampfireGrad)" mask="url(#lnWoodcutDistress)">
      {/* N (x: 16..79) */}
      <path d="M16 74 L28 74 L67 133 L67 74 L79 74 L79 156 L67 156 L28 97 L28 156 L16 156 Z" />
      <path d="M16 146 L9 154 L14 156 L19 150 Z" />
      <path d="M79 84 L85 78 L82 76 L77 81 Z" />

      {/* SKYSCRAPER / HIGH-RISE BUILDING "I" (x center: 111, y: 56..156) */}
      {/* Rooftop antenna mast & beacon */}
      <rect x="109.8" y="57" width="2.4" height="12" rx="0.6" />
      <circle cx="111" cy="54.8" r="2" />
      {/* Crown penthouse tier */}
      <rect x="102.5" y="68" width="17" height="14" rx="0.8" />
      {/* Architectural cornice ledge */}
      <rect x="99.5" y="80" width="23" height="3.2" rx="0.6" />
      {/* Main high-rise tower shaft */}
      <rect x="97" y="82.5" width="28" height="70.5" rx="0.8" />
      {/* Street-level foundation plinth */}
      <rect x="93.5" y="151.5" width="35" height="4.5" rx="0.8" />

      {/* G (x: 144..211) */}
      <path d="M208 91 C199 79 187 74 175 74 C155 74 142 91 142 115 C142 139 155 156 176 156 C193 156 206 147 211 134 L211 113 L179 113 L179 124 L199 124 L199 131 C195 140 187 145 176 145 C162 145 154 133 154 115 C154 97 162 85 176 85 C185 85 193 89 199 98 Z" />
      <path d="M145 136 L138 143 L141 146 L148 140 Z" />

      {/* HELICOPTER LANDING PAD (H) IN CIRCLE (center: 268, 115; outer r: 40) */}
      <circle
        cx="268"
        cy="115"
        r="39.5"
        fill="none"
        stroke="#ef4444"
        strokeWidth="6.2"
      />
      {/* Bold Aviation Helipad "H" centered inside the circle */}
      <path d="M249 91 L258.5 91 L258.5 110.2 L277.5 110.2 L277.5 91 L287 91 L287 139 L277.5 139 L277.5 119.8 L258.5 119.8 L258.5 139 L249 139 Z" />

      {/* T (x: 324..380) */}
      <path d="M324 74 L380 74 L380 86 L358 86 L358 156 L346 156 L346 86 L324 86 Z" />
      <path d="M346 148 L339 156 L344 156 L349 151 Z" />
      <path d="M358 148 L365 156 L360 156 L355 151 Z" />
    </g>
  </svg>
);

export const MenuSwallowtailSVG: React.FC<{
  direction: 'right' | 'left';
  className?: string;
}> = ({ direction, className = 'w-4 h-2.5' }) => (
  <svg
    viewBox="0 0 18 10"
    className={`${className} shrink-0 select-none`}
    aria-hidden="true"
  >
    {direction === 'right' ? (
      <polygon points="0,1 12.5,1 18,5 12.5,9 0,9 4.2,5" fill="currentColor" />
    ) : (
      <polygon points="18,1 5.5,1 0,5 5.5,9 18,9 13.8,5" fill="currentColor" />
    )}
  </svg>
);

export const ItemIconSVG: React.FC<{ iconId: string; className?: string }> = ({
  iconId,
  className = 'w-6 h-6',
}) => {
  switch (iconId) {
    case 'knife':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M19 4L9 14l2 2 9-9c.5-1 .5-2 0-3z" fill="#cbd5e1" stroke="#cbd5e1" />
          <path d="M9 14l-5 5 2 2 5-5" stroke="#a16207" strokeWidth="2.4" />
        </svg>
      );
    case 'pipe_wrench':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="#94a3b8" strokeWidth="2.2">
          <path d="M5 19L16 8" />
          <path d="M14 6l4-2 2 2-2 4-4-4z" fill="#64748b" />
        </svg>
      );
    case 'bat':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="#cbd5e1" strokeWidth="2">
          <path d="M4 20l4-4m0 0L18 4c1.5 0 2 .5 2 2L8 16z" fill="#94a3b8" />
        </svg>
      );
    case 'crowbar':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="#ef4444" strokeWidth="2.3">
          <path d="M5 19L16 8c2-2 4-1 3 1l-1 2" strokeLinecap="round" />
          <path d="M5 19l-1 2 3-1" strokeLinecap="round" />
        </svg>
      );
    case 'pistol':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path d="M3 8h16v4h-9l-2 6H4l1.5-6H3V8z" fill="#94a3b8" stroke="#e2e8f0" strokeWidth="1.2" />
        </svg>
      );
    case 'revolver':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path d="M3 9h17v3h-8l-2.5 6H5l1.5-5H3V9z" fill="#cbd5e1" stroke="#f8fafc" strokeWidth="1.2" />
          <circle cx="10.5" cy="11" r="2.2" fill="#475569" />
        </svg>
      );
    case 'shotgun':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path d="M2 11h20v2.5H10l-4 4.5H2.5l2.5-4.5H2V11z" fill="#cbd5e1" />
          <rect x="11" y="13.2" width="6" height="2" fill="#92400e" />
        </svg>
      );
    case 'ammo_9mm':
    case 'ammo_38':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <rect x="5" y="10" width="3" height="9" fill="#eab308" />
          <path d="M5 10l1.5-4L8 10H5z" fill="#d97706" />
          <rect x="10.5" y="10" width="3" height="9" fill="#eab308" />
          <path d="M10.5 10L12 6l1.5 4h-3z" fill="#d97706" />
          <rect x="16" y="10" width="3" height="9" fill="#eab308" />
          <path d="M16 10l1.5-4L19 10h-3z" fill="#d97706" />
        </svg>
      );
    case 'ammo_12g':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <rect x="6" y="6" width="4.5" height="9" fill="#dc2626" />
          <rect x="6" y="15" width="4.5" height="4" fill="#eab308" />
          <rect x="13.5" y="6" width="4.5" height="9" fill="#dc2626" />
          <rect x="13.5" y="15" width="4.5" height="4" fill="#eab308" />
        </svg>
      );
    case 'canned_beans':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <rect x="6" y="5" width="12" height="14" rx="2" fill="#94a3b8" stroke="#e2e8f0" strokeWidth="1.3" />
          <rect x="6" y="9" width="12" height="6" fill="#b45309" />
        </svg>
      );
    case 'water_bottle':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <rect x="10" y="3" width="4" height="3" fill="#38bdf8" />
          <path d="M8 8c0-1.2 1.2-2 2-2h4c.8 0 2 .8 2 2v11a2 2 0 01-2 2h-4a2 2 0 01-2-2V8z" fill="#0284c7" stroke="#7dd3fc" strokeWidth="1.3" />
        </svg>
      );
    case 'ration_bar':
    case 'snacks':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <rect x="4" y="7" width="16" height="10" rx="1.5" fill="#a16207" stroke="#fde047" strokeWidth="1.2" />
          <line x1="9" y1="7" x2="9" y2="17" stroke="#fef08a" strokeWidth="1" />
          <line x1="15" y1="7" x2="15" y2="17" stroke="#fef08a" strokeWidth="1" />
        </svg>
      );
    case 'bandage':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <rect x="4" y="8" width="16" height="8" rx="3" fill="#e2e8f0" />
          <path d="M12 9.5v5M9.5 12h5" stroke="#dc2626" strokeWidth="2" />
        </svg>
      );
    case 'antiseptic':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <rect x="9.5" y="4" width="5" height="3" fill="#f8fafc" />
          <rect x="7" y="7" width="10" height="13" rx="2" fill="#0f766e" stroke="#5eead4" strokeWidth="1.3" />
          <path d="M12 10.5v6M9 13.5h6" stroke="#ccfbf1" strokeWidth="1.8" />
        </svg>
      );
    case 'painkillers':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <rect x="6" y="6" width="12" height="12" rx="2" fill="#334155" stroke="#94a3b8" strokeWidth="1.3" />
          <circle cx="9.5" cy="9.5" r="1.5" fill="#f87171" />
          <circle cx="14.5" cy="9.5" r="1.5" fill="#f8fafc" />
          <circle cx="9.5" cy="14.5" r="1.5" fill="#f8fafc" />
          <circle cx="14.5" cy="14.5" r="1.5" fill="#f87171" />
        </svg>
      );
    case 'medkit':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <rect x="4" y="7" width="16" height="12" rx="2" fill="#b91c1c" stroke="#fca5a5" strokeWidth="1.3" />
          <path d="M9 7V5h6v2" stroke="#fca5a5" strokeWidth="1.5" />
          <path d="M12 10v6M9 13h6" stroke="#ffffff" strokeWidth="2.2" />
        </svg>
      );
    case 'antiviral':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="#a3e635" strokeWidth="1.8">
          <path d="M17 3l4 4M15 5l4 4L9 19l-4 1 1-4L15 5z" fill="#365314" />
          <path d="M4 20l-2 2" />
        </svg>
      );
    case 'powerbank':
    case 'battery':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          {/* Portable USB-C Power Bank housing */}
          <rect
            x="5.5"
            y="3.5"
            width="13"
            height="17"
            rx="2.5"
            fill="#0f172a"
            stroke="#38bdf8"
            strokeWidth="1.4"
          />
          {/* Top USB-C / USB-A output ports */}
          <rect x="8.2" y="5.3" width="3.2" height="1.3" rx="0.5" fill="#94a3b8" />
          <rect x="12.6" y="5.3" width="3.2" height="1.3" rx="0.5" fill="#94a3b8" />
          {/* Charge indicator LEDs */}
          <circle cx="8.5" cy="8.5" r="0.8" fill="#34d399" />
          <circle cx="10.8" cy="8.5" r="0.8" fill="#34d399" />
          <circle cx="13.1" cy="8.5" r="0.8" fill="#34d399" />
          <circle cx="15.4" cy="8.5" r="0.8" fill="#334155" />
          {/* Fast-charge bolt emblem */}
          <path
            d="M12.8 10.6L9.8 14.5h2.6l-.8 3.9 3.2-4.1h-2.6l.6-3.7z"
            fill="#fbbf24"
          />
        </svg>
      );
    case 'flare':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path d="M6 18L15 9l3 3-9 9-3-3z" fill="#dc2626" />
          <circle cx="18" cy="6" r="3" fill="#fde047" />
        </svg>
      );
    case 'noisemaker':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="#38bdf8" strokeWidth="1.8">
          <circle cx="11" cy="13" r="5" fill="#1e293b" />
          <path d="M16 8c2 1.5 2 4.5 0 6M19 5.5c3 2.5 3 7.5 0 10" strokeLinecap="round" />
        </svg>
      );
    case 'fuel_canister':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path d="M6 7l3-3h6l3 3v12a2 2 0 01-2 2H8a2 2 0 01-2-2V7z" fill="#991b1b" stroke="#f87171" strokeWidth="1.3" />
          <path d="M9 11l6 6M15 11l-6 6" stroke="#fca5a5" strokeWidth="1.5" />
        </svg>
      );
    case 'kevlar_vest':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path d="M7 4l3 3h4l3-3 3 4-2 3v9H6v-9L4 8l3-4z" fill="#1e3a5f" stroke="#93c5fd" strokeWidth="1.4" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="#94a3b8" strokeWidth="1.8">
          <rect x="5" y="5" width="14" height="14" rx="2" />
        </svg>
      );
  }
};
