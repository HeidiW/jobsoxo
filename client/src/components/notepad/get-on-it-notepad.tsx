// "Get on it": the team's shared notepad. A lined page you write on freely
// and save. If someone else saved while you were writing, you're asked
// which version to keep instead of one silently replacing the other.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { NotebookPen, Save } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

interface NotepadData {
  content: string;
  updatedAt: string | null;
  updatedByName: string | null;
}

const NOTEPAD_URL = "/api/notepads/get-on-it";
const LINE = 32; // px between ruled lines; the textarea's line-height matches
// Handwriting for the notes; falls back to the app's other script font.
const HANDWRITING = "'Caveat', 'Architects Daughter', cursive";

export function GetOnItNotepad() {
  const query = useQuery<NotepadData>({ queryKey: [NOTEPAD_URL] });
  const [text, setText] = useState("");
  const [base, setBase] = useState<NotepadData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<NotepadData | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const dirty = base !== null && text !== base.content;

  // Take the server's copy whenever there are no local edits to protect.
  useEffect(() => {
    if (!query.data) return;
    if (base === null || !dirty) {
      setBase(query.data);
      setText(query.data.content);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  // Grow with the notes so the page reads like paper, not a scroll box.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, LINE * 8)}px`;
  }, [text]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save(content = text, baseUpdatedAt = base?.updatedAt ?? null) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(NOTEPAD_URL, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, baseUpdatedAt }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setConflict(body.current);
        setError(body.error);
        return;
      }
      if (!res.ok) throw new Error(body.error || "The notepad couldn't be saved.");
      setBase(body);
      setText(body.content);
      setConflict(null);
      queryClient.setQueryData([NOTEPAD_URL], body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The notepad couldn't be saved.");
    } finally {
      setSaving(false);
    }
  }

  const status = saving ? "Saving…"
    : dirty ? "Unsaved changes"
    : base?.updatedAt ? `Saved ${format(new Date(base.updatedAt), "MMM d, h:mm a")}${base.updatedByName ? ` by ${base.updatedByName}` : ""}`
    : "";

  return (
    <section className="mt-4 overflow-hidden rounded-[17px] border shadow-sm" style={{ borderColor: "#e9d98a", background: "#fffbe6" }} aria-label="Get on it notepad" data-testid="get-on-it">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5" style={{ borderColor: "#e9d98a", background: "#fff3b8" }}>
        <h3 className="flex items-center gap-2 font-display text-base !font-bold tracking-[-.02em] text-jx-ink">
          <NotebookPen className="h-4 w-4" aria-hidden="true" />Get on it
        </h3>
        <div className="flex items-center gap-2.5">
          <span className={`text-[11px] ${dirty ? "font-semibold text-jx-orange-ink" : "text-jx-ink-3"}`} aria-live="polite" data-testid="notepad-status">{status}</span>
          <button type="button" onClick={() => void save()} disabled={!dirty || saving}
            className="inline-flex items-center gap-1 rounded-lg bg-jx-green px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
            data-testid="button-save-notepad">
            <Save className="h-3.5 w-3.5" aria-hidden="true" />Save
          </button>
        </div>
      </header>

      {conflict && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 text-sm" style={{ borderColor: "#e9d98a", background: "#fff7d6" }} data-testid="notepad-conflict">
          <span className="text-jx-orange-ink">{error} Keep yours or load theirs?</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => void save(text, conflict.updatedAt)} className="rounded-lg bg-jx-green px-3 py-1.5 text-xs font-bold text-white" data-testid="button-keep-mine">Keep mine</button>
            <button type="button" onClick={() => { setBase(conflict); setText(conflict.content); setConflict(null); setError(null); }}
              className="rounded-lg border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "#e9d98a" }} data-testid="button-load-theirs">Load theirs</button>
          </span>
        </div>
      )}
      {error && !conflict && <p role="alert" className="border-b px-4 py-2 text-sm text-jx-orange-ink" style={{ borderColor: "#e9d98a" }}>{error}</p>}

      <div className="relative pl-10 pr-4" style={{
        backgroundImage: `linear-gradient(to right, transparent 30px, #f2a8a8 30px, #f2a8a8 31.5px, transparent 31.5px), repeating-linear-gradient(to bottom, transparent 0, transparent ${LINE - 1}px, #e8dfae ${LINE - 1}px, #e8dfae ${LINE}px)`,
        backgroundPosition: "0 6px",
      }}>
        {query.isError ? (
          <p className="py-6 text-sm text-jx-orange-ink">The notepad didn't load.</p>
        ) : (
          <textarea
            ref={ref}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (dirty) void save(); }
            }}
            placeholder={query.isLoading ? "Loading…" : "Jot down what needs doing: materials to order, calls to make, jobs to chase…"}
            disabled={query.isLoading}
            spellCheck
            aria-label="Get on it notes"
            className="block w-full resize-none overflow-hidden border-0 bg-transparent py-[6px] text-[24px] font-medium text-jx-ink outline-none placeholder:text-jx-ink-3"
            style={{ lineHeight: `${LINE}px`, minHeight: LINE * 8, fontFamily: HANDWRITING }}
            data-testid="input-notepad"
          />
        )}
      </div>
    </section>
  );
}
