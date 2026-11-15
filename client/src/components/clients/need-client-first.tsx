// Empty state for pages whose records hang off a client (jobs, scheduling,
// materials). When there are no clients yet, the usual "nothing here" message
// would send people to the wrong place; this one names the real first step
// and takes them straight to the client form.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { UserPlus } from "lucide-react";
import type { Client } from "@shared/schema";

const COPY = {
  jobs: { title: "Jobs belong to a client", body: "Add your first client, then create a job for them. Hours, materials and invoices all hang off that job." },
  schedule: { title: "Nothing to schedule until there's a job", body: "Start by adding a client, then create a job for them. Jobs with dates show up here." },
  materials: { title: "Purchases are logged against a job", body: "Add your first client and a job for them, and purchases can be logged to that job." },
} as const;

export function NeedClientFirst({ context, children }: { context: keyof typeof COPY; children: ReactNode }) {
  const clients = useQuery<Client[]>({ queryKey: ["/api/clients"] });
  // Only take over when we know for certain there are no clients.
  if (!clients.isSuccess || !Array.isArray(clients.data) || clients.data.length > 0) return <>{children}</>;
  const copy = COPY[context];
  return (
    <div className="my-2 flex min-h-[300px] flex-col items-center justify-center rounded-2xl bg-card px-6 py-10 text-center" data-testid="need-client-first">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-jx-green-tint text-jx-green-ink"><UserPlus className="h-6 w-6" aria-hidden="true" /></div>
      <h2 className="font-display text-2xl !font-bold text-jx-ink">{copy.title}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-jx-ink-2">{copy.body}</p>
      <Link href="/clients?new=1" className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-full bg-jx-green px-6 font-bold text-white hover:bg-jx-green-hover" data-testid="button-add-first-client">
        <UserPlus className="h-4 w-4" aria-hidden="true" /> Add your first client
      </Link>
    </div>
  );
}
