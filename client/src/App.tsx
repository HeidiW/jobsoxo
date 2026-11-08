import { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Search } from "lucide-react";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Clients from "@/pages/clients";
import Jobs from "@/pages/jobs";
import Materials from "@/pages/materials";
import JobDetail from "@/pages/job-detail";
import ChangeOrders from "@/pages/change-orders";
import JobLineItems from "@/pages/job-line-items";
import Invoices from "@/pages/invoices";
import InvoiceNew from "@/pages/invoice-new";
import InvoiceDetail from "@/pages/invoice-detail";
import InvoicePayment from "@/pages/invoice-payment";
import Scheduling from "@/pages/scheduling";
import PayrollArea from "@/components/payroll-area";
import InboxShell from "@/components/inbox-shell";
import Settings from "@/pages/settings";
import Login from "@/pages/login";
import ResetPassword from "@/pages/reset-password";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import InvoicePay from "@/pages/invoice-pay";
import EmployeeBankSetup from "@/pages/employee-bank-setup";
import { initializeAnalytics } from "@/lib/analytics";
import { legacyInboxDestination } from "@/lib/app-shell";
import { CompanySetupGate } from "@/components/company-setup-gate";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/clients" component={Clients} />
      <Route path="/jobs" component={Jobs} />
      <Route path="/materials" component={Materials} />
      <Route path="/jobs/:id/line-items" component={JobLineItems} />
      <Route path="/jobs/:id" component={JobDetail} />
      <Route path="/change-orders" component={ChangeOrders} />
      <Route path="/invoices/new" component={InvoiceNew} />
      <Route path="/invoices/:id/payment" component={InvoicePayment} />
      <Route path="/invoices/:id" component={InvoiceDetail} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/scheduling" component={Scheduling} />
      <Route path="/payroll/worksheet" component={PayrollArea} />
      <Route path="/payroll" component={PayrollArea} />
      <Route path="/inbox" component={InboxShell} />
      <Route path="/inbox-tasks">
        <LegacyInboxRedirect />
      </Route>
      <Route path="/gmail-todos">
        <LegacyInboxRedirect />
      </Route>
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/clients": "Clients",
  "/jobs": "Jobs",
  "/materials": "Materials",
  "/invoices": "Invoices",
  "/invoices/new": "New Invoice",
  "/change-orders": "Change Orders",
  "/scheduling": "Scheduling",
  "/payroll": "Payroll",
  "/payroll/worksheet": "Gusto worksheet",
  "/inbox": "Inbox",
  "/settings": "Settings",
};

function LegacyInboxRedirect() {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    setLocation(legacyInboxDestination(window.location.pathname, window.location.search), { replace: true });
  }, [location, setLocation]);

  return <div className="min-h-full animate-pulse bg-jx-surface/40" aria-label="Opening inbox" />;
}

function AppTopbar() {
  const [location] = useLocation();
  const routeLabel =
    ROUTE_LABELS[location] ??
    (location.startsWith("/invoices/") ? "Invoice" :
     location.startsWith("/jobs/") ? "Job" :
     location.startsWith("/clients/") ? "Client" : "");
  const parentLabel = location.startsWith("/invoices/") ? "Invoices"
    : location.startsWith("/jobs/") ? "Jobs"
    : location.startsWith("/clients/") ? "Clients"
    : location.startsWith("/payroll/") ? "Payroll"
    : "";

  return (
    <header className="sticky top-0 z-20 flex h-[60px] flex-shrink-0 items-center gap-3.5 border-b border-jx-line bg-background px-4 md:px-8">
      <SidebarTrigger data-testid="button-sidebar-toggle" className="text-jx-ink-2" />
      <div className="flex min-w-0 items-center gap-2 text-[13px] text-jx-ink-3">
        <span className="shrink-0">JobsOxo</span>
        {(parentLabel || routeLabel) && <span aria-hidden="true">/</span>}
        {parentLabel && <span className="shrink-0">{parentLabel}</span>}
        {parentLabel && routeLabel && <span aria-hidden="true">/</span>}
        <span className="truncate font-semibold text-jx-ink">{routeLabel}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div aria-hidden="true" className="hidden w-[260px] items-center gap-2 rounded-full bg-jx-surface px-3.5 py-2.5 text-[13px] text-jx-ink-3 sm:flex">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span>Search invoices, clients…</span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

function AuthenticatedApp() {
  const style = {
    "--sidebar-width": "248px",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-[100dvh] min-h-[100dvh] w-full overflow-hidden">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <AppTopbar />
          <CompanySetupGate />
          <main className="min-w-0 flex-1 overflow-y-auto bg-background">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  // Public pages — accessible without authentication
  if (window.location.pathname === "/reset-password") {
    return <ResetPassword />;
  }
  if (window.location.pathname === "/privacy") {
    return <Privacy />;
  }
  if (window.location.pathname === "/terms") {
    return <Terms />;
  }
  if (window.location.pathname.startsWith("/pay/")) {
    return <InvoicePay />;
  }
  if (window.location.pathname === "/employee-bank-setup") {
    return <EmployeeBankSetup />;
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return <AuthenticatedApp />;
}

function App() {
  useEffect(() => {
    initializeAnalytics();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="jobsoxo-theme">
        <TooltipProvider>
          <AppContent />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
