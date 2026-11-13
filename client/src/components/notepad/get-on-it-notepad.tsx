// "Get on it": the team's shared notepad. A lined page you write on freely.
// It saves itself: a moment after you stop typing, when you leave the page,
// and on Cmd/Ctrl+S. While a save is pending the text is also kept in this
// browser, so a refresh, crash or lost connection doesn't lose it. If someone
// else saved while you were writing, you're asked which version to keep.
// Earlier versions can be brought back from History.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { History, NotebookPen, RotateCcw, X } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

interface NotepadData {
  content: string;
  updatedAt: string | null;
  updatedByName: string | null;
}
interface NotepadVersion {
  id: string;
  content: string;
  savedAt: string;
  savedByName: string | null;
}

const NOTEPAD_ID = "get-on-it";
const NOTEPAD_URL = `/api/notepads/${NOTEPAD_ID}`;
const DRAFT_KEY = `jobsoxo.notepad.${NOTEPAD_ID}.draft`;
const AUTOSAVE_DELAY = 1200; // ms after the last keystroke
const RETRY_DELAY = 5000;
const LINE = 32; // px between ruled lines; the textarea's line-height matches
// Handwriting for the notes; falls back to the app's other script font.
const HANDWRITING = "'Caveat', 'Architects Daughter', cursive";

/** Unsaved text kept in this browser until the server has it. Reads and writes never throw. */
const draftStore = {
  read(): { content: string; baseUpdatedAt: string | null } | null {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  write(content: string, baseUpdatedAt: string | null) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ content, baseUpdatedAt })); } catch { /* storage unavailable */ }
  },
  clear() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
  },
};

const when = (iso: string) => format(new Date(iso), "MMM d, h:mm a");

