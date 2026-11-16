// "Get on it": the team's shared to-do list on lined paper. Tick items off
// as they're done, add the next one on the line below, and when the list
// has run its course start a new note; the old one is filed in the archive
// exactly as it was left, with the option to carry unfinished items over.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Archive, Check, FilePlus2, NotebookPen, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface NoteItem {
  id: string;
  text: string;
  done: boolean;
  doneAt: string | null;
  doneByName: string | null;
  position: number;
}
export interface CurrentNote { id: string; createdAt: string; items: NoteItem[] }
export interface ArchivedNote { id: string; title: string | null; createdAt: string; archivedAt: string; archivedByName: string | null; items: NoteItem[] }

const CURRENT_URL = "/api/notes/current";
const ARCHIVE_URL = "/api/notes/archive";
const LINE = 32; // px between ruled lines; each item sits on one
// Handwriting for the notes; falls back to the app's other script font.
const HANDWRITING = "'Caveat', 'Architects Daughter', cursive";
const PAPER = { borderColor: "#e9d98a", background: "#fffbe6" };
const lines = (n: number) => ({
  backgroundImage: `linear-gradient(to right, transparent 30px, #f2a8a8 30px, #f2a8a8 31.5px, transparent 31.5px), repeating-linear-gradient(to bottom, transparent 0, transparent ${n - 1}px, #e8dfae ${n - 1}px, #e8dfae ${n}px)`,
  backgroundPosition: "0 6px",
});
const when = (iso: string) => format(new Date(iso), "MMM d, h:mm a");
const isNote = (value: unknown): value is CurrentNote => !!value && typeof value === "object" && Array.isArray((value as CurrentNote).items);

