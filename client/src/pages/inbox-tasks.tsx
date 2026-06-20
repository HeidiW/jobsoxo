import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  PlugZap,
  Unplug,
  ExternalLink,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import type { InboxTask } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Not-connected card ────────────────────────────────────────────────────────

function NotConnectedCard({
  onConnect,
  connecting,
  isAdmin,
}: {
  onConnect: () => void;
  connecting: boolean;
  isAdmin: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto">
      <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-6">
        <Mail className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold mb-2">
        {isAdmin ? "Connect Gmail" : "Gmail not connected"}
      </h2>
      <p className="text-muted-foreground mb-2 leading-relaxed">
        {isAdmin
          ? "Connect the business Gmail account to see inbox emails as a shared daily to-do list. Only inbox emails are read — nothing is sent or modified."
          : "An admin needs to connect the business Gmail account before inbox tasks are available here."}
      </p>
      {isAdmin && (
        <Button
          className="mt-4"
          onClick={onConnect}
          disabled={connecting}
          data-testid="button-connect-gmail"
        >
          <PlugZap className="h-4 w-4 mr-2" />
          {connecting ? "Opening…" : "Connect Gmail"}
          <ExternalLink className="h-3 w-3 ml-1 opacity-60" />
        </Button>
      )}
    </div>
  );
}

// ── Empty-inbox card (connected, but inbox is empty) ─────────────────────────

function EmptyInboxCard({
  onRefresh,
  loading,
  isAdmin,
}: {
  onRefresh: () => void;
  loading: boolean;
  isAdmin: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <CheckCheck className="h-12 w-12 text-green-500 mb-4" />
      <h3 className="font-semibold text-lg">All caught up!</h3>
      <p className="text-muted-foreground mt-1 mb-4">
        No emails in your inbox right now.
      </p>
      {isAdmin && (
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      )}
    </div>
  );
}

// ── Task row ─────────────────────────────────────────────────────────────────

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
        task.isDone ? "opacity-50" : "hover:bg-muted/50 cursor-pointer"
      }`}
      onClick={() => onToggle(task.emailId, !task.isDone)}
      data-testid={`row-inbox-${task.emailId}`}
    >
      <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={task.isDone}
          onCheckedChange={(checked) => onToggle(task.emailId, !!checked)}
          data-testid={`checkbox-inbox-${task.emailId}`}
          className="h-4 w-4"
        />
      </div>
      <div
        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-semibold ${color}`}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className={`text-sm font-medium truncate ${
              task.isDone
                ? "line-through text-muted-foreground"
                : !task.isRead
                ? "font-semibold"
                : ""
            }`}
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
      <div className="shrink-0 text-xs text-muted-foreground whitespace-nowrap pt-0.5">
        {isToday(receivedAt)
          ? format(receivedAt, "h:mm a")
          : format(receivedAt, "MMM d")}
      </div>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

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

