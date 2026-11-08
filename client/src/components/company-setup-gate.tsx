import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { missingCompanyFields } from "@shared/company-setup";
import type { Settings } from "@shared/schema";

/**
 * Until the required company settings are saved, admins are kept on Settings
 * (which explains what's missing) and members see a banner while they work.
 */
export function CompanySetupGate() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const { data: settings, isSuccess } = useQuery<Settings>({ queryKey: ["/api/settings"] });

  const setupIncomplete = isSuccess && missingCompanyFields(settings).length > 0;
  const isAdmin = !!user?.isAdmin;

  useEffect(() => {
    if (setupIncomplete && isAdmin && location !== "/settings") {
      setLocation("/settings", { replace: true });
    }
  }, [setupIncomplete, isAdmin, location, setLocation]);

  if (!setupIncomplete || isAdmin) return null;

  return (
    <div
      className="border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 md:px-8 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
      role="status"
      data-testid="banner-setup-pending"
    >
      Company setup isn't finished yet. An admin needs to fill in the company details in Settings before invoices show your business information.
    </div>
  );
}
