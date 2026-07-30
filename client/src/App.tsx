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
import JobDetail from "@/pages/job-detail";
import ChangeOrders from "@/pages/change-orders";
import JobLineItems from "@/pages/job-line-items";
import Invoices from "@/pages/invoices";
import InvoiceNew from "@/pages/invoice-new";
import InvoiceDetail from "@/pages/invoice-detail";
import InvoicePayment from "@/pages/invoice-payment";
import Scheduling from "@/pages/scheduling";
import Payroll from "@/pages/payroll";
import InboxTasks from "@/pages/inbox-tasks";
import GmailTodos from "@/pages/gmail-todos";
import Settings from "@/pages/settings";
import Login from "@/pages/login";
import ResetPassword from "@/pages/reset-password";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import InvoicePay from "@/pages/invoice-pay";
import EmployeeBankSetup from "@/pages/employee-bank-setup";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/clients" component={Clients} />
      <Route path="/jobs" component={Jobs} />
      <Route path="/jobs/:id/line-items" component={JobLineItems} />
      <Route path="/jobs/:id" component={JobDetail} />
      <Route path="/change-orders" component={ChangeOrders} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/invoices/new" component={InvoiceNew} />
      <Route path="/invoices/:id" component={InvoiceDetail} />
      <Route path="/invoices/:id/payment" component={InvoicePayment} />
      <Route path="/scheduling" component={Scheduling} />
      <Route path="/payroll" component={Payroll} />
      <Route path="/inbox-tasks" component={InboxTasks} />
      <Route path="/gmail-todos" component={GmailTodos} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/clients": "Clients",
  "/jobs": "Jobs",
  "/invoices": "Invoices",
  "/invoices/new": "New Invoice",
  "/change-orders": "Change Orders",
  "/scheduling": "Scheduling",
  "/payroll": "Payroll",
  "/inbox-tasks": "Inbox Tasks",
  "/gmail-todos": "Gmail Todos",
  "/settings": "Settings",
};

function AppTopbar() {
  const [location] = useLocation();
  const label =
    ROUTE_LABELS[location] ??
    (location.startsWith("/invoices/") ? "Invoice" :
     location.startsWith("/jobs/") ? "Job" :
     location.startsWith("/clients/") ? "Client" : "");

  return (
    <header className="h-[54px] flex-shrink-0 flex items-center gap-3 px-[22px] border-b bg-background/70 backdrop-blur-md">
      <SidebarTrigger data-testid="button-sidebar-toggle" className="text-muted-foreground" />
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span>JobsOxo</span>
        <span>/</span>
        <span className="text-foreground font-semibold">{label}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-1.5 w-[240px]">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-[12.5px] text-muted-foreground">Search invoices, clients…</span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

function AuthenticatedApp() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <AppTopbar />
          <main className="flex-1 overflow-y-auto">
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
