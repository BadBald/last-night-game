import React, { useEffect, useRef, useState } from 'react';
import { X, Send, MessageCircle } from 'lucide-react';
import { UISnapshot } from '../types';

export const ChatModal: React.FC<{
  snap: UISnapshot;
  onClose: () => void;
  onSend: (text: string) => void;
}> = ({ snap, onClose, onSend }) => {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [snap.online.chatMessages.length]);

  const handleSend = () => {
    const t = draft.trim();
    if (!t) return;
    onSend(t);
    setDraft('');
    inputRef.current?.focus();
  };

  return (
    <div className="fixed inset-0 z-40 bg-[#070504]/86 pointer-events-auto flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-md max-h-[85dvh] flex flex-col bg-[#120d0a]/96 border border-[#e4d4c6]/18 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#e4d4c6]/14">
          <h2 className="font-display text-xl font-bold tracking-[0.06em] text-[#f7f2e7] flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-[#f39c59]" />
            Squad Chat
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] rounded-xl bg-[#19130f] hover:bg-[#231a14] border border-[#e4d4c6]/16 text-[#d8c7b4] flex items-center justify-center cursor-pointer"
            aria-label="Close Chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto scroll-touch px-4 py-3 space-y-2 min-h-[200px]"
        >
          {snap.online.chatMessages.length === 0 && (
            <p className="text-xs text-[#9c8b79] text-center mt-8">
              No messages yet. Say hi to your squad.
            </p>
          )}
          {snap.online.chatMessages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.isSelf ? 'items-end' : 'items-start'}`}
            >
              <span className="text-[10px] font-mono-num text-[#9c8b79] mb-0.5">
                {m.fromCallsign}
              </span>
              <div
                className={`max-w-[85%] px-3 py-1.5 rounded-xl text-xs leading-relaxed ${
                  m.isSelf
                    ? 'bg-[#c9363b] text-[#120d0a] rounded-br-sm'
                    : 'bg-[#19130f] border border-[#e4d4c6]/16 text-[#f7f2e7] rounded-bl-sm'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 px-3 py-3 border-t border-[#e4d4c6]/14">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type a message..."
            className="flex-1 min-h-[40px] px-3 py-2 rounded-xl bg-[#0b0705] border border-[#e4d4c6]/16 text-[#f7f2e7] text-xs placeholder:text-[#9c8b79] focus:outline-none focus:border-[#c9363b]/60"
            maxLength={200}
          />
          <button
            type="button"
            onClick={handleSend}
            className="min-w-[40px] min-h-[40px] rounded-xl bg-[#c9363b] hover:bg-[#d95338] text-[#120d0a] flex items-center justify-center cursor-pointer"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 pb-2 text-[10px] text-[#9c8b79]">
          Press T or tap the in-game mic to toggle voice chat. Messages reach all squad members.
        </div>
      </div>
    </div>
  );
};