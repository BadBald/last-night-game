import { useEffect, useRef, useState } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

// A minimal two-beat splash shown once on first load, before the title menu.
// Beat 1 (~5.5s): the "LAST NIGHT" logo (lastnightlogo splash.png) with
// survivors walking toward the red-circled H, flashlights pointing at it.
// Beat 2 (~1.5s): the Clatter Games studio logo.
// Total ~7s. No game logic is touched; this is a pure overlay.
export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<0 | 1 | 2>(0); // 0 = H, 1 = studio, 2 = done
  const [visible, setVisible] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logoRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const t0 = window.setTimeout(() => setVisible(true), 60);
    const t1 = window.setTimeout(() => setVisible(false), 5200);
    const t2 = window.setTimeout(() => {
      setPhase(1);
      setVisible(true);
    }, 5500);
    const t3 = window.setTimeout(() => setVisible(false), 6700);
    const t4 = window.setTimeout(() => {
      setPhase(2);
      onComplete();
    }, 7000);

    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
  }, [onComplete]);

  // Survivors walking toward the red-circled H inside the splash logo.
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

    // H center within the splash image (fraction of image dimensions).
    const H_FRAC_X = 2662 / 3361;
    const H_FRAC_Y = 531 / 1080;

    const getTarget = () => {
      const img = logoRef.current;
      if (img) {
        const r = img.getBoundingClientRect();
        if (r.width > 0) {
          return { x: r.left + r.width * H_FRAC_X, y: r.top + r.height * H_FRAC_Y };
        }
      }
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    };

    const makeSurvivor = (w: number, h: number) => {
      const side = Math.floor(Math.random() * 4);
      let x = 0, y = 0;
      if (side === 0) { x = Math.random() * w; y = -20; }
      else if (side === 1) { x = w + 20; y = Math.random() * h; }
      else if (side === 2) { x = Math.random() * w; y = h + 20; }
      else { x = -20; y = Math.random() * h; }
      return { x, y, speed: 0.9 + Math.random() * 0.6 };
    };

    const survivors = Array.from({ length: 6 }, () => makeSurvivor(canvas.width, canvas.height));

    let raf = 0;
    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const target = getTarget();

      for (const s of survivors) {
        const dx = target.x - s.x;
        const dy = target.y - s.y;
        const dist = Math.hypot(dx, dy) || 1;
        s.x += (dx / dist) * s.speed;
        s.y += (dy / dist) * s.speed;

        if (dist < 30) {
          const ns = makeSurvivor(w, h);
          s.x = ns.x;
          s.y = ns.y;
          s.speed = ns.speed;
        }

        const beamAngle = Math.atan2(dy, dx);
        const beamLen = 70;

        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(beamAngle);
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, beamLen);
        grad.addColorStop(0, 'rgba(250, 240, 200, 0.65)');
        grad.addColorStop(0.5, 'rgba(250, 240, 200, 0.2)');
        grad.addColorStop(1, 'rgba(250, 240, 200, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, beamLen, -0.3, 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#c9363b';
        ctx.fill();
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#f8fafc';
        ctx.fill();
      }

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
          <img
            ref={logoRef}
            src="/assets/lastnightlogo/lastnightlogo%20splash.png"
            alt="LAST NIGHT"
            className="w-[90vw] max-w-[1200px] h-auto"
            draggable={false}
          />
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