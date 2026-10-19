import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClientForm } from "@/components/clients/client-form";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CircleAlert,
  FileText,
  Mail,
  MapPin,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Trash2,
  UsersRound,
  BriefcaseBusiness,
  Pencil,
} from "lucide-react";
import type { Client } from "@shared/schema";
import { formatPhone } from "@/lib/formatPhone";

interface ClientWithStats extends Client {
  activeJobs: number;
  outstandingBalance: number;
  lastInvoiceDate?: string | Date;
}

const CARD_TINTS = [
  { card: "bg-jx-green-tint", tile: "text-jx-green-ink" },
  { card: "bg-jx-blue-tint", tile: "text-jx-blue-ink" },
  { card: "bg-jx-gold-tint", tile: "text-jx-gold-ink" },
  { card: "bg-jx-orange-tint", tile: "text-jx-orange-ink" },
  { card: "bg-jx-surface", tile: "text-jx-ink-2" },
] as const;

function initialsFor(name: string) {
  const omit = new Set(["and", "the", "&", "of", "co", "company", "llc", "inc"]);
  const words = name.trim().split(/\s+/).filter((word) => word && !omit.has(word.toLowerCase()));
  if (!words.length) return name.trim().slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function money(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function invoiceDate(value?: string | Date | null) {
  if (!value) return "No invoice date";
  try {
    return format(new Date(value), "MMM d, yyyy");
  } catch {
    return "No invoice date";
  }
}

function ClientCard({
  client,
  index,
  onEdit,
  onDelete,
}: {
  client: ClientWithStats;
  index: number;
  onEdit: (client: Client) => void;
  onDelete: (client: Client) => void;
}) {
  const tint = CARD_TINTS[index % CARD_TINTS.length];
  const location = [client.address, [client.city, client.state, client.zipCode].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(", ");

  return (
    <article
      className={`min-w-0 rounded-[28px] p-5 text-jx-ink sm:p-6 ${tint.card}`}
      data-testid={`row-client-${client.id}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div
          aria-hidden="true"
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-card font-display text-sm !font-bold ${tint.tile}`}
        >
          {initialsFor(client.name)}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="break-words font-display text-[21px] !font-bold leading-[1.08] tracking-[-.035em] text-jx-ink">
            {client.name}
          </h2>
          {client.generalContractorName && (
            <p className="mt-1 break-words text-[13px] leading-snug text-jx-ink-2">
              GC: {client.generalContractorName}
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${client.name}`}
              className="h-11 w-11 shrink-0 rounded-full text-jx-ink-2 hover:bg-card/70 hover:text-jx-ink"
              data-testid={`button-client-actions-${client.id}`}
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-2xl p-1.5">
            <DropdownMenuItem
              onSelect={() => onEdit(client)}
              className="min-h-11 cursor-pointer rounded-xl"
              data-testid={`button-edit-client-${client.id}`}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit client
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onDelete(client)}
              className="min-h-11 cursor-pointer rounded-xl text-destructive focus:text-destructive"
              data-testid={`button-delete-client-${client.id}`}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete client
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-5 space-y-2.5">
        {client.email && (
          <a
            href={`mailto:${client.email}`}
            className="flex min-w-0 items-start gap-2.5 rounded-lg text-[14px] leading-5 text-jx-ink-2 no-underline hover:text-jx-ink"
          >
            <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-all">{client.email}</span>
          </a>
        )}
        {client.phone && (
          <a
            href={`tel:${client.phone.replace(/[^\d+]/g, "")}`}
            className="flex min-w-0 items-start gap-2.5 rounded-lg text-[14px] leading-5 text-jx-ink-2 no-underline hover:text-jx-ink"
          >
            <Phone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="break-words">{formatPhone(client.phone)}</span>
          </a>
        )}
        {location && (
          <div className="flex min-w-0 items-start gap-2.5 text-[14px] leading-5 text-jx-ink-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{location}</span>
          </div>
        )}
        {!client.email && !client.phone && !location && (
          <p className="text-sm text-jx-ink-2">No contact details added yet.</p>
        )}
      </div>

      <div className="mt-5 flex min-w-0 items-center justify-between gap-4 rounded-2xl bg-card px-4 py-3.5">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-jx-ink-2">Open balance</div>
          <div
            className="mt-0.5 break-words font-mono text-[20px] font-semibold leading-tight tabular-nums text-jx-ink"
            data-testid={`outstanding-${client.id}`}
          >
            {money(client.outstandingBalance)}
          </div>
        </div>
        <div className="shrink-0 border-l border-jx-line pl-4 text-right">
          <div className="text-[12px] font-medium text-jx-ink-2">Active jobs</div>
          <div
            className="mt-0.5 font-mono text-[20px] font-semibold leading-tight tabular-nums text-jx-ink"
            data-testid={`jobs-count-${client.id}`}
          >
            {client.activeJobs}
          </div>
        </div>
      </div>
      <span className="sr-only" data-testid={`last-invoice-${client.id}`}>
        {invoiceDate(client.lastInvoiceDate)}
      </span>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          asChild
          type="button"
          variant="outline"
          className="min-h-11 rounded-full border-2 border-jx-ink px-3 text-[13px] font-semibold text-jx-ink hover:border-jx-green hover:bg-card"
          data-testid={`button-view-jobs-${client.id}`}
        >
          <Link href={`/jobs?clientId=${encodeURIComponent(client.id)}`}>
            <BriefcaseBusiness className="mr-1.5 h-4 w-4 shrink-0" />
            View jobs
          </Link>
        </Button>
        <Button
          asChild
          type="button"
          className="min-h-11 rounded-full bg-jx-green px-3 text-[13px] font-semibold text-white hover:bg-jx-green-hover"
          data-testid={`button-create-invoice-${client.id}`}
        >
          <Link href={`/invoices/new?clientId=${encodeURIComponent(client.id)}`}>
            <FileText className="mr-1.5 h-4 w-4 shrink-0" />
            New invoice
          </Link>
        </Button>
      </div>
    </article>
  );
}

function ClientCardSkeleton({ index }: { index: number }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-[28px] p-6 ${CARD_TINTS[index % CARD_TINTS.length].card}`}
    >
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 rounded-2xl bg-card/80" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-5 w-3/4 rounded bg-card/80" />
          <div className="h-3 w-1/2 rounded bg-card/70" />
        </div>
      </div>
      <div className="mt-7 space-y-3">
        <div className="h-4 w-4/5 rounded bg-card/70" />
        <div className="h-4 w-2/3 rounded bg-card/70" />
        <div className="h-4 w-full rounded bg-card/70" />
      </div>
      <div className="mt-6 h-[68px] rounded-2xl bg-card/80" />
      <div className="mt-4 h-11 rounded-full bg-card/80" />
    </div>
  );
}

export default function Clients() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const { toast } = useToast();
  const {
    data: clients,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<ClientWithStats[]>({ queryKey: ["/api/clients"] });

  const deleteClientMutation = useMutation({
    mutationFn: async (clientId: string) => {
      await apiRequest("DELETE", `/api/clients/${clientId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: "Client deleted",
        description: `"${deletingClient?.name}" and its associated records have been deleted.`,
      });
      setDeletingClient(null);
      setDeleteError("");
    },
    onError: (error: Error) => {
      setDeleteError(error.message || "The client could not be deleted. Try again.");
      toast({
        title: "Failed to delete client",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const filteredClients = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    if (!term) return clients ?? [];
    return (clients ?? []).filter((client) =>
      [
        client.name,
        client.generalContractorName,
        client.email,
        client.phone,
        client.address,
        client.city,
        client.state,
        client.zipCode,
      ].some((value) => String(value ?? "").toLowerCase().includes(term)),
    );
  }, [clients, searchQuery]);

  const totalOutstanding = (clients ?? []).reduce(
    (sum, client) => sum + Number(client.outstandingBalance ?? 0),
    0,
  );
  const totalActiveJobs = (clients ?? []).reduce(
    (sum, client) => sum + Number(client.activeJobs ?? 0),
    0,
  );
  const openAdd = () => {
    setEditingClient(null);
    setDialogOpen(true);
  };
  const openEdit = (client: Client) => {
    setEditingClient(client);
    setDialogOpen(true);
  };
  const closeForm = () => {
    setDialogOpen(false);
    setEditingClient(null);
  };

  return (
    <>
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
          else setDialogOpen(true);
        }}
      >
        <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden rounded-[28px] border-jx-line bg-card p-0 text-jx-ink sm:max-w-[640px]">
          <DialogHeader className="shrink-0 border-b border-jx-line px-6 py-5 sm:px-8">
            <DialogTitle className="font-display text-2xl !font-bold tracking-[-.04em] text-jx-ink">
              {editingClient ? "Edit client" : "Add a client"}
            </DialogTitle>
            <p className="text-sm text-jx-ink-2">
              Keep their contact details close to the work and the money.
            </p>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-8">
            <ClientForm client={editingClient ?? undefined} onClose={closeForm} />
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deletingClient}
        onOpenChange={(open) => {
          if (!open && !deleteClientMutation.isPending) {
            setDeletingClient(null);
            setDeleteError("");
          }
        }}
      >
        <AlertDialogContent className="rounded-[28px] border-jx-line bg-card text-jx-ink">
          <AlertDialogHeader>
            <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-jx-orange-tint text-jx-orange-ink">
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <AlertDialogTitle className="font-display text-2xl !font-bold text-jx-ink">
              Delete this client?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-jx-ink-2">
              Deleting <strong className="text-jx-ink">{deletingClient?.name}</strong> also permanently
              deletes all associated jobs, invoices, and related records. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="rounded-xl bg-jx-orange-tint px-4 py-3 text-sm text-jx-orange-ink" role="alert">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteClientMutation.isPending}
              data-testid="button-cancel-delete-client"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteClientMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deletingClient && !deleteClientMutation.isPending) {
                  setDeleteError("");
                  deleteClientMutation.mutate(deletingClient.id);
                }
              }}
              data-testid="button-confirm-delete-client"
            >
              {deleteClientMutation.isPending ? "Deleting…" : "Delete client"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <main className="min-h-[100dvh] px-4 pb-12 pt-7 sm:px-7 sm:pt-9 xl:px-10">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 sm:gap-7">
          <header className="flex flex-wrap items-end justify-between gap-5">
            <div className="min-w-0">
              <h1
                className="font-display text-[48px] !font-bold leading-[.95] tracking-[-.055em] text-jx-ink sm:text-[64px]"
                data-testid="heading-clients"
              >
                Clients
              </h1>
              <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[15px] text-jx-ink-2 sm:text-[17px]">
                {isLoading ? (
                  "Loading client totals"
                ) : isError ? (
                  "Client totals are unavailable"
                ) : (
                  <>
                    <span data-testid="stat-total-clients">
                      {clients?.length ?? 0} {(clients?.length ?? 0) === 1 ? "client" : "clients"}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      <span className="font-mono" data-testid="stat-outstanding">
                        {money(totalOutstanding)}
                      </span>{" "}
                      owed to you
                    </span>
                    <span className="sr-only" data-testid="stat-active-jobs">{totalActiveJobs}</span>
                  </>
                )}
              </p>
            </div>
            <Button
              type="button"
              onClick={openAdd}
              className="min-h-12 rounded-full bg-jx-green px-6 text-xs font-bold tracking-[.08em] text-white hover:bg-jx-green-hover sm:px-7 sm:text-sm"
              data-testid="button-add-client"
            >
              <Plus className="mr-2 h-4 w-4" strokeWidth={2.5} />
              NEW CLIENT
            </Button>
          </header>

          <section aria-label="Search clients" className="flex flex-wrap items-center gap-3">
            <div className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full border-2 border-transparent bg-jx-surface px-4 focus-within:border-jx-green sm:max-w-[420px]">
              <Search className="h-4 w-4 shrink-0 text-jx-ink-3" aria-hidden="true" />
              <input
                type="search"
                aria-label="Search clients"
                placeholder="Search clients, contacts, phone"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm text-jx-ink outline-none placeholder:text-jx-ink-3"
                data-testid="input-search-clients"
              />
            </div>
            {!isLoading && !isError && (
              <span className="text-sm text-jx-ink-2" aria-live="polite">
                {searchQuery.trim()
                  ? `${filteredClients.length} of ${clients?.length ?? 0} clients`
                  : `${filteredClients.length} ${filteredClients.length === 1 ? "client" : "clients"}`}
              </span>
            )}
          </section>

          {isLoading ? (
            <section
              aria-label="Loading clients"
              className="grid gap-4 sm:gap-5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))]"
              data-testid="clients-loading"
            >
              {[0, 1, 2, 3].map((index) => <ClientCardSkeleton key={index} index={index} />)}
            </section>
          ) : isError ? (
            <section
              className="flex min-h-[300px] flex-col items-center justify-center rounded-[28px] bg-jx-surface px-6 py-10 text-center"
              role="alert"
              data-testid="clients-error"
            >
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-jx-orange-tint text-jx-orange-ink">
                <CircleAlert className="h-6 w-6" aria-hidden="true" />
              </div>
              <h2 className="font-display text-2xl !font-bold text-jx-ink">Clients didn’t load</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-jx-ink-2">
                Your client details and balances aren’t available right now. Check your connection and try again.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void refetch()}
                disabled={isFetching}
                className="mt-5 min-h-11 rounded-full border-2 border-jx-ink px-6 font-semibold text-jx-ink"
                data-testid="button-retry-clients"
              >
                {isFetching ? "Trying again…" : "Retry"}
              </Button>
            </section>
          ) : filteredClients.length === 0 ? (
            <section
              className="flex min-h-[300px] flex-col items-center justify-center rounded-[28px] bg-jx-green-tint px-6 py-10 text-center"
              data-testid={searchQuery.trim() ? "clients-no-matches" : "clients-empty"}
            >
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-card text-jx-green-ink">
                {searchQuery.trim() ? (
                  <Search className="h-6 w-6" aria-hidden="true" />
                ) : (
                  <UsersRound className="h-6 w-6" aria-hidden="true" />
                )}
              </div>
              <h2 className="font-display text-2xl !font-bold text-jx-ink">
                {searchQuery.trim() ? "No matching clients" : "No clients yet"}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-jx-ink-2">
                {searchQuery.trim()
                  ? "Try a different name, contact, phone number, or address."
                  : "Add a client to keep their contact details, jobs, and invoices together."}
              </p>
              {searchQuery.trim() ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSearchQuery("")}
                  className="mt-5 min-h-11 rounded-full border-2 border-jx-ink px-6 font-semibold text-jx-ink"
                >
                  Clear search
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={openAdd}
                  className="mt-5 min-h-12 rounded-full bg-jx-green px-6 font-bold text-white hover:bg-jx-green-hover"
                  data-testid="button-add-first-client"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add a client
                </Button>
              )}
            </section>
          ) : (
            <section
              aria-label="Clients"
              className="grid gap-4 sm:gap-5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))]"
              data-testid="clients-grid"
            >
              {filteredClients.map((client, index) => (
                <ClientCard
                  key={client.id}
                  client={client}
                  index={index}
                  onEdit={openEdit}
                  onDelete={(item) => {
                    setDeleteError("");
                    setDeletingClient(item);
                  }}
                />
              ))}
            </section>
          )}
        </div>
      </main>
    </>
  );
}
