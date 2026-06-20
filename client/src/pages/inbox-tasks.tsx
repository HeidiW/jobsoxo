import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Mail,
  RefreshCw,
  CheckCheck,
  Inbox,
  Wifi,
  WifiOff,
  Clock,
  Calendar,
  CircleDot,
} from "lucide-react";
import { format, isToday, isYesterday, startOfDay } from "date-fns";
import type { InboxTask } from "@shared/schema";

// ── Helpers ─────────────────────────────────────────────────────────────────────

function senderInitials(sender: string): string {
  const parts = sender.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return sender.slice(0, 2).toUpperCase();
}

function senderColor(email: string): string {
  const palette = [
    "bg-blue-500",
    "bg-emerald-500",
    "bg-violet-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-cyan-500",
    "bg-pink-500",
    "bg-indigo-500",
  ];
  let hash = 0;
  for (const ch of email) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  return palette[Math.abs(hash) % palette.length];
}

function groupByDay(tasks: InboxTask[]) {
  const today: InboxTask[] = [];
  const yesterday: InboxTask[] = [];
  const earlier: InboxTask[] = [];

  for (const t of tasks) {
    const d = new Date(t.receivedAt);
    if (isToday(d)) today.push(t);
    else if (isYesterday(d)) yesterday.push(t);
    else earlier.push(t);
  }

  return { today, yesterday, earlier };
}

// ── Not-connected card ─────────────────────────────────────────────────────────

function NotConnectedCard({ onSync }: { onSync: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto">
      <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-6">
        <Mail className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold mb-2">Connect your Gmail</h2>
      <p className="text-muted-foreground mb-2 leading-relaxed">
        Your Gmail account hasn't been connected yet. Use the{" "}
        <strong>Connect Gmail</strong> button in the project integrations panel
        to authorise access, then click <strong>Sync inbox</strong> below to
        pull in your emails.
      </p>
      <p className="text-xs text-muted-foreground mb-8">
        Only inbox emails are read — no emails are sent or modified.
      </p>
      <Button onClick={onSync} data-testid="button-sync-inbox">
        <RefreshCw className="h-4 w-4 mr-2" />
        Sync inbox
      </Button>
    </div>
  );
}

// ── Task row ───────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  onToggle,
}: {
  task: InboxTask;
  onToggle: (emailId: string, isDone: boolean) => void;
}) {
  const initials = senderInitials(task.sender);
  const color = senderColor(task.senderEmail ?? task.sender);
  const receivedAt = new Date(task.receivedAt);

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg transition-colors group ${
        task.isDone
          ? "opacity-50"
          : "hover:bg-muted/50 cursor-pointer"
      }`}
      onClick={() => onToggle(task.emailId, !task.isDone)}
      data-testid={`row-inbox-${task.emailId}`}
    >
      {/* Checkbox */}
      <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={task.isDone}
          onCheckedChange={(checked) => onToggle(task.emailId, !!checked)}
          data-testid={`checkbox-inbox-${task.emailId}`}
          className="h-4 w-4"
        />
      </div>

      {/* Avatar */}
      <div
        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-semibold ${color}`}
      >
        {initials}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className={`text-sm font-medium truncate ${
              task.isDone ? "line-through text-muted-foreground" : ""
            } ${!task.isRead && !task.isDone ? "font-semibold" : ""}`}
          >
            {task.subject}
          </span>
          {!task.isRead && !task.isDone && (
            <CircleDot className="h-2.5 w-2.5 text-blue-500 shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate max-w-[200px]">{task.sender}</span>
          {task.snippet && (
            <>
              <span>·</span>
              <span className="truncate max-w-[300px]">{task.snippet}</span>
            </>
          )}
        </div>
      </div>

      {/* Time */}
      <div className="shrink-0 text-xs text-muted-foreground whitespace-nowrap pt-0.5">
        {isToday(receivedAt)
          ? format(receivedAt, "h:mm a")
          : format(receivedAt, "MMM d")}
      </div>
    </div>
  );
}

// ── Section ────────────────────────────────────────────────────────────────────

