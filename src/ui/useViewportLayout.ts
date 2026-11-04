import { useEffect, useState } from 'react';

export interface ViewportLayout {
  width: number;
  height: number;
  isLandscape: boolean;
  /** True on phones/handhelds held horizontally (e.g. 667x375, 844x390, 932x430) */
  isCompactLandscape: boolean;
}

function readViewport(): ViewportLayout {
  if (typeof window === 'undefined') {
    return {
      width: 1280,
      height: 800,
      isLandscape: true,
      isCompactLandscape: false,
    };
  }
  const width = Math.round(window.visualViewport?.width ?? window.innerWidth);
  const height = Math.round(window.visualViewport?.height ?? window.innerHeight);
  const isLandscape = width > height;
  const isCompactLandscape = isLandscape && height <= 560;
  return { width, height, isLandscape, isCompactLandscape };
}

export function useViewportLayout(): ViewportLayout {
  const [layout, setLayout] = useState<ViewportLayout>(readViewport);

  useEffect(() => {
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setLayout(readViewport());
      });
    };

    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    window.visualViewport?.addEventListener('resize', sync);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
      window.visualViewport?.removeEventListener('resize', sync);
    };
  }, []);

  return layout;
}
