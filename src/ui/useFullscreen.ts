import { useCallback, useEffect, useState } from 'react';

interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface WebkitHTMLElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

function getActiveFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const doc = document as WebkitDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    Boolean(getActiveFullscreenElement())
  );
  const [fullscreenHint, setFullscreenHint] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setIsFullscreen(Boolean(getActiveFullscreenElement()));
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  useEffect(() => {
    if (!fullscreenHint) return;
    const id = window.setTimeout(() => setFullscreenHint(null), 4200);
    return () => window.clearTimeout(id);
  }, [fullscreenHint]);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    const doc = document as WebkitDocument;
    const root = document.documentElement as WebkitHTMLElement;

    try {
      if (getActiveFullscreenElement()) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
        const orientationApi = screen.orientation as ScreenOrientation & {
          unlock?: () => void;
        };
        orientationApi?.unlock?.();
        return;
      }

      if (root.requestFullscreen) {
        await root.requestFullscreen({ navigationUI: 'hide' });
      } else if (root.webkitRequestFullscreen) {
        await root.webkitRequestFullscreen();
      } else {
        setFullscreenHint(
          'On iPhone Safari, tap Share → Add to Home Screen for full edge-to-edge screen.'
        );
        return;
      }

      // Best-effort landscape lock on mobile touch devices when entering fullscreen
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const orientationApi = screen.orientation as ScreenOrientation & {
        lock?: (mode: string) => Promise<void>;
      };
      if (isTouch && orientationApi?.lock) {
        orientationApi.lock('landscape').catch(() => {
          // Portrait or browser policy does not enforce orientation lock — allow either orientation cleanly
        });
      }
    } catch {
      setFullscreenHint(
        'Fullscreen blocked by browser tab — open app in a standalone tab or Add to Home Screen.'
      );
    }
  }, []);

  return {
    isFullscreen,
    toggleFullscreen,
    fullscreenHint,
  };
}