// ── Loading skeleton ──────────────────────────────────────────────────────────

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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InboxTasks() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  const [showDone, setShowDone] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  // Connection status — polling every 30 s
  const { data: status, isLoading: statusLoading } = useQuery<{
    connected: boolean;
  }>({
    queryKey: ["/api/inbox/status"],
    refetchInterval: 30_000,
  });

  // Cached tasks for this user
  const { data: tasks = [], isLoading: tasksLoading } = useQuery<InboxTask[]>({
    queryKey: ["/api/inbox/tasks"],
  });

  // Refresh — fetches live from Gmail and upserts into cache (any user)
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/inbox/messages");
      return res.json() as Promise<InboxTask[]>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/inbox/tasks"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/status"] });
      toast({
        title: `Refreshed — ${data.length} email${data.length !== 1 ? "s" : ""}`,
      });
    },
    onError: () => {
      toast({ title: "Refresh failed", variant: "destructive" });
    },
  });

  // Admin-only: auto-fetch on page load when connected but cache is empty
  useEffect(() => {
    if (
      isAdmin &&
      status?.connected &&
      !tasksLoading &&
      tasks.length === 0 &&
      !refreshMutation.isPending
    ) {
      refreshMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, status?.connected, tasksLoading]);

  // Connect — opens Gmail OAuth in a new tab (any user can connect their own account)
  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/inbox/connect");
      return res.json() as Promise<{ authUrl?: string; error?: string; code?: string }>;
    },
    onSuccess: (data) => {
      if (data.authUrl) {
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
        toast({
          title: "Gmail OAuth opened",
          description:
            "Complete the authorisation in the new tab, then click Refresh here.",
        });
      } else if (data.code === "NO_CONNECTOR_HOST") {
        toast({
          title: "Use the Integrations panel",
          description:
            "Click the puzzle-piece icon in the Replit sidebar to connect Gmail, then refresh.",
        });
      } else {
        toast({
          title: "Could not start OAuth",
          description: data.error ?? "Unknown error",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({
        title: "Could not start Gmail connection",
        description:
          "Try connecting Gmail from the Replit integrations panel (puzzle-piece icon).",
        variant: "destructive",
      });
    },
  });

  // Disconnect — revokes OAuth and clears this user's cached tasks
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/inbox/disconnect");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/inbox/tasks"], []);
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/status"] });
      setShowDisconnectDialog(false);
      toast({ title: "Gmail disconnected" });
    },
    onError: () => {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    },
  });

  const connected = status?.connected ?? false;

  const visibleTasks = showDone ? tasks : tasks.filter((t) => !t.isDone);
  const groups = groupByDay(visibleTasks);

  const todayTotal = tasks.filter((t) => isToday(new Date(t.receivedAt))).length;
  const todayDone = tasks.filter(
    (t) => isToday(new Date(t.receivedAt)) && t.isDone
  ).length;
  const todayUndone = todayTotal - todayDone;
  const unreadCount = tasks.filter((t) => !t.isRead && !t.isDone).length;

  const isLoading = statusLoading || tasksLoading;
  const showNotConnected = !isLoading && !connected;
  const showEmptyConnected = !isLoading && connected && visibleTasks.length === 0;
  const showList = !isLoading && connected && visibleTasks.length > 0;

  const handleToggle = (emailId: string, isDone: boolean) => {
    // Optimistic update
    queryClient.setQueryData(["/api/inbox/tasks"], (old: InboxTask[] = []) =>
      old.map((t) => (t.emailId === emailId ? { ...t, isDone } : t))
    );
    apiRequest("PATCH", `/api/inbox/tasks/${emailId}/done`, { isDone }).catch(() => {
      // Rollback on failure
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks"] });
      toast({ title: "Couldn't update task", variant: "destructive" });
    });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Disconnect confirmation */}
      <AlertDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Gmail?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revoke Gmail access and remove your cached inbox tasks.
              You can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disconnectMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            data-testid="status-gmail-connection"
          >
            {connected ? (
              <Wifi className="h-3 w-3" />
            ) : (
              <WifiOff className="h-3 w-3" />
            )}
            {connected ? "Gmail connected" : "Not connected"}
          </div>

          {/* Admin-only: Connect (when not connected) */}
          {isAdmin && !connected && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              data-testid="button-connect-gmail"
            >
              <PlugZap className="h-4 w-4 mr-1.5" />
              {connectMutation.isPending ? "Opening…" : "Connect Gmail"}
              <ExternalLink className="h-3 w-3 ml-1 opacity-60" />
            </Button>
          )}

          {/* Admin-only: Disconnect */}
          {isAdmin && connected && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDisconnectDialog(true)}
              data-testid="button-disconnect-gmail"
              className="text-destructive hover:text-destructive"
            >
              <Unplug className="h-4 w-4 mr-1.5" />
              Disconnect
            </Button>
          )}

          {/* Show/hide done — all users */}
          {connected && tasks.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDone((v) => !v)}
              data-testid="button-toggle-done"
            >
              <CheckCheck className="h-4 w-4 mr-1.5" />
              {showDone ? "Hide done" : "Show done"}
            </Button>
          )}

          {/* Admin-only: Refresh (live Gmail fetch) */}
          {isAdmin && connected && (
            <Button
              size="sm"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              data-testid="button-refresh"
            >
              <RefreshCw
                className={`h-4 w-4 mr-1.5 ${
                  refreshMutation.isPending ? "animate-spin" : ""
                }`}
              />
              {refreshMutation.isPending ? "Refreshing…" : "Refresh"}
            </Button>
          )}
        </div>
      </div>

      {/* Stat cards — only when we have tasks */}
      {tasks.length > 0 && (
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
      )}

      {/* Main content */}
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <TasksSkeleton />
          ) : showNotConnected ? (
            <NotConnectedCard
              onConnect={() => connectMutation.mutate()}
              connecting={connectMutation.isPending}
              isAdmin={isAdmin}
            />
          ) : showEmptyConnected ? (
            <EmptyInboxCard
              onRefresh={() => refreshMutation.mutate()}
              loading={refreshMutation.isPending}
              isAdmin={isAdmin}
            />
          ) : showList ? (
            <>
              <Section label="Today" tasks={groups.today} onToggle={handleToggle} />
              <Section
                label="Yesterday"
                tasks={groups.yesterday}
                onToggle={handleToggle}
              />
              <Section label="Earlier" tasks={groups.earlier} onToggle={handleToggle} />
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Footer hint */}
      {tasks.length > 0 && (
        <p className="text-xs text-muted-foreground text-center mt-4">
          <Clock className="h-3 w-3 inline mr-1" />
          Click an email row or its checkbox to mark it done · Use Refresh to sync latest inbox
        </p>
      )}
    </div>
  );
}