export function GetOnItNotepad() {
  const query = useQuery<CurrentNote>({ queryKey: [CURRENT_URL], staleTime: 15_000 });
  const note = isNote(query.data) ? query.data : null;
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: [CURRENT_URL] });
  const fail = (err: unknown) => setError(err instanceof Error ? err.message.replace(/^\d+:\s*/, "") : "That didn't save. Try again.");

  const add = useMutation({
    mutationFn: async (text: string) => (await apiRequest("POST", `${CURRENT_URL}/items`, { text })).json() as Promise<NoteItem>,
    onMutate: () => setError(null),
    onSuccess: (item) => {
      queryClient.setQueryData<CurrentNote>([CURRENT_URL], (old) => (old ? { ...old, items: [...old.items, item] } : old));
      setDraft("");
      addRef.current?.focus();
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; text?: string; done?: boolean }) => (await apiRequest("PATCH", `/api/notes/items/${id}`, patch)).json() as Promise<NoteItem>,
    onMutate: ({ id, ...patch }) => {
      setError(null);
      // Tick at once; the server confirms a moment later.
      queryClient.setQueryData<CurrentNote>([CURRENT_URL], (old) => (old ? { ...old, items: old.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) } : old));
    },
    onSuccess: (item) => queryClient.setQueryData<CurrentNote>([CURRENT_URL], (old) => (old ? { ...old, items: old.items.map((current) => (current.id === item.id ? item : current)) } : old)),
    onError: (err) => { fail(err); void refresh(); },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/notes/items/${id}`); return id; },
    onMutate: () => setError(null),
    onSuccess: (id) => queryClient.setQueryData<CurrentNote>([CURRENT_URL], (old) => (old ? { ...old, items: old.items.filter((item) => item.id !== id) } : old)),
    onError: (err) => { fail(err); void refresh(); },
  });
  const archive = useMutation({
    mutationFn: async (carryOverUnfinished: boolean) => (await apiRequest("POST", `${CURRENT_URL}/archive`, { carryOverUnfinished })).json() as Promise<{ archived: boolean; carried?: number; current: CurrentNote }>,
    onMutate: () => setError(null),
    onSuccess: (result) => {
      queryClient.setQueryData([CURRENT_URL], result.current);
      queryClient.invalidateQueries({ queryKey: [ARCHIVE_URL] });
      setNewNoteOpen(false);
    },
    onError: fail,
  });

  useEffect(() => { if (editing) setError(null); }, [editing]);

  const items = note?.items ?? [];
  const doneCount = items.filter((item) => item.done).length;
  const busy = add.isPending || archive.isPending;
  const submitDraft = () => { const text = draft.trim(); if (text && !add.isPending) add.mutate(text); };
  const commitEdit = () => {
    if (!editing) return;
    const text = editing.text.trim();
    const current = items.find((item) => item.id === editing.id);
    if (text && current && text !== current.text) update.mutate({ id: editing.id, text });
    setEditing(null);
  };

  return (
    <section className="mt-4 overflow-hidden rounded-[17px] border shadow-sm" style={PAPER} aria-label="Get on it list" data-testid="get-on-it">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5" style={{ borderColor: "#e9d98a", background: "#fff3b8" }}>
        <h3 className="flex items-center gap-2 font-display text-base !font-bold tracking-[-.02em] text-jx-ink">
          <NotebookPen className="h-4 w-4" aria-hidden="true" />Get on it
          {items.length > 0 && <span className="ml-1 text-[11px] font-semibold text-jx-ink-3" data-testid="notepad-progress">{doneCount} of {items.length} done</span>}
        </h3>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setArchiveOpen((open) => !open)} aria-expanded={archiveOpen}
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-jx-ink" style={{ borderColor: "#e9d98a" }} data-testid="button-notepad-archive">
            <Archive className="h-3.5 w-3.5" aria-hidden="true" />Archive
          </button>
          <button type="button" onClick={() => setNewNoteOpen(true)} disabled={items.length === 0 || busy}
            className="inline-flex items-center gap-1 rounded-lg bg-jx-green px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-40" data-testid="button-new-note">
            <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />New note
          </button>
        </div>
      </header>

      {newNoteOpen && (
        <div role="dialog" aria-label="Start a new note" className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 text-sm" style={{ borderColor: "#e9d98a", background: "#fff7d6" }} data-testid="new-note-confirm">
          <span className="text-jx-ink">File this note in the archive and start a fresh one?{doneCount < items.length && ` ${items.length - doneCount} ${items.length - doneCount === 1 ? "item isn't" : "items aren't"} done yet.`}</span>
          <span className="flex flex-wrap gap-2">
            {doneCount < items.length && <button type="button" onClick={() => archive.mutate(true)} disabled={archive.isPending} className="rounded-lg bg-jx-green px-3 py-1.5 text-xs font-bold text-white" data-testid="button-new-note-carry">Start new, carry unfinished over</button>}
            <button type="button" onClick={() => archive.mutate(false)} disabled={archive.isPending} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${doneCount < items.length ? "border" : "bg-jx-green text-white"}`} style={doneCount < items.length ? { borderColor: "#e9d98a" } : undefined} data-testid="button-new-note-fresh">Start new, empty</button>
            <button type="button" onClick={() => setNewNoteOpen(false)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-jx-ink-2" data-testid="button-new-note-cancel">Keep this one</button>
          </span>
        </div>
      )}
      {error && <p role="alert" className="border-b px-4 py-2 text-sm text-jx-orange-ink" style={{ borderColor: "#e9d98a" }} data-testid="notepad-error">{error}</p>}
      {archiveOpen && <NoteArchive onClose={() => setArchiveOpen(false)} />}

      <div className="relative pl-10 pr-4 py-[6px]" style={{ ...lines(LINE), minHeight: LINE * 8 }}>
        {query.isError ? (
          <p className="py-6 text-sm text-jx-orange-ink">The list didn't load.</p>
        ) : (
          <ul className="m-0 list-none p-0" aria-label="To-do items">
            {items.map((item) => (
              <li key={item.id} className="group flex items-center gap-2" style={{ minHeight: LINE }} data-testid={`note-item-${item.id}`} data-done={item.done}>
                <button type="button" role="checkbox" aria-checked={item.done} aria-label={`${item.done ? "Reopen" : "Done"}: ${item.text}`} onClick={() => update.mutate({ id: item.id, done: !item.done })}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-jx-green-ink" style={{ borderColor: item.done ? "#1f7a3f" : "#b8a85c", background: item.done ? "#e3f3e8" : "transparent" }} data-testid={`check-${item.id}`}>
                  {item.done && <Check className="h-4 w-4" aria-hidden="true" strokeWidth={3} />}
                </button>
                {editing?.id === item.id ? (
                  <input autoFocus value={editing.text} onChange={(event) => setEditing({ id: item.id, text: event.target.value })} onBlur={commitEdit}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitEdit(); } if (event.key === "Escape") setEditing(null); }}
                    aria-label="Edit item" className="min-w-0 flex-1 border-0 bg-transparent text-[24px] font-medium text-jx-ink outline-none" style={{ lineHeight: `${LINE}px`, fontFamily: HANDWRITING }} data-testid={`input-edit-${item.id}`} />
                ) : (
                  <button type="button" onClick={() => setEditing({ id: item.id, text: item.text })} title={item.done && item.doneAt ? `Done ${when(item.doneAt)}${item.doneByName ? ` by ${item.doneByName}` : ""}` : "Click to edit"}
                    className={`min-w-0 flex-1 truncate text-left text-[24px] font-medium ${item.done ? "text-jx-ink-3 line-through decoration-2" : "text-jx-ink"}`} style={{ lineHeight: `${LINE}px`, fontFamily: HANDWRITING }} data-testid={`text-${item.id}`}>
                    {item.text}
                  </button>
                )}
                <button type="button" onClick={() => remove.mutate(item.id)} aria-label={`Remove: ${item.text}`} className="shrink-0 rounded p-1 text-jx-ink-3 opacity-0 hover:text-jx-orange-ink focus:opacity-100 group-hover:opacity-100" data-testid={`remove-${item.id}`}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
            <li className="flex items-center gap-2" style={{ minHeight: LINE }}>
              <span className="h-6 w-6 shrink-0 rounded-md border-2 border-dashed" style={{ borderColor: "#d9cc8a" }} aria-hidden="true" />
              <input ref={addRef} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={query.isLoading || add.isPending}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitDraft(); } }} onBlur={submitDraft}
                placeholder={query.isLoading ? "Loading…" : items.length ? "Add another…" : "What needs doing? Materials to order, calls to make, jobs to chase…"}
                aria-label="Add an item" className="min-w-0 flex-1 border-0 bg-transparent text-[24px] font-medium text-jx-ink outline-none placeholder:text-jx-ink-3" style={{ lineHeight: `${LINE}px`, fontFamily: HANDWRITING }} data-testid="input-new-item" />
            </li>
          </ul>
        )}
      </div>
    </section>
  );
}

