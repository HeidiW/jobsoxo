import { useEffect } from "react";
import { useLocation } from "wouter";
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
      <section className="min-h-full">
        {worksheetRoute ? <PayrollWorksheet /> : <Payroll />}
      </section>
    </div>
  );
}
