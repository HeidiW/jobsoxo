import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
  return (
    <main className="mx-auto min-w-0 max-w-[1440px] space-y-6 px-5 py-7 sm:px-8 lg:px-10">
      <div className="space-y-3">
        <Skeleton className="h-16 w-[min(520px,80vw)] rounded-xl" />
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-11 w-64 rounded-full" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
        <Skeleton className="h-[320px] rounded-[24px]" />
        <Skeleton className="h-[320px] rounded-[24px]" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,.88fr)]">
        <Skeleton className="h-[290px] rounded-[24px]" />
        <Skeleton className="h-[340px] rounded-[24px]" />
      </div>
      <Skeleton className="h-40 rounded-[24px]" />
    </main>
  );
}

export function DashboardPanelHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[.16em]" style={{ color: "var(--jx-ink-3)" }}>
            {eyebrow}
          </div>
        )}
        <h2 className="font-display text-[22px] !font-bold tracking-[-.035em] sm:text-[25px]">{title}</h2>
      </div>
      {action}
    </div>
  );
}
