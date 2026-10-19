import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ClipboardList, DollarSign } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import Payroll from "@/pages/payroll";
import PayrollWorksheet from "@/pages/payroll-worksheet";
import { hasWorksheetAccess } from "@/lib/app-shell";

export default function PayrollArea() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const worksheetRoute = location === "/payroll/worksheet";
  const allowed = hasWorksheetAccess(Boolean(user?.isAdmin));

  useEffect(() => {
    if (worksheetRoute && !allowed) setLocation("/payroll", { replace: true });
  }, [allowed, setLocation, worksheetRoute]);

  if (worksheetRoute && !allowed) {
    return <div className="min-h-full animate-pulse bg-jx-surface/40" aria-label="Loading payroll access" />;
  }

  return (
    <div className="min-h-full">
      <nav aria-label="Payroll sections" className="mx-auto flex max-w-[1500px] flex-wrap gap-2 px-5 pt-5 md:px-8">
        <Link
          href="/payroll"
          aria-current={!worksheetRoute ? "page" : undefined}
          data-testid="tab-payroll-runs"
          className={`inline-flex min-h-10 items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-semibold no-underline transition-colors ${
            !worksheetRoute ? "border-jx-green bg-jx-green text-white" : "border-jx-ink-3 bg-card text-jx-ink hover:border-jx-green"
          }`}
        >
          <DollarSign className="h-4 w-4" /> Payroll
        </Link>
        {allowed && (
          <Link
            href="/payroll/worksheet"
            aria-current={worksheetRoute ? "page" : undefined}
            data-testid="tab-payroll-worksheet"
            className={`inline-flex min-h-10 items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-semibold no-underline transition-colors ${
              worksheetRoute ? "border-jx-green bg-jx-green text-white" : "border-jx-ink-3 bg-card text-jx-ink hover:border-jx-green"
            }`}
          >
            <ClipboardList className="h-4 w-4" /> Gusto worksheet
          </Link>
        )}
      </nav>
      <section className="min-h-full">
        {worksheetRoute ? <PayrollWorksheet /> : <Payroll />}
      </section>
    </div>
  );
}
