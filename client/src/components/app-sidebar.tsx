import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, Briefcase, FileText, TriangleAlert, Calendar,
  DollarSign, Settings, PaintBucket, Package, LogOut, Inbox,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { partitionEmailTasks } from "@/components/inbox/email-state";
import type { InboxTask, ChangeOrder } from "@shared/schema";
import { isRouteActive } from "@/lib/app-shell";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Clients", url: "/clients", icon: Users },
  { title: "Jobs", url: "/jobs", icon: Briefcase },
  { title: "Materials", url: "/materials", icon: Package },
  { title: "Invoices", url: "/invoices", icon: FileText },
  { title: "Change Orders", url: "/change-orders", icon: TriangleAlert },
  { title: "Scheduling", url: "/scheduling", icon: Calendar },
  { title: "Payroll", url: "/payroll", icon: DollarSign },
  { title: "Inbox", url: "/inbox", icon: Inbox },
];
export const APP_PRIMARY_NAV_ITEMS = navItems.map((item) => item.title);

function NavLink({ item, location, count }: {
  item: typeof navItems[number];
  location: string;
  count?: number;
}) {
  const isActive = isRouteActive(location, item.url);
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        className="h-auto min-h-11 rounded-full border-2 border-jx-ink-3 bg-card px-4 py-2.5 text-[14px] font-semibold text-jx-ink transition-colors hover:border-jx-green hover:bg-jx-green-tint hover:text-jx-green-ink data-[active=true]:border-jx-green data-[active=true]:bg-jx-green data-[active=true]:text-white data-[active=true]:hover:bg-jx-green-hover"
      >
        <Link
          href={item.url}
          onClick={() => { if (isMobile) setOpenMobile(false); }}
          data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <item.icon className="h-[17px] w-[17px] shrink-0" />
          <span className="min-w-0 flex-1">{item.title}</span>
          {count !== undefined && count > 0 && (
            <Badge
              variant="secondary"
              className={`ml-auto h-6 min-w-6 rounded-full px-2 font-mono text-xs font-semibold ${
                isActive ? "border-0 bg-white/20 text-white" : "border-0 bg-jx-orange-tint text-jx-orange-ink"
              }`}
              data-testid={`badge-${item.title.toLowerCase().replace(/\s+/g, "-")}-count`}
            >
              {count}
            </Badge>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout, isLoggingOut } = useAuth();
  const { data: inboxTasks } = useQuery<InboxTask[]>({
    queryKey: ["/api/inbox/tasks"],
    refetchInterval: 60_000,
  });
  const { data: changeOrders } = useQuery<ChangeOrder[]>({
    queryKey: ["/api/change-orders"],
    refetchInterval: 60_000,
  });

  // Match Inbox's To do count, including older mail and expired snoozes.
  const inboxBadge = partitionEmailTasks(inboxTasks ?? [], []).todo.length;
  const changeOrderBadge = changeOrders?.filter((order) => order.status === "pending").length ?? 0;

  return (
    <Sidebar className="border-r border-jx-line bg-sidebar">
      <SidebarHeader className="px-4 pb-2 pt-6">
        <Link href="/" className="flex items-center gap-3 no-underline">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-jx-green text-white">
            <PaintBucket className="h-[18px] w-[18px]" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="font-display text-[17px] font-extrabold tracking-[-0.03em] text-jx-ink">JOBSOXO</span>
            <span className="font-display text-[14px] leading-tight text-jx-ink-2">Invoicing</span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-5 px-4 py-4">
        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="mb-2 px-1 text-xs font-medium text-jx-ink-3">Main menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {navItems.map((item) => (
                <NavLink
                  key={item.title}
                  item={item}
                  location={location}
                  count={item.title === "Inbox" ? inboxBadge : item.title === "Change Orders" ? changeOrderBadge : undefined}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="mb-2 px-1 text-xs font-medium text-jx-ink-3">System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              <NavLink item={{ title: "Settings", url: "/settings", icon: Settings }} location={location} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="mt-auto p-4">
        {user && (
          <div className="flex items-center gap-3 rounded-[14px] bg-jx-surface p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-jx-gold-tint font-display text-sm font-bold text-jx-gold-ink">
              {user.username.slice(0, 1).toUpperCase()}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-jx-ink">{user.username}</span>
              <span className="text-xs text-jx-ink-2">Signed in</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              disabled={isLoggingOut}
              data-testid="button-logout"
              title="Sign out"
              className="h-9 w-9 shrink-0 rounded-full text-jx-ink-2 hover:bg-card hover:text-jx-ink"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
