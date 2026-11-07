import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from './usePWAInstall';

export const PWAInstallButton: React.FC<{
  compact?: boolean;
  variant?: 'primary' | 'secondary';
}> = ({ compact = false, variant = 'primary' }) => {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuide(true);
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Ignore clipboard restriction
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          compact
            ? variant === 'secondary'
              ? 'min-h-[42px] w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#19130f] hover:bg-[#231a14] border border-[#c9363b]/40 text-[#f39c59] text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer'
              : 'min-h-[40px] flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#c9363b] hover:bg-[#d95338] text-[#120d0a] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer'
            : 'min-h-[46px] py-2.5 px-5 rounded-xl bg-[#19130f] hover:bg-[#231a14] border border-[#c9363b]/40 text-[#f39c59] text-sm font-medium text-left flex items-center justify-between transition-colors whitespace-nowrap cursor-pointer'
        }
      >
        <span className="flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>{isIOS ? 'Install iOS' : 'Install App'}</span>
        </span>
        {!compact && (
          <span className="text-xs font-mono-num text-[#9c8b79]">Offline Ready</span>
        )}
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 bg-[#070504]/88 pointer-events-auto flex items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto scroll-touch bg-[#120d0a] border border-[#e4d4c6]/18 rounded-2xl p-5 sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#e4d4c6]/14">
              <h3 className="font-display text-2xl font-bold tracking-wide text-[#f7f2e7]">
                Install LAST NIGHT
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-w-[42px] min-h-[42px] rounded-xl bg-[#19130f] hover:bg-[#231a14] border border-[#e4d4c6]/16 text-[#d8c7b4] flex items-center justify-center cursor-pointer"
                aria-label="Close Install Guide"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="mt-4 space-y-2.5 text-xs text-[#d8c7b4] leading-relaxed">
                <p>1. Open this game directly in <strong className="text-[#f7f2e7]">Safari</strong>.</p>
                <p>2. Tap the <strong className="text-[#f7f2e7]">Share</strong> icon in the Safari toolbar.</p>
                <p>3. Scroll down and select <strong className="text-[#f7f2e7]">Add to Home Screen</strong>.</p>
              </div>
            ) : isInIframe ? (
              <div className="mt-4 space-y-3 text-xs text-[#d8c7b4] leading-relaxed">
                <p>
                  Chrome and Edge block app installation while a page is inside a preview frame. To install <strong className="text-[#f7f2e7]">LAST NIGHT</strong> as a standalone desktop or mobile app:
                </p>
                <p>
                  1. Open the standalone game link in its own Chrome or Edge tab (use the <strong className="text-[#f7f2e7]">Open in new tab</strong> icon in the top-right preview toolbar, or copy the link below).
                </p>
                <p>
                  2. Click <strong className="text-[#f7f2e7]">Install App</strong> in Options or click the install icon in your browser address bar.
                </p>
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="w-full py-2 px-3 rounded-lg bg-[#19130f] hover:bg-[#231a14] border border-[#e4d4c6]/16 text-[#f39c59] font-mono-num text-xs cursor-pointer"
                >
                  {copied ? 'Direct App URL Copied!' : 'Copy Direct App URL'}
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-2.5 text-xs text-[#d8c7b4] leading-relaxed">
                <p>
                  Open your browser menu (<strong className="text-[#f7f2e7]">⋮</strong> in Chrome or Edge) and select <strong className="text-[#f7f2e7]">Install LAST NIGHT</strong> or <strong className="text-[#f7f2e7]">Add to Home screen</strong>.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full py-2.5 rounded-lg bg-[#c9363b] hover:bg-[#d95338] text-[#120d0a] text-xs font-semibold cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 bg-[#140e0b]/95 border border-[#c9363b]/60 rounded-lg px-3 py-1.5 text-xs font-medium text-[#f7f2e7] pointer-events-none">
      Offline Mode · Running from local cache
    </div>
  );
};