export function GetOnItNotepad() {
  const query = useQuery<NotepadData>({ queryKey: [NOTEPAD_URL] });
  const [text, setText] = useState("");
  const [base, setBase] = useState<NotepadData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<NotepadData | null>(null);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ text, base, saving, conflict });
  latest.current = { text, base, saving, conflict };
  const dirty = base !== null && text !== base.content;

  // Take the server's copy when there are no local edits to protect. On first
  // load, a draft left in this browser (a refresh mid-sentence, a crash) wins
  // over the server copy it was written on top of, and is saved right away.
  useEffect(() => {
    if (!query.data) return;
    if (base === null) {
      const draft = draftStore.read();
      if (draft && draft.content !== query.data.content && draft.baseUpdatedAt === query.data.updatedAt) {
        setBase(query.data);
        setText(draft.content);
        setRestoredDraft(true);
        return;
      }
      if (draft) draftStore.clear();
      setBase(query.data);
      setText(query.data.content);
    } else if (!dirty) {
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

  const save = useCallback(async (content?: string, baseUpdatedAt?: string | null, keepalive = false) => {
    const current = latest.current;
    const body = { content: content ?? current.text, baseUpdatedAt: baseUpdatedAt === undefined ? current.base?.updatedAt ?? null : baseUpdatedAt };
    if (current.saving && !keepalive) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(NOTEPAD_URL, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), keepalive,
      });
      const result = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setConflict(result.current);
        setError(result.error);
        return;
      }
      if (!res.ok) throw new Error(result.error || "The notepad couldn't be saved.");
      setBase(result);
      setConflict(null);
      setRestoredDraft(false);
      // Only forget the draft if nothing was typed while the save was in flight.
      if (latest.current.text === body.content) { draftStore.clear(); setText(result.content); }
      else draftStore.write(latest.current.text, result.updatedAt);
      queryClient.setQueryData([NOTEPAD_URL], result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The notepad couldn't be saved.");
      timer.current = setTimeout(() => void save(), RETRY_DELAY);
    } finally {
      setSaving(false);
    }
  }, []);

  // Autosave: keep the draft locally at once, send it a moment after typing stops.
  useEffect(() => {
    if (!dirty || conflict) return;
    draftStore.write(text, base?.updatedAt ?? null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY);
    return () => { if (timer.current) clearTimeout(timer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, dirty, conflict]);

  // Leaving the page or the tab: send what's there now rather than wait.
  useEffect(() => {
    const flush = () => {
      const current = latest.current;
      if (current.base && current.text !== current.base.content && !current.conflict) void save(undefined, undefined, true);
    };
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [save]);

  function restoreVersion(version: NotepadVersion) {
    setText(version.content);
    setHistoryOpen(false);
  }

  const status = conflict ? "Needs your decision"
    : saving ? "Saving…"
    : error ? "Not saved yet, retrying"
    : dirty ? "Saving soon…"
    : base?.updatedAt ? `Saved ${when(base.updatedAt)}${base.updatedByName ? ` by ${base.updatedByName}` : ""}`
    : "";

  return (
    <section className="mt-4 overflow-hidden rounded-[17px] border shadow-sm" style={{ borderColor: "#e9d98a", background: "#fffbe6" }} aria-label="Get on it notepad" data-testid="get-on-it">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5" style={{ borderColor: "#e9d98a", background: "#fff3b8" }}>
        <h3 className="flex items-center gap-2 font-display text-base !font-bold tracking-[-.02em] text-jx-ink">
          <NotebookPen className="h-4 w-4" aria-hidden="true" />Get on it
        </h3>
        <div className="flex items-center gap-3">
          <span className={`text-[11px] ${dirty || error ? "font-semibold text-jx-orange-ink" : "text-jx-ink-3"}`} aria-live="polite" data-testid="notepad-status">{status}</span>
          <button type="button" onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen}
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-jx-ink" style={{ borderColor: "#e9d98a" }}
            data-testid="button-notepad-history">
            <History className="h-3.5 w-3.5" aria-hidden="true" />History
          </button>
        </div>
      </header>

      {restoredDraft && !conflict && (
        <p role="status" className="border-b px-4 py-2 text-sm text-jx-ink-2" style={{ borderColor: "#e9d98a", background: "#fff7d6" }} data-testid="notepad-draft-restored">
          Notes you wrote earlier in this browser were brought back and are being saved.
        </p>
      )}

      {conflict && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 text-sm" style={{ borderColor: "#e9d98a", background: "#fff7d6" }} data-testid="notepad-conflict">
          <span className="text-jx-orange-ink">{error} Keep yours or load theirs?</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => void save(text, conflict.updatedAt)} className="rounded-lg bg-jx-green px-3 py-1.5 text-xs font-bold text-white" data-testid="button-keep-mine">Keep mine</button>
            <button type="button" onClick={() => { setBase(conflict); setText(conflict.content); setConflict(null); setError(null); draftStore.clear(); }}
              className="rounded-lg border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "#e9d98a" }} data-testid="button-load-theirs">Load theirs</button>
          </span>
        </div>
      )}
      {error && !conflict && <p role="alert" className="border-b px-4 py-2 text-sm text-jx-orange-ink" style={{ borderColor: "#e9d98a" }}>{error} Your notes are kept in this browser until they're saved.</p>}

      {historyOpen && <NotepadHistory onRestore={restoreVersion} onClose={() => setHistoryOpen(false)} />}

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
            onBlur={() => { if (dirty && !conflict) void save(); }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (dirty && !conflict) void save(); }
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

/** Earlier versions of the notes; restoring one puts it on the page, where it autosaves as the newest version. */
function NotepadHistory({ onRestore, onClose }: { onRestore: (version: NotepadVersion) => void; onClose: () => void }) {
  const versions = useQuery<{ versions: NotepadVersion[]; retentionDays: number }>({ queryKey: [`${NOTEPAD_URL}/versions`], staleTime: 0 });
  return (
    <div className="border-b px-4 py-3" style={{ borderColor: "#e9d98a", background: "#fff7d6" }} data-testid="notepad-history">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-jx-ink">Earlier versions{versions.data ? ` · kept for ${versions.data.retentionDays} days` : ""}</p>
        <button type="button" onClick={onClose} aria-label="Close history" className="rounded p-1 text-jx-ink-2"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      {versions.isLoading ? <p className="mt-2 text-xs text-jx-ink-2">Loading…</p>
        : versions.isError ? <p className="mt-2 text-xs text-jx-orange-ink">Earlier versions couldn't be loaded.</p>
        : versions.data?.versions.length === 0 ? <p className="mt-2 text-xs text-jx-ink-2">No earlier versions yet. One is kept each time the notes change.</p>
        : <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
          {versions.data?.versions.map((version) => (
            <li key={version.id} className="flex items-start justify-between gap-3 rounded-lg bg-white/60 px-3 py-2" data-testid={`notepad-version-${version.id}`}>
              <div className="min-w-0">
                <p className="text-[11px] text-jx-ink-3">{when(version.savedAt)}{version.savedByName ? ` · ${version.savedByName}` : ""}</p>
                <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-sm text-jx-ink" style={{ fontFamily: HANDWRITING, fontSize: 18 }}>{version.content}</p>
              </div>
              <button type="button" onClick={() => onRestore(version)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-semibold text-jx-ink" style={{ borderColor: "#e9d98a" }} data-testid={`button-restore-${version.id}`}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Restore
              </button>
            </li>
          ))}
        </ul>}
    </div>
  );
}
