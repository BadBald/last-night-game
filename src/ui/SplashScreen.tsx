import { useEffect, useState } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

// A minimal two-beat splash shown once on first load, before the title menu.
// Beat 1: the game's helipad "H" emblem + "LAST NIGHT".
// Beat 2: the Clatter Games studio logo.
// No game logic is touched; this is a pure overlay.
export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<0 | 1 | 2>(0); // 0 = H, 1 = studio, 2 = done
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Fade in the first beat.
    const t0 = window.setTimeout(() => setVisible(true), 60);
    const t1 = window.setTimeout(() => setVisible(false), 2000);
    const t2 = window.setTimeout(() => {
      setPhase(1);
      setVisible(true);
    }, 2300);
    const t3 = window.setTimeout(() => setVisible(false), 4200);
    const t4 = window.setTimeout(() => {
      setPhase(2);
      onComplete();
    }, 4600);

    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
  }, [onComplete]);

  if (phase === 2) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#090706] select-none"
      style={{ pointerEvents: 'all' }}
    >
      <div
        className="flex flex-col items-center justify-center gap-6 transition-opacity duration-500"
        style={{ opacity: visible ? 1 : 0 }}
      >
        {phase === 0 ? (
          <>
            <img
              src="/helipad-h.svg"
              alt="LAST NIGHT helipad emblem"
              className="w-32 h-32 sm:w-40 sm:h-40 drop-shadow-[0_0_24px_rgba(245,158,11,0.35)]"
              draggable={false}
            />
            <div className="font-display text-4xl sm:text-6xl font-bold tracking-[0.18em] text-[#f8fafc]">
              LAST NIGHT
            </div>
            <div className="text-xs sm:text-sm font-mono-num tracking-[0.3em] text-[#9c8b79]">
              SEVEN HOURS. ONE CHANCE.
            </div>
          </>
        ) : (
          <>
            <img
              src="/assets/clatter%20games%20studio/Clatter%20games%20transparent%20background.png"
              alt="Clatter Games"
              className="w-64 sm:w-80 h-auto drop-shadow-[0_0_18px_rgba(0,0,0,0.6)]"
              draggable={false}
            />
            <div className="text-[10px] sm:text-xs font-mono-num tracking-[0.35em] text-[#9c8b79]">
              A CLATTER GAMES PRODUCTION
            </div>
          </>
        )}
      </div>
    </div>
  );
}