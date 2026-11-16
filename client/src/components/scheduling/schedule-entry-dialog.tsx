// Add or change a schedule entry: something on the calendar that isn't a job
// yet (a site visit, an estimate, a pickup, a day off). Needs only a name and
// a date. It can be turned into a job from here once there's a client.
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Briefcase, CalendarPlus, Trash2 } from "lucide-react";
import type { Client } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ScheduleEntry } from "@/pages/scheduling-logic";

type Form = { title: string; date: string; endDate: string; startTime: string; notes: string; clientId: string };
const NONE = "__none__";
const toDay = (value: string | Date | null | undefined) => (value ? String(value).slice(0, 10) : "");
const blank = (date?: string): Form => ({ title: "", date: date ?? new Date().toISOString().slice(0, 10), endDate: "", startTime: "", notes: "", clientId: "" });
const fromEntry = (entry: ScheduleEntry): Form => ({ title: entry.title, date: toDay(entry.date), endDate: toDay(entry.endDate), startTime: entry.startTime ?? "", notes: entry.notes ?? "", clientId: entry.clientId ?? "" });

export function ScheduleEntryDialog({ open, entry, defaultDate, onOpenChange }: { open: boolean; entry: ScheduleEntry | null; defaultDate?: string; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [form, setForm] = useState<Form>(() => (entry ? fromEntry(entry) : blank(defaultDate)));
  const [error, setError] = useState("");
  const clientsQuery = useQuery<Client[]>({ queryKey: ["/api/clients"], enabled: open });
  const clients = Array.isArray(clientsQuery.data) ? clientsQuery.data : [];

  useEffect(() => { if (open) { setForm(entry ? fromEntry(entry) : blank(defaultDate)); setError(""); } }, [open, entry, defaultDate]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/schedule-entries"] });
  const payload = () => ({ title: form.title.trim(), date: form.date, endDate: form.endDate || null, startTime: form.startTime || null, notes: form.notes.trim() || null, clientId: form.clientId || null });
  const fail = (err: Error) => setError(err.message.replace(/^\d+:\s*/, ""));

  const save = useMutation({
    mutationFn: async () => (await apiRequest(entry ? "PATCH" : "POST", entry ? `/api/schedule-entries/${entry.id}` : "/api/schedule-entries", payload())).json(),
    onSuccess: () => { void refresh(); toast({ title: entry ? "Schedule updated" : "Added to the schedule" }); onOpenChange(false); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/schedule-entries/${entry!.id}`); },
    onSuccess: () => { void refresh(); toast({ title: "Removed from the schedule" }); onOpenChange(false); },
    onError: fail,
  });
  const convert = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/schedule-entries/${entry!.id}/convert-to-job`, { clientId: form.clientId || undefined })).json() as Promise<{ job: { id: string } }>,
    onSuccess: ({ job }) => { void refresh(); void queryClient.invalidateQueries({ queryKey: ["/api/jobs"] }); toast({ title: "It's a job now", description: "Dates and client carried over. Add the scope and crew on the job page." }); onOpenChange(false); setLocation(`/jobs/${job.id}`); },
    onError: fail,
  });

  const busy = save.isPending || remove.isPending || convert.isPending;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!form.title.trim()) { setError("Give it a name."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) { setError("Pick a date."); return; }
    if (form.endDate && form.endDate < form.date) { setError("The end date can't be before the start."); return; }
    save.mutate();
  };
  const set = (key: keyof Form, value: string) => { setForm((current) => ({ ...current, [key]: value })); setError(""); };

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden rounded-[28px] border-jx-line bg-card p-0 text-jx-ink sm:max-w-[560px]" data-testid="schedule-entry-dialog">
      <DialogHeader className="shrink-0 border-b border-jx-line px-5 py-4 sm:px-7">
        <DialogTitle className="flex items-center gap-2 font-display text-2xl !font-bold tracking-[-.04em] text-jx-ink"><CalendarPlus className="h-6 w-6 text-jx-green-ink" aria-hidden="true" />{entry ? "Schedule entry" : "Add to the schedule"}</DialogTitle>
        <DialogDescription className="text-jx-ink-2">{entry?.jobTitle ? `This entry is the job “${entry.jobTitle}”.` : "A site visit, an estimate, a pickup, a day off. No job needed; you can make it one later."}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
        <form id="schedule-entry-form" onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="entry-title">What *</Label><Input id="entry-title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Estimate at 42 Elm St" autoFocus data-testid="input-entry-title" /></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5"><Label htmlFor="entry-date">Date *</Label><Input id="entry-date" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} data-testid="input-entry-date" /></div>
            <div className="space-y-1.5"><Label htmlFor="entry-end">Until (optional)</Label><Input id="entry-end" type="date" value={form.endDate} min={form.date} onChange={(e) => set("endDate", e.target.value)} data-testid="input-entry-end" /></div>
            <div className="space-y-1.5"><Label htmlFor="entry-time">Time (optional)</Label><Input id="entry-time" type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} data-testid="input-entry-time" /></div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entry-client">Client (optional)</Label>
            <Select value={form.clientId || NONE} onValueChange={(value) => set("clientId", value === NONE ? "" : value)} disabled={clientsQuery.isLoading}>
              <SelectTrigger id="entry-client" className="min-h-11" data-testid="select-entry-client"><SelectValue placeholder="No client" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No client</SelectItem>
                {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="entry-notes">Notes</Label><Textarea id="entry-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Gate code, who to ask for, what to bring…" className="min-h-20" data-testid="input-entry-notes" /></div>
          {error && <p role="alert" className="rounded-xl bg-jx-orange-tint px-4 py-3 text-sm text-jx-orange-ink" data-testid="entry-error">{error}</p>}
        </form>
        {entry && !entry.jobId && (
          <div className="mt-5 rounded-2xl bg-jx-surface px-4 py-3 text-sm text-jx-ink-2">
            <p><strong className="text-jx-ink">Turn this into a job?</strong> Keeps the dates and client, and opens the job page so you can add the scope and crew.{!form.clientId && " Pick a client above first."}</p>
            <Button type="button" variant="outline" className="mt-2 min-h-10 rounded-full border-2 border-jx-ink px-4 text-xs font-bold" disabled={busy || !form.clientId} onClick={() => convert.mutate()} data-testid="button-entry-to-job"><Briefcase className="mr-2 h-4 w-4" aria-hidden="true" />Make it a job</Button>
          </div>
        )}
      </div>
      <DialogFooter className="shrink-0 flex-row items-center justify-between gap-2 border-t border-jx-line px-5 py-4 sm:px-7">
        <div>{entry && <Button type="button" variant="ghost" className="min-h-11 rounded-full text-jx-orange-ink hover:bg-jx-orange-tint" disabled={busy} onClick={() => remove.mutate()} data-testid="button-delete-entry"><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Remove</Button>}</div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={() => onOpenChange(false)} disabled={busy} data-testid="button-cancel-entry">Cancel</Button>
          <Button type="submit" form="schedule-entry-form" disabled={busy} className="min-h-11 rounded-full bg-jx-green px-6 font-bold text-white hover:bg-jx-green-hover" data-testid="button-save-entry">{save.isPending ? "Saving…" : entry ? "Save" : "Add to schedule"}</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
