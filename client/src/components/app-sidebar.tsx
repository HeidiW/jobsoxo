import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  FileText,
  AlertTriangle,
  Calendar,
  DollarSign,
  Settings,
  PaintBucket,
  Package,
  LogOut,
  Inbox,
  Mail,
  ClipboardPenLine,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { isToday } from "date-fns";
import type { InboxTask } from "@shared/schema";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Clients", url: "/clients", icon: Users },
  { title: "Jobs", url: "/jobs", icon: Briefcase },
  { title: "Materials", url: "/materials", icon: Package },
  { title: "Invoices", url: "/invoices", icon: FileText },
  { title: "Change Orders", url: "/change-orders", icon: AlertTriangle },
  { title: "Scheduling", url: "/scheduling", icon: Calendar },
  { title: "Payroll", url: "/payroll", icon: DollarSign },
  { title: "Gusto Worksheet", url: "/payroll/worksheet", icon: ClipboardPenLine, adminOnly: true },
];

const settingsItems = [
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout, isLoggingOut } = useAuth();

  const { data: inboxTasks } = useQuery<InboxTask[]>({
    queryKey: ["/api/inbox/tasks"],
    refetchInterval: 60_000,
  });

  const inboxBadge = inboxTasks
    ? inboxTasks.filter((t) => !t.isDone && isToday(new Date(t.receivedAt))).length
    : 0;

  const isInboxActive =
    location === "/inbox-tasks" || location.startsWith("/inbox-tasks");

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
            <PaintBucket className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-semibold">JobsOxo</span>
            <span className="text-xs text-muted-foreground">Invoicing</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.filter((item) => !item.adminOnly || user?.isAdmin).map((item) => {
                const isActive =
                  location === item.url ||
                  (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link
                        href={item.url}
                        data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}

              {/* Inbox Tasks — business action inbox (no badge) */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isInboxActive}>
                  <Link href="/inbox-tasks" data-testid="nav-inbox-tasks">
                    <Inbox className="h-4 w-4" />
                    <span>Inbox Tasks</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Gmail Todos — Gmail-connected inbox with unread badge */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/gmail-todos"}>
                  <Link href="/gmail-todos" data-testid="nav-gmail-todos">
                    <Mail className="h-4 w-4" />
                    <span>Gmail Todos</span>
                    {inboxBadge > 0 && (
                      <Badge
                        className="ml-auto h-4 min-w-4 px-1 text-[10px] bg-primary text-primary-foreground leading-none"
                        data-testid="badge-gmail-count"
                      >
                        {inboxBadge}
                      </Badge>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link
                        href={item.url}
                        data-testid={`nav-${item.title.toLowerCase()}`}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 space-y-3">
        {user && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">{user.username}</span>
              <span className="text-xs text-muted-foreground">Signed in</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              disabled={isLoggingOut}
              data-testid="button-logout"
              title="Sign out"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          Construction Painting &amp; Decorating
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