/** Every past note, newest first, exactly as it was left. */
function NoteArchive({ onClose }: { onClose: () => void }) {
  const query = useQuery<{ notes: ArchivedNote[] }>({ queryKey: [ARCHIVE_URL], staleTime: 0 });
  const archived = query.data?.notes ?? [];
  return (
    <div className="border-b px-4 py-3" style={{ borderColor: "#e9d98a", background: "#fff7d6" }} data-testid="note-archive">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-jx-ink">Past notes{archived.length ? ` · ${archived.length}` : ""}</p>
        <button type="button" onClick={onClose} aria-label="Close archive" className="rounded p-1 text-jx-ink-2"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      {query.isLoading ? <p className="mt-2 text-xs text-jx-ink-2">Loading…</p>
        : query.isError ? <p className="mt-2 text-xs text-jx-orange-ink">The archive couldn't be loaded.</p>
        : archived.length === 0 ? <p className="mt-2 text-xs text-jx-ink-2">Nothing archived yet. "New note" files the current list here.</p>
        : <ul className="mt-2 max-h-80 space-y-3 overflow-y-auto">
          {archived.map((past) => (
            <li key={past.id} className="rounded-lg bg-white/60 px-3 py-2" data-testid={`archived-note-${past.id}`}>
              <p className="text-[11px] text-jx-ink-3">{when(past.createdAt)} → filed {when(past.archivedAt)}{past.archivedByName ? ` by ${past.archivedByName}` : ""} · {past.items.filter((item) => item.done).length} of {past.items.length} done</p>
              <ul className="mt-1 space-y-0.5">
                {past.items.map((item) => (
                  <li key={item.id} className={`flex items-center gap-2 text-[18px] ${item.done ? "text-jx-ink-3 line-through" : "text-jx-ink"}`} style={{ fontFamily: HANDWRITING }}>
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border" style={{ borderColor: item.done ? "#1f7a3f" : "#b8a85c" }} aria-hidden="true">{item.done && <Check className="h-3 w-3 text-jx-green-ink" strokeWidth={3} />}</span>
                    <span className="truncate">{item.text}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>}
    </div>
  );
}
