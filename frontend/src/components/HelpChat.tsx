import { useState } from 'react';
import { aiApi } from '../services/api';
import { MessageCircleQuestion, X, Send, Loader2 } from 'lucide-react';

type Turn = { role: 'user' | 'assistant'; content: string };

const WELCOME: Turn = {
  role: 'assistant',
  content:
    'Hi — I answer onboarding questions about **groups**, **projects**, **mentorship requests**, **roles**, and **eligibility**. I only use the built‑in FAQ. What would you like to know?',
};

export const HelpChat = () => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([WELCOME]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setError('');

    const userTurn: Turn = { role: 'user', content: text };
    setTurns((prev) => [...prev, userTurn]);
    setLoading(true);

    const historySlice = [...turns, userTurn].slice(-11);

    try {
      const res = await aiApi.post<{ reply: string }>('/chat/faq', {
        message: text,
        history: historySlice.slice(0, -1).map((t) => ({ role: t.role, content: t.content })),
      });

      const reply = res.data.reply?.trim() || 'Sorry — no reply from help service.';
      setTurns((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail;
      let msg =
        typeof detail === 'string'
          ? detail
          : 'Could not reach help service. Make sure the AI feedback service is running.';
      if (status === 429) {
        msg = 'You are sending messages too quickly. Please wait about a minute.';
      }
      setError(msg);
      setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'user' && last.content === text) next.pop();
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-2xl bg-primary-600 text-white shadow-lg hover:bg-primary-700 transition-colors text-sm font-medium"
        aria-label="Open help chat"
      >
        <MessageCircleQuestion className="w-5 h-5 shrink-0" />
        Help
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-40 w-[min(100vw-3rem,22rem)] max-h-[min(70vh,28rem)] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
            <span className="text-sm font-semibold text-slate-900">AcadConnect help</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 text-slate-500 hover:text-slate-700 rounded-lg"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[200px] max-h-[360px]">
            {turns.map((t, i) => (
              <div
                key={i}
                className={`text-sm rounded-xl px-3 py-2 ${
                  t.role === 'user'
                    ? 'ml-6 bg-primary-50 text-slate-900 border border-primary-100'
                    : 'mr-4 bg-slate-50 text-slate-800 border border-slate-100'
                }`}
              >
                <p className="whitespace-pre-wrap">{t.content}</p>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-slate-500 text-xs px-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Thinking…
              </div>
            )}
          </div>

          {error && (
            <div className="px-3 py-2 text-xs text-red-600 bg-red-50 border-t border-red-100">{error}</div>
          )}

          <form
            className="p-3 border-t border-slate-100 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about groups, mentors…"
              className="flex-1 text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              maxLength={2000}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="shrink-0 p-2 rounded-lg bg-primary-600 text-white disabled:opacity-40"
              aria-label="Send"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </form>
        </div>
      )}
    </>
  );
};
