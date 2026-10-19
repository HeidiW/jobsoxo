import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { Bell, BellOff, PauseCircle, PlayCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CollectionsEntry } from "./types";

export function CollectionsView() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [stageFilter, setStageFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"daysOverdue" | "balance" | "clientName">("daysOverdue");
  const { data: entries = [], isLoading, isError, isFetching, refetch } = useQuery<CollectionsEntry[]>({
    queryKey: ["/api/collections"],
    queryFn: async () => {
      const response = await fetch("/api/collections");
      if (!response.ok) throw new Error("Failed to fetch collections");
      return response.json();
    },
  });
  const toggleMutation = useMutation({
    mutationFn: async ({ id, paused }: { id: string; paused: boolean }) => {
      const response = await apiRequest("PATCH", `/api/invoices/${id}/collections`, { remindersPaused: paused });
      if (!response.ok) throw new Error("Failed to update");
      return response.json();
    },
    onSuccess: () => {
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });
  const processMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/reminders/process")).json(),
    onSuccess: (data: any) => {
      void refetch();
      toast({ title: "Reminders processed", description: `${data.sent ?? 0} sent, ${data.processed ?? 0} checked` });
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });
  const formatBalance = (balance: string) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(balance));
  const filteredEntries = entries
    .filter((entry) => stageFilter === "all" || String(entry.currentStage) === stageFilter)
    .sort((a, b) => {
      if (sortBy === "daysOverdue") return b.daysOverdue - a.daysOverdue;
      if (sortBy === "balance") return Number(b.balance) - Number(a.balance);
      return (a.clientName ?? "").localeCompare(b.clientName ?? "");
    });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--panel-bd)] bg-[var(--track)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Bell className="h-[15px] w-[15px] text-[var(--faint)]" />
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--faint)]">{filteredEntries.length}/{entries.length} invoice{entries.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {[["all", "All stages"], ["0", "Stage 0"], ["1", "Stage 1"], ["2", "Stage 2"], ["3", "Stage 3"]].map(([key, label]) => (
              <button type="button" key={key} onClick={() => setStageFilter(key)}
                className={`rounded-md px-2 py-1 text-xs font-semibold ${stageFilter === key ? "bg-[var(--jox-primary)] text-white" : "text-[var(--faint)] hover:bg-[var(--panel)]"}`}
                data-testid={`filter-stage-${key}`}>{label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] font-semibold text-[var(--faint)]">Sort:</span>
            {([["daysOverdue", "Days overdue"], ["balance", "Balance"], ["clientName", "Client"]] as const).map(([key, label]) => (
              <button type="button" key={key} onClick={() => setSortBy(key)}
                className={`rounded-md px-2 py-1 text-xs font-semibold ${sortBy === key ? "bg-[var(--jox-primary)] text-white" : "text-[var(--faint)] hover:bg-[var(--panel)]"}`}
                data-testid={`sort-${key}`}>{label}</button>
            ))}
          </div>
        </div>
        <button type="button" onClick={() => processMutation.mutate()} disabled={processMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--jox-primary)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
          data-testid="button-process-reminders">{processMutation.isPending ? "Sending…" : "Run Reminders Now"}</button>
      </div>
      {isError ? (
        <div className="px-6 py-10 text-center" role="alert">
          <p className="font-bold text-[var(--fg)]">Collections didn’t load</p>
          <p className="mt-1 text-sm text-[var(--faint)]">Your reminder list is unavailable. Try again.</p>
          <button type="button" onClick={() => void refetch()} disabled={isFetching}
            className="mt-3 rounded-full border border-[var(--panel-bd)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--fg)]">
            {isFetching ? "Trying again…" : "Retry"}
          </button>
        </div>
      ) : isLoading ? (
        <div className="px-6 py-10 text-center text-sm text-[var(--faint)]">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <div className="mb-2 text-sm font-bold text-[var(--fg)]">No overdue invoices</div>
          <div className="text-sm text-[var(--faint)]">All invoices are up to date.</div>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-[var(--faint)]">No invoices match the current filter.</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="flex items-center border-b border-[var(--panel-bd)] bg-[var(--track)] px-[18px] py-3 text-[10.5px] font-bold uppercase tracking-wide text-[var(--faint)]">
              <span className="w-[104px] shrink-0">Invoice</span><span className="min-w-0 flex-1">Client</span>
              <span className="w-[72px] shrink-0 text-center">Overdue</span><span className="w-16 shrink-0 text-center">Stage</span>
              <span className="w-24 shrink-0 text-right">Balance</span><span className="w-[88px] shrink-0 pl-2">Last Contact</span>
              <span className="w-[88px] shrink-0 pl-2">Next Action</span><span className="w-[88px] shrink-0 text-center">Status</span><span className="w-10 shrink-0" />
            </div>
            {filteredEntries.map((entry) => (
              <div key={entry.id} className="rowhover flex cursor-pointer items-center border-b border-[var(--panel-bd)] px-[18px] py-[13px]"
                onClick={() => setLocation(`/invoices/${entry.id}`)} data-testid={`row-collections-${entry.id}`}>
                <span className="w-[104px] shrink-0 font-mono text-[13px] font-semibold">{entry.invoiceNumber}</span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{entry.clientName ?? "—"}
                  {entry.jobTitle && <span className="ml-1.5 text-xs text-[var(--faint)]">{entry.jobTitle}</span>}</span>
                <span className={`w-[72px] shrink-0 text-center text-[13px] font-semibold ${entry.daysOverdue > 30 ? "text-red-600" : entry.daysOverdue > 14 ? "text-orange-600" : ""}`}>{entry.daysOverdue}d</span>
                <span className="w-16 shrink-0 text-center text-xs">{entry.currentStage === 0 ? "—" : `${entry.currentStage}/3`}</span>
                <span className="w-24 shrink-0 text-right font-mono text-[13px] font-semibold text-red-600">{formatBalance(entry.balance)}</span>
                <span className="w-[88px] shrink-0 pl-1 text-xs text-[var(--faint)]" data-testid={`text-last-contact-${entry.id}`}>{entry.lastReminderSent ? format(new Date(entry.lastReminderSent), "MMM d") : "—"}</span>
                <span className="w-[88px] shrink-0 pl-1 text-xs text-[var(--faint)]">{entry.nextActionDate ? format(new Date(entry.nextActionDate), "MMM d") : entry.reminderCount >= 3 ? "Complete" : "—"}</span>
                <span className="flex w-[88px] shrink-0 justify-center">
                  {entry.remindersPaused
                    ? <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold text-[var(--faint)]"><BellOff className="h-[11px] w-[11px]" />Paused</span>
                    : <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold text-green-700"><Bell className="h-[11px] w-[11px]" />Active</span>}
                </span>
                <span className="flex w-10 shrink-0 justify-center">
                  <button type="button" onClick={(event) => { event.stopPropagation(); toggleMutation.mutate({ id: entry.id, paused: !entry.remindersPaused }); }}
                    onKeyDown={(event) => event.stopPropagation()} disabled={toggleMutation.isPending}
                    title={entry.remindersPaused ? "Resume reminders" : "Pause reminders"}
                    className="rounded p-1 text-[var(--faint)] hover:bg-[var(--panel)]" data-testid={`button-toggle-collections-${entry.id}`}>
                    {entry.remindersPaused ? <PlayCircle className="h-[15px] w-[15px]" /> : <PauseCircle className="h-[15px] w-[15px]" />}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