function Section({
  label,
  tasks,
  onToggle,
}: {
  label: string;
  tasks: InboxTask[];
  onToggle: (emailId: string, isDone: boolean) => void;
}) {
  if (!tasks.length) return null;

  const undoneCount = tasks.filter((t) => !t.isDone).length;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {undoneCount > 0 && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0">
            {undoneCount}
          </Badge>
        )}
      </div>
      <div className="space-y-0.5">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} onToggle={onToggle} />
        ))}
      </div>
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function TasksSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          <Skeleton className="h-3 w-14 shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function InboxTasks() {
  const { toast } = useToast();
  const [showDone, setShowDone] = useState(false);

  const { data: status } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/inbox/status"],
    refetchInterval: 30_000,
  });

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<InboxTask[]>({
    queryKey: ["/api/inbox/tasks"],
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/inbox/sync");
      return res.json();
    },
    onSuccess: (data: InboxTask[]) => {
      queryClient.setQueryData(["/api/inbox/tasks"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/status"] });
      toast({ title: `Synced ${data.length} emails` });
    },
    onError: (err: Error & { status?: number }) => {
      if (err.message?.includes("NOT_CONNECTED") || err.message?.includes("not connected")) {
        toast({
          title: "Gmail not connected",
          description: "Complete the Gmail OAuth flow from the integrations panel, then try again.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Sync failed", description: err.message, variant: "destructive" });
      }
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ emailId, isDone }: { emailId: string; isDone: boolean }) => {
      const res = await apiRequest("PATCH", `/api/inbox/tasks/${emailId}/done`, { isDone });
      return res.json() as Promise<InboxTask>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["/api/inbox/tasks"], (old: InboxTask[] = []) =>
        old.map((t) => (t.emailId === updated.emailId ? updated : t))
      );
    },
    onError: () => {
      toast({ title: "Couldn't update task", variant: "destructive" });
    },
  });

  const handleToggle = (emailId: string, isDone: boolean) => {
    toggleMutation.mutate({ emailId, isDone });
  };

  const visibleTasks = showDone ? tasks : tasks.filter((t) => !t.isDone);
  const groups = groupByDay(visibleTasks);

  const todayTotal = tasks.filter((t) => isToday(new Date(t.receivedAt))).length;
  const todayDone = tasks.filter((t) => isToday(new Date(t.receivedAt)) && t.isDone).length;
  const todayUndone = todayTotal - todayDone;
  const unreadCount = tasks.filter((t) => !t.isRead && !t.isDone).length;
  const connected = status?.connected ?? false;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-2">
            <Inbox className="h-7 w-7" />
            Inbox Tasks
          </h1>
          <p className="text-muted-foreground mt-1">
            Your Gmail inbox as a daily to-do list
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Connection indicator */}
          <div
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${
              connected
                ? "text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800"
                : "text-muted-foreground bg-muted border-border"
            }`}
          >
            {connected ? (
              <Wifi className="h-3 w-3" />
            ) : (
              <WifiOff className="h-3 w-3" />
            )}
            {connected ? "Gmail connected" : "Not connected"}
          </div>

          {/* Show/hide done */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDone((v) => !v)}
            data-testid="button-toggle-done"
          >
            <CheckCheck className="h-4 w-4 mr-1.5" />
            {showDone ? "Hide done" : "Show done"}
          </Button>

          {/* Sync */}
          <Button
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="button-sync"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing…" : "Sync inbox"}
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Today</p>
                <p className="text-xl font-bold">
                  {todayUndone}
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    / {todayTotal}
                  </span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CircleDot className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-xs text-muted-foreground">Unread</p>
                <p className="text-xl font-bold">{unreadCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CheckCheck className="h-4 w-4 text-green-600" />
              <div>
                <p className="text-xs text-muted-foreground">Done today</p>
                <p className="text-xl font-bold">{todayDone}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main content */}
      <Card>
        <CardContent className="pt-4">
          {tasksLoading ? (
            <TasksSkeleton />
          ) : tasks.length === 0 ? (
            <NotConnectedCard onSync={() => syncMutation.mutate()} />
          ) : visibleTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCheck className="h-12 w-12 text-green-500 mb-4" />
              <h3 className="font-semibold text-lg">All caught up!</h3>
              <p className="text-muted-foreground mt-1">
                {showDone
                  ? "No emails in your inbox."
                  : "All emails actioned. Click 'Show done' to review them."}
              </p>
            </div>
          ) : (
            <>
              <Section label="Today" tasks={groups.today} onToggle={handleToggle} />
              <Section label="Yesterday" tasks={groups.yesterday} onToggle={handleToggle} />
              <Section label="Earlier" tasks={groups.earlier} onToggle={handleToggle} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Footer hint */}
      {tasks.length > 0 && (
        <p className="text-xs text-muted-foreground text-center mt-4">
          <Clock className="h-3 w-3 inline mr-1" />
          Click an email row or its checkbox to mark it done · Last sync:{" "}
          {syncMutation.isSuccess ? "just now" : "—"}
        </p>
      )}
    </div>
  );
}
