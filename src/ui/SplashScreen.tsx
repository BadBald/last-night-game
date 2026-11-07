import { useEffect, useRef, useState } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

// A minimal two-beat splash shown once on first load, before the title menu.
// Beat 1: the game's helipad "H" emblem on pure blackness, with a 2D
// survivor walking around it in the dark, his flashlight sweeping the H.
// Beat 2: the Clatter Games studio logo.
// No game logic is touched; this is a pure overlay.
export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<0 | 1 | 2>(0); // 0 = H, 1 = studio, 2 = done
  const [visible, setVisible] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
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

  // Orbiting survivor + flashlight, only during beat 1.
  useEffect(() => {
    if (phase !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let angle = 0;
    let raf = 0;
    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const orbit = Math.min(w, h) * 0.26;
      angle += 0.013;

      const px = cx + Math.cos(angle) * orbit;
      const py = cy + Math.sin(angle) * orbit;

      // Flashlight beam pointing from the survivor toward the H.
      const beamLen = orbit * 0.95;
      const beamAngle = Math.atan2(cy - py, cx - px);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(beamAngle);
      const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, beamLen);
      grad.addColorStop(0, 'rgba(250, 240, 200, 0.6)');
      grad.addColorStop(0.6, 'rgba(250, 240, 200, 0.18)');
      grad.addColorStop(1, 'rgba(250, 240, 200, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, beamLen, -0.32, 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Survivor body (top-down): jacket dot + head.
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#9f1d22';
      ctx.fill();
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [phase]);

  if (phase === 2) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-[#090706] select-none overflow-hidden"
      style={{ pointerEvents: 'all' }}
    >
      {phase === 0 && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: 'none' }}
        />
      )}
      <div
        className="relative z-10 flex flex-col items-center justify-center w-full h-full gap-6 transition-opacity duration-500"
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