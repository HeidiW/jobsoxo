// "Get on it": the team's shared to-do list, shown on the dashboard week and
// in Scheduling. Items with a day sit in that day's column; the rest (no day,
// overdue, or outside what's on screen) are listed under the calendar.
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface TodoItem {
  id: string;
  text: string;
  dueDate: string | null; // YYYY-MM-DD
  done: boolean;
  doneAt: string | null;
  createdAt: string;
  createdByName?: string | null;
}

const TODOS_KEY = ["/api/todos"];

/** Local calendar day as YYYY-MM-DD (never via toISOString, which shifts to UTC). */
export function localDay(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** "Mon 9 Nov" for a YYYY-MM-DD string, read as a calendar day. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return format(new Date(y, m - 1, d), "EEE d MMM");
}

export function useTodos() {
  const { toast } = useToast();
  const query = useQuery<TodoItem[]>({ queryKey: TODOS_KEY });
  const onError = (error: Error) => toast({ title: "Couldn't update the to-do list", description: error.message, variant: "destructive" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: TODOS_KEY });

  const add = useMutation({
    mutationFn: async (input: { text: string; dueDate: string | null }) => (await apiRequest("POST", "/api/todos", input)).json(),
    onSuccess: refresh,
    onError,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...changes }: { id: string; done?: boolean; text?: string; dueDate?: string | null }) =>
      (await apiRequest("PATCH", `/api/todos/${id}`, changes)).json(),
    // Tick boxes respond instantly; the server confirms.
    onMutate: async ({ id, ...changes }) => {
      await queryClient.cancelQueries({ queryKey: TODOS_KEY });
      const previous = queryClient.getQueryData<TodoItem[]>(TODOS_KEY);
      queryClient.setQueryData<TodoItem[]>(TODOS_KEY, (items = []) => items.map((item) => item.id === id ? { ...item, ...changes } : item));
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(TODOS_KEY, context.previous);
      onError(error);
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/todos/${id}`); },
    onSuccess: refresh,
    onError,
  });
  return { ...query, todos: query.data ?? [], add, update, remove };
}

/** One to-do with its tick box; compact for calendar cells. */
export function TodoCheck({ todo, onToggle, onDelete, compact = false, showDay = false, today }: {
  todo: TodoItem; onToggle: (done: boolean) => void; onDelete?: () => void; compact?: boolean; showDay?: boolean; today?: string;
}) {
  const overdue = !todo.done && !!todo.dueDate && !!today && todo.dueDate < today;
  return (
    <div className={`group flex items-start gap-2 ${compact ? "rounded-[8px] px-1.5 py-1" : "rounded-xl px-2.5 py-2"} bg-jx-gold-tint/70`} data-testid={`todo-${todo.id}`}>
      <input
        type="checkbox"
        checked={todo.done}
        onChange={(event) => onToggle(event.target.checked)}
        aria-label={`Mark "${todo.text}" ${todo.done ? "not done" : "done"}`}
        className={`${compact ? "mt-[1px] h-3.5 w-3.5" : "mt-0.5 h-4 w-4"} shrink-0 cursor-pointer accent-[var(--jx-green)]`}
        data-testid={`checkbox-todo-${todo.id}`}
      />
      <span className={`min-w-0 flex-1 break-words ${compact ? "text-[11px] font-semibold leading-snug" : "text-sm"} ${todo.done ? "text-jx-ink-3 line-through" : "text-jx-ink"}`}>
        {todo.text}
        {showDay && todo.dueDate && (
          <span className={`ml-1.5 whitespace-nowrap text-[11px] font-semibold ${overdue ? "text-jx-orange-ink" : "text-jx-ink-3"}`} data-testid={`todo-day-${todo.id}`}>
            {overdue ? "was due " : ""}{dayLabel(todo.dueDate)}
          </span>
        )}
      </span>
      {onDelete && (
        <button type="button" onClick={onDelete} aria-label={`Delete "${todo.text}"`}
          className="shrink-0 rounded p-0.5 text-jx-ink-3 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
          data-testid={`button-delete-todo-${todo.id}`}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Add box plus the items not already shown in a calendar column on screen. */
export function GetOnItList({ shownDays, title = "Get on it" }: { shownDays: string[]; title?: string }) {
  const { todos, isLoading, isError, add, update, remove } = useTodos();
  const [text, setText] = useState("");
  const [day, setDay] = useState("");
  const today = localDay(new Date());
  const shown = new Set(shownDays);
  const listed = todos.filter((todo) => !todo.dueDate || !shown.has(todo.dueDate));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    add.mutate({ text: trimmed, dueDate: day || null }, { onSuccess: () => { setText(""); setDay(""); } });
  };

  return (
    <section className="mt-4 rounded-[17px] border p-3.5 sm:p-4" style={{ borderColor: "var(--jx-line)", background: "hsl(var(--card))" }} aria-label={title} data-testid="get-on-it">
      <h3 className="font-display text-base !font-bold tracking-[-.02em]">{title}</h3>
      <form onSubmit={submit} className="mt-2.5 flex flex-wrap gap-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Add a to-do, e.g. Order primer for Lillistar"
          maxLength={300}
          className="min-w-0 flex-1 basis-56 rounded-xl border-2 px-3 py-2 text-sm outline-none focus:border-jx-green"
          style={{ borderColor: "var(--jx-line)", background: "hsl(var(--card))" }}
          aria-label="New to-do"
          data-testid="input-new-todo"
        />
        <input
          type="date"
          value={day}
          onChange={(event) => setDay(event.target.value)}
          className="rounded-xl border-2 px-2.5 py-2 text-sm text-jx-ink-2 outline-none focus:border-jx-green"
          style={{ borderColor: "var(--jx-line)", background: "hsl(var(--card))" }}
          aria-label="Day (optional)"
          title="Optional: put it on a day"
          data-testid="input-new-todo-day"
        />
        <button type="submit" disabled={!text.trim() || add.isPending}
          className="inline-flex items-center gap-1 rounded-xl bg-jx-green px-3.5 py-2 text-sm font-bold text-white disabled:opacity-50"
          data-testid="button-add-todo">
          <Plus className="h-4 w-4" aria-hidden="true" />Add
        </button>
      </form>
      {isError ? (
        <p className="mt-3 text-sm text-jx-orange-ink">The to-do list didn't load.</p>
      ) : isLoading ? null : listed.length === 0 ? (
        <p className="mt-3 text-xs text-jx-ink-3" data-testid="get-on-it-empty">
          {todos.length === 0 ? "Nothing on the list. Add anything the team needs to get done; give it a day to put it on the calendar." : "Everything else is on its day above."}
        </p>
      ) : (
        <div className="mt-3 space-y-1.5" data-testid="get-on-it-list">
          {listed.map((todo) => (
            <TodoCheck key={todo.id} todo={todo} today={today} showDay
              onToggle={(done) => update.mutate({ id: todo.id, done })}
              onDelete={() => remove.mutate(todo.id)} />
          ))}
        </div>
      )}
    </section>
  );
}
