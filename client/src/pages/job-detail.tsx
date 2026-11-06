import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { format } from "date-fns";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, ArrowRight, BriefcaseBusiness, CalendarDays, Check, CircleAlert, Clipboard,
  Download, File, FileText, Image as ImageIcon, MapPin, Package, Plus,
  Ruler, Trash2, Upload,
} from "lucide-react";
import type { Client, Employee, Invoice, Job, JobDocument, JobMaterial, LineItem } from "@shared/schema";
import JobForm from "@/components/job-form";
import { InvoiceStatusBadge, JobStatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatScheduleDate } from "./scheduling-logic";

interface InvoiceWithItems extends Invoice { lineItems: LineItem[] }
interface JobDetail extends Job {
  client: Client;
  invoices: InvoiceWithItems[];
  employees: Employee[];
  outstandingBalance: string;
  totalMaterialCost: string;
}
type JobDocumentMeta = Omit<JobDocument, "fileData">;

const money = (value: string | number | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
// Timestamps (createdAt, uploadedAt). Calendar dates use formatScheduleDate.
const shortDate = (value: string | Date) => format(new Date(value), "MMM d, yyyy");
const dateRange = (job: Job) => {
  if (!job.startDate && !job.endDate) return "Dates not set";
  if (job.startDate && job.endDate) return `${formatScheduleDate(job.startDate)} – ${formatScheduleDate(job.endDate)}`;
  return job.startDate ? `Starts ${formatScheduleDate(job.startDate)}` : `Ends ${formatScheduleDate(job.endDate)}`;
};
const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function PageSkeleton() {
  return <main className="mx-auto min-h-[100dvh] max-w-[1440px] space-y-6 px-4 py-7 sm:px-7 xl:px-10" aria-label="Loading job">
    <Skeleton className="h-8 w-36 rounded-full" />
    <div className="grid gap-5 lg:grid-cols-[1.55fr_.9fr]"><Skeleton className="h-[400px] rounded-3xl" /><Skeleton className="h-[400px] rounded-3xl" /></div>
    <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]"><Skeleton className="h-[420px] rounded-3xl" /><Skeleton className="h-[420px] rounded-3xl" /></div>
  </main>;
}

function SitePhoto({ jobId, title, documents, loading }: { jobId: string; title: string; documents?: JobDocumentMeta[]; loading: boolean }) {
  const image = documents?.find((doc) => doc.fileType.toLowerCase().startsWith("image/"));
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setPreview(null);
    setFailed(false);
    if (!image) return;
    fetch(`/api/job-documents/${encodeURIComponent(image.id)}/download`, { credentials: "include" })
      .then((response) => { if (!response.ok) throw new Error("Photo unavailable"); return response.blob(); })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ id: image.id, url: objectUrl });
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image?.id, jobId]);
  const source = !failed && preview && image && preview.id === image.id ? preview.url : null;
  return <div className="relative min-h-[280px] overflow-hidden rounded-3xl border border-jx-line bg-jx-green-tint lg:min-h-[380px]" data-testid="job-site-photo">
    {source ? <img src={source} alt={`Site photo for ${title}`} className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} /> : (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-jx-green-tint text-jx-green-ink">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-jx-green/20 bg-card/75">
          {loading ? <Skeleton className="h-8 w-8 rounded-lg" /> : failed || image ? <ImageIcon className="h-7 w-7" /> : <BriefcaseBusiness className="h-7 w-7" />}
        </div>
        <p className="mt-3 text-sm font-semibold">{loading ? "Finding site photo…" : failed ? "Site photo unavailable" : image ? "Loading site photo" : "No site photo yet"}</p>
        <p className="mt-1 text-xs text-jx-ink-2">Upload a job image in Plan documents</p>
      </div>
    )}
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-jx-ink/55 to-transparent px-5 pb-5 pt-16">
      <span className="inline-flex items-center gap-2 rounded-full bg-card/95 px-3 py-1.5 text-[11px] font-bold tracking-[.08em] text-jx-ink">
        <span className="h-2 w-2 rounded-full bg-jx-green" /> JOB SITE
      </span>
    </div>
  </div>;
}

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return <div className="flex items-center gap-2">
    <h2 className="font-display text-xl !font-bold tracking-[-.03em] text-jx-ink">{children}</h2>
    {count !== undefined && <span className="rounded-full bg-jx-surface px-2.5 py-0.5 font-mono text-xs font-medium text-jx-ink-2">{count}</span>}
  </div>;
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteInvoiceId, setDeleteInvoiceId] = useState<string | null>(null);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [changeOrderInvoiceId, setChangeOrderInvoiceId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: job, isLoading, isError, refetch, isFetching } = useQuery<JobDetail>({
    queryKey: ["/api/jobs", id], enabled: !!id,
  });
  const { data: documents, isLoading: docsLoading, isError: docsError } = useQuery<JobDocumentMeta[]>({
    queryKey: ["/api/jobs", id, "documents"], enabled: !!id,
  });
  const { data: lineItems, isLoading: pricingLoading, isError: pricingError } = useQuery<LineItem[]>({
    queryKey: ["/api/jobs", id, "line-items"], enabled: !!id,
  });
  const { data: materials, isLoading: materialsLoading, isError: materialsError } = useQuery<JobMaterial[]>({
    queryKey: [`/api/materials?jobId=${encodeURIComponent(id ?? "")}`], enabled: !!id,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData(); form.append("file", file);
      const response = await fetch(`/api/jobs/${id}/documents`, { method: "POST", credentials: "include", body: form });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(error.error || "Upload failed");
      }
      return response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/jobs", id, "documents"] });
      toast({ title: "Document uploaded" });
    },
    onError: (error: Error) => toast({ title: "Upload failed", description: error.message, variant: "destructive" }),
    onSettled: () => setUploading(false),
  });
  const deleteDocMutation = useMutation({
    mutationFn: async (docId: string) => { await apiRequest("DELETE", `/api/job-documents/${docId}`); },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/jobs", id, "documents"] });
      toast({ title: "Document deleted" }); setDeleteDocId(null);
    },
    onError: () => toast({ title: "Failed to delete document", variant: "destructive" }),
  });
  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => { await apiRequest("DELETE", `/api/invoices/${invoiceId}`); },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/jobs", id] });
      toast({ title: "Invoice deleted" }); setDeleteInvoiceId(null);
    },
    onError: () => toast({ title: "Failed to delete invoice", variant: "destructive" }),
  });
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File must be under 10 MB", variant: "destructive" }); event.target.value = ""; return;
    }
    setUploading(true); uploadMutation.mutate(file); event.target.value = "";
  }
  function handleDownload(doc: JobDocumentMeta) {
    const link = document.createElement("a");
    link.href = `/api/job-documents/${doc.id}/download`; link.download = doc.fileName;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  }

  if (isLoading) return <PageSkeleton />;
  if (isError || !job) return <main className="mx-auto flex min-h-[65dvh] max-w-3xl flex-col items-center justify-center px-5 text-center">
    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-jx-orange-tint text-jx-orange-ink"><CircleAlert className="h-7 w-7" /></div>
    <h1 className="font-display text-3xl !font-bold text-jx-ink">{isError ? "Job didn’t load" : "Job not found"}</h1>
    <p className="mt-2 max-w-md text-sm text-jx-ink-2">{isError ? "Check your connection, then try opening this job again." : "This job may have been removed or you may not have access."}</p>
    <div className="mt-5 flex gap-3">
      {isError && <Button variant="outline" onClick={() => void refetch()} disabled={isFetching} className="min-h-11 rounded-full border-2 border-jx-ink px-5">{isFetching ? "Trying again…" : "Retry"}</Button>}
      <Button onClick={() => setLocation("/jobs")} className="min-h-11 rounded-full bg-jx-green px-5 text-white hover:bg-jx-green-hover">Back to jobs</Button>
    </div>
  </main>;

  const invoices = job.invoices ?? [];
  const allChangeOrders = invoices.flatMap((invoice) => invoice.lineItems.filter((item) => item.isChangeOrder).map((item) => ({ ...item, invoice })));
  const totalInvoiced = invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const totalPaid = invoices.reduce((sum, invoice) => sum + Number(invoice.amountPaid || 0), 0);
  const outstanding = Number(job.outstandingBalance || 0);
  const totalChanges = allChangeOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0);
  const pricedItems = (lineItems ?? []).filter((item) => !item.isChangeOrder);
  const lineItemTotal = pricedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const progress = job.status === "completed" ? 100 : null;
  const refs = (job.referenceCodes as { label: string; code: string }[] | null | undefined) ?? [];
  const referenceCodes = refs.filter((item) => item.code?.trim());
  const materialRows = materials ?? [];
  const invoiceForChangeOrder = invoices.find((invoice) => invoice.id === changeOrderInvoiceId);

  return <>
    <Dialog open={editOpen} onOpenChange={setEditOpen}>
      <DialogContent className="max-w-xl !flex max-h-[90dvh] flex-col overflow-hidden rounded-3xl">
        <DialogHeader className="shrink-0"><DialogTitle className="font-display text-2xl !font-bold">Edit job</DialogTitle></DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1"><JobForm job={job} onSuccess={() => {}} onClose={() => setEditOpen(false)} /></div>
      </DialogContent>
    </Dialog>
    <AlertDialog open={!!deleteDocId} onOpenChange={(open) => { if (!open) setDeleteDocId(null); }}>
      <AlertDialogContent className="rounded-3xl">
        <AlertDialogHeader><AlertDialogTitle className="font-display text-2xl !font-bold">Delete document?</AlertDialogTitle>
          <AlertDialogDescription>This will permanently delete the file and cannot be undone.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
          <AlertDialogAction className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteDocId && deleteDocMutation.mutate(deleteDocId)} data-testid="button-confirm-delete-document">
            {deleteDocMutation.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={!!deleteInvoiceId} onOpenChange={(open) => { if (!open) setDeleteInvoiceId(null); }}>
      <AlertDialogContent className="rounded-3xl">
        <AlertDialogHeader><AlertDialogTitle className="font-display text-2xl !font-bold">Delete invoice?</AlertDialogTitle>
          <AlertDialogDescription>This will permanently delete the invoice and all its line items. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
          <AlertDialogAction className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteInvoiceId && deleteInvoiceMutation.mutate(deleteInvoiceId)} data-testid="button-confirm-delete-invoice">
            {deleteInvoiceMutation.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={!!changeOrderInvoiceId} onOpenChange={(open) => { if (!open) setChangeOrderInvoiceId(null); }}>
      <AlertDialogContent className="rounded-3xl">
        <AlertDialogHeader><AlertDialogTitle className="font-display text-2xl !font-bold">Add a change order</AlertDialogTitle>
          <AlertDialogDescription>Change orders are added from an existing invoice. Choose the invoice to continue.</AlertDialogDescription></AlertDialogHeader>
        <div className="space-y-2 py-1">
          {invoices.map((invoice) => <button key={invoice.id} type="button" onClick={() => setChangeOrderInvoiceId(invoice.id)} className={`flex min-h-14 w-full items-center justify-between rounded-2xl border-2 px-4 text-left transition-colors hover:border-jx-green ${changeOrderInvoiceId === invoice.id ? "border-jx-green bg-jx-green-tint" : "border-jx-line bg-card"}`}>
            <span><span className="block font-mono text-sm font-semibold">{invoice.invoiceNumber}</span><span className="text-xs text-jx-ink-2">{money(invoice.total)} · {invoice.status}</span></span>
            {invoiceForChangeOrder?.id === invoice.id ? <Check className="h-4 w-4 text-jx-green-ink" /> : <ArrowRight className="h-4 w-4 text-jx-ink-3" />}
          </button>)}
        </div>
        <AlertDialogFooter><AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!invoiceForChangeOrder} className="rounded-full bg-jx-green text-white hover:bg-jx-green-hover" onClick={(event) => {
            event.preventDefault();
            if (invoiceForChangeOrder) setLocation(`/invoices/${invoiceForChangeOrder.id}`);
          }}>Open invoice</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <main className="min-h-[100dvh] px-4 pb-12 pt-6 sm:px-7 sm:pt-8 xl:px-10">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/jobs" className="inline-flex min-h-10 items-center gap-2 rounded-full border-2 border-jx-ink-3 bg-card px-4 text-sm font-semibold text-jx-ink transition-colors hover:border-jx-green hover:text-jx-green-ink" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" /> All jobs
          </Link>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)} className="min-h-11 rounded-full border-2 border-jx-ink px-5 font-semibold" data-testid="button-edit-job">Edit job</Button>
            <Button asChild className="min-h-11 rounded-full bg-jx-green px-5 font-bold tracking-[.04em] text-white hover:bg-jx-green-hover" data-testid="button-create-invoice-for-job">
              <Link href={`/invoices/new?jobId=${job.id}`}><Plus className="mr-2 h-4 w-4" />Invoice this job</Link>
            </Button>
          </div>
        </div>

        <section className="grid gap-5 lg:grid-cols-[1.55fr_.9fr]" aria-label="Job overview">
          <div className="relative flex min-h-[380px] flex-col justify-between overflow-hidden rounded-3xl bg-jx-green p-6 text-white sm:p-8 lg:p-9">
            <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full border border-white/10" />
            <div className="pointer-events-none absolute -right-6 -top-10 h-48 w-48 rounded-full border border-white/10" />
            <div className="relative">
              <div className="flex flex-wrap items-center gap-2.5">
                <JobStatusBadge status={job.status} showIcon={false} />
                <span className="text-sm font-medium text-white/85">{job.client?.name || "Client not assigned"}</span>
              </div>
              <h1 className="mt-5 max-w-3xl font-display text-[38px] !font-bold leading-[.99] tracking-[-.05em] text-white sm:text-[52px]" data-testid="text-job-title">{job.title}</h1>
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/85">
                {job.address && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 shrink-0" />{job.address}</span>}
                {(job.startDate || job.endDate) && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 shrink-0" />{dateRange(job)}</span>}
                {job.squareFootage && <span className="inline-flex items-center gap-1.5"><Ruler className="h-4 w-4 shrink-0" />{Number(job.squareFootage).toLocaleString()} sq ft</span>}
              </div>
            </div>
            <div className="relative mt-8">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
                <div className="min-w-0 rounded-2xl bg-white/[.12] p-3 sm:p-4"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-white/70 sm:text-xs">Estimate</p><p className="mt-1 break-all font-mono text-lg font-semibold tabular-nums">{money(job.estimatedTotal)}</p></div>
                <div className="min-w-0 rounded-2xl bg-white/[.12] p-3 sm:p-4"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-white/70 sm:text-xs">Invoiced</p><p className="mt-1 break-all font-mono text-lg font-semibold tabular-nums">{money(totalInvoiced)}</p></div>
                <div className="min-w-0 rounded-2xl bg-white/[.12] p-3 sm:p-4"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-white/70 sm:text-xs">Complete</p>
                  <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{progress === null ? "Not tracked" : `${progress}%`}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <Button asChild className="min-h-11 rounded-full bg-white px-5 font-bold text-jx-green-ink hover:bg-white/90">
                  <Link href={`/invoices/new?jobId=${job.id}`}><FileText className="mr-2 h-4 w-4" />Invoice this job</Link>
                </Button>
                <Button variant="outline" onClick={() => {
                  if (invoices.length === 0) {
                    toast({ title: "Invoice required", description: "Create an invoice for this job before adding a change order." });
                  } else if (invoices.length === 1) {
                    setLocation(`/invoices/${invoices[0].id}`);
                  } else {
                    setChangeOrderInvoiceId("choose");
                  }
                }} className="min-h-11 rounded-full border-2 border-white/70 bg-transparent px-5 font-semibold text-white hover:bg-white/10 hover:text-white">
                  <Plus className="mr-2 h-4 w-4" />Add change order
                </Button>
              </div>
            </div>
          </div>
          <SitePhoto jobId={job.id} title={job.title} documents={documents} loading={docsLoading} />
        </section>

        <section className="grid items-start gap-5 lg:grid-cols-[1.7fr_minmax(300px,1fr)]">
          <Card className="overflow-hidden rounded-3xl border-jx-line bg-jx-surface shadow-none" data-testid="job-pricing">
            <CardHeader className="flex flex-wrap flex-row items-center justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
              <div><SectionTitle count={pricedItems.length}>Pricing</SectionTitle><p className="mt-1 text-sm text-jx-ink-2">Job line items · amounts from the current estimate</p></div>
              <Button asChild variant="outline" className="min-h-10 rounded-full border-2 border-jx-ink px-4 font-semibold">
                <Link href={`/jobs/${job.id}/line-items`}>Manage pricing <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="px-4 pb-4 sm:px-6">
              {pricingLoading ? <div className="space-y-2">{[0, 1, 2].map((row) => <Skeleton key={row} className="h-14 rounded-xl" />)}</div> :
                pricingError ? <div className="rounded-2xl bg-card p-5 text-sm text-jx-ink-2"><p>Pricing details couldn’t be loaded.</p><Button variant="ghost" className="mt-1 h-auto p-0 text-jx-green-ink underline underline-offset-4" onClick={() => void queryClient.invalidateQueries({ queryKey: ["/api/jobs", id, "line-items"] })}>Try again</Button></div> :
                pricedItems.length === 0 ? <div className="rounded-2xl bg-card px-5 py-8 text-center">
                  <Ruler className="mx-auto h-7 w-7 text-jx-green-ink" /><p className="mt-2 font-semibold text-jx-ink">No pricing added yet</p>
                  <p className="mt-1 text-sm text-jx-ink-2">Add the job’s real line items to see the estimate breakdown here.</p>
                  <Button asChild className="mt-4 min-h-10 rounded-full bg-jx-green px-4 font-semibold text-white hover:bg-jx-green-hover"><Link href={`/jobs/${job.id}/line-items`}>Add line items</Link></Button>
                </div> : <div className="space-y-2">
                  <div className="hidden grid-cols-[minmax(0,1fr)_62px_64px_90px_100px] gap-3 px-3 pb-1 text-[10px] font-bold uppercase tracking-[.08em] text-jx-ink-3 sm:grid">
                    <span>Description</span><span className="text-right">Qty</span><span>Unit</span><span className="text-right">Rate</span><span className="text-right">Amount</span>
                  </div>
                  {pricedItems.map((item) => <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl bg-card px-3 py-3 transition-colors hover:bg-card/80 sm:grid-cols-[minmax(0,1fr)_62px_64px_90px_100px] sm:gap-3" data-testid={`job-line-item-${item.id}`}>
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-jx-ink">{item.description}</p><p className="mt-0.5 text-xs text-jx-ink-2">{item.section || item.category.replaceAll("_", " ")}</p></div>
                    <span className="hidden text-right font-mono text-xs tabular-nums text-jx-ink-2 sm:block">{Number(item.quantity)}</span>
                    <span className="hidden truncate text-xs text-jx-ink-2 sm:block">{item.unit}</span>
                    <span className="hidden text-right font-mono text-xs tabular-nums text-jx-ink-2 sm:block">{money(item.rate)}</span>
                    <span className="text-right font-mono text-sm font-medium tabular-nums text-jx-ink">{money(item.amount)}</span>
                    <span className="col-span-2 -mt-1 text-xs text-jx-ink-3 sm:hidden">{Number(item.quantity)} {item.unit} · {money(item.rate)} / unit</span>
                  </div>)}
                  <div className="flex items-center justify-between border-t-2 border-jx-line px-3 pt-3">
                    <span className="text-sm font-bold text-jx-ink">Job total</span><span className="font-mono text-lg font-semibold tabular-nums text-jx-ink" data-testid="text-job-pricing-total">{money(lineItemTotal)}</span>
                  </div>
                </div>}
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-jx-line pt-4">
                <div><p className="text-[10px] font-bold uppercase tracking-[.07em] text-jx-ink-3">Collected</p><p className="mt-1 font-mono text-sm font-medium tabular-nums text-jx-green-ink">{money(totalPaid)}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[.07em] text-jx-ink-3">Outstanding</p><p className={`mt-1 font-mono text-sm font-medium tabular-nums ${outstanding > 0 ? "text-jx-orange-ink" : "text-jx-green-ink"}`}>{money(outstanding)}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[.07em] text-jx-ink-3">Materials</p><p className="mt-1 font-mono text-sm font-medium tabular-nums text-jx-ink" data-testid="text-job-material-total">{money(job.totalMaterialCost)}</p></div>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-5">
            <Card className="rounded-3xl border-jx-line bg-jx-gold-tint shadow-none">
              <CardHeader className="px-5 pb-2 pt-5"><SectionTitle count={job.employees.length}>Crew</SectionTitle><p className="mt-1 text-sm text-jx-ink-2">People assigned to this job</p></CardHeader>
              <CardContent className="px-5 pb-5">
                {job.employees.length === 0 ? <div className="rounded-2xl bg-card/70 px-4 py-4 text-sm text-jx-ink-2">
                  No crew assigned yet. <button type="button" className="font-semibold text-jx-green-ink underline underline-offset-4" onClick={() => setEditOpen(true)}>Assign employees</button>
                </div> : <div className="space-y-2">{job.employees.map((employee) => <div key={employee.id} className="flex items-center gap-3 rounded-2xl bg-card px-3 py-3" data-testid={`employee-card-${employee.id}`}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jx-gold-tint font-display text-sm !font-bold text-jx-gold-ink">{employee.name.split(" ").map((name) => name[0]).join("").slice(0, 2).toUpperCase()}</div>
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-jx-ink">{employee.name}</p>{employee.position && <p className="truncate text-xs text-jx-ink-2">{employee.position}</p>}</div>
                </div>)}</div>}
                <Button variant="outline" onClick={() => setEditOpen(true)} className="mt-3 min-h-10 rounded-full border-2 border-jx-ink px-4 font-semibold">Manage crew</Button>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-jx-line bg-jx-blue-tint shadow-none">
              <CardHeader className="flex flex-row items-center justify-between gap-2 px-5 pb-2 pt-5">
                <div><SectionTitle count={invoices.length}>Invoices</SectionTitle><p className="mt-1 text-sm text-jx-ink-2">{money(totalInvoiced)} billed</p></div>
                <Button asChild size="sm" className="min-h-9 rounded-full bg-jx-green px-4 font-bold text-white hover:bg-jx-green-hover" data-testid="button-add-invoice">
                  <Link href={`/invoices/new?jobId=${job.id}`}><Plus className="mr-1 h-4 w-4" />New</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-2 px-5 pb-5">
                {invoices.length === 0 ? <div className="rounded-2xl bg-card/75 px-4 py-5 text-center">
                  <p className="text-sm font-semibold text-jx-ink">No invoices yet</p><p className="mt-1 text-xs text-jx-ink-2">Create one to bill this job or add change orders.</p>
                </div> : invoices.map((invoice) => <div key={invoice.id} className="flex items-center gap-2 rounded-2xl bg-card px-3 py-3">
                  <Link href={`/invoices/${invoice.id}`} className="min-w-0 flex-1 rounded-lg text-jx-ink hover:text-jx-green-ink" data-testid={`button-view-invoice-${invoice.id}`}>
                    <span className="block truncate font-mono text-sm font-semibold">{invoice.invoiceNumber}</span>
                    <span className="mt-0.5 block text-xs text-jx-ink-2">{formatScheduleDate(invoice.issueDate)} · <span className="font-mono">{money(invoice.total)}</span></span>
                    <span className="mt-1 block text-xs text-jx-ink-2">Due {formatScheduleDate(invoice.dueDate)}</span>
                    <span className="block text-xs text-jx-ink-2">Balance <span className="font-mono">{money(invoice.balance)}</span></span>
                  </Link>
                  <InvoiceStatusBadge status={invoice.status} />
                  <Button variant="ghost" size="icon" aria-label={`Delete invoice ${invoice.invoiceNumber}`} className="h-9 w-9 shrink-0 rounded-full text-jx-ink-3 hover:text-destructive" onClick={() => setDeleteInvoiceId(invoice.id)} data-testid={`button-delete-invoice-${invoice.id}`}><Trash2 className="h-4 w-4" /></Button>
                </div>)}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-jx-line bg-jx-surface shadow-none">
              <CardHeader className="px-5 pb-2 pt-5"><SectionTitle count={materialsError ? undefined : materialRows.length}>Materials</SectionTitle><p className="mt-1 text-sm text-jx-ink-2">Purchased for this job</p></CardHeader>
              <CardContent className="space-y-2 px-5 pb-5">
                {materialsLoading ? [0, 1].map((item) => <Skeleton key={item} className="h-12 rounded-xl" />) :
                  materialsError ? <p role="alert" className="rounded-2xl bg-jx-orange-tint px-4 py-4 text-sm text-jx-orange-ink">Materials couldn’t be loaded. Refresh the page to try again.</p> :
                  materialRows.length === 0 ? <p className="rounded-2xl bg-card px-4 py-4 text-sm text-jx-ink-2">No materials recorded for this job yet.</p> :
                  materialRows.slice(0, 4).map((material) => <div key={material.id} className="flex items-center justify-between gap-3 rounded-2xl bg-card px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2"><Package className="h-4 w-4 shrink-0 text-jx-blue-ink" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{material.name}</p><p className="truncate text-xs text-jx-ink-2">{material.vendor || `${material.quantity} ${material.unit}`}</p></div></div>
                    <span className="shrink-0 font-mono text-xs tabular-nums">{money(material.price)}</span>
                  </div>)}
                {materialRows.length > 4 && <p className="px-2 pt-1 text-xs text-jx-ink-2">+ {materialRows.length - 4} more materials · total {money(job.totalMaterialCost)}</p>}
                <p className="flex justify-between border-t border-jx-line pt-3 text-sm"><span className="font-semibold text-jx-ink-2">Material cost</span><span className="font-mono font-semibold tabular-nums">{money(job.totalMaterialCost)}</span></p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card className="rounded-3xl border-jx-line shadow-none">
            <CardHeader className="px-5 pb-2 pt-5"><SectionTitle>Job details</SectionTitle></CardHeader>
            <CardContent className="grid gap-5 px-5 pb-5 sm:grid-cols-2">
              <div className="space-y-4">
                {job.description && <div><p className="mb-1 text-xs font-bold uppercase tracking-[.08em] text-jx-ink-3">Description</p><p className="whitespace-pre-wrap text-sm leading-relaxed text-jx-ink-2">{job.description}</p></div>}
                {job.address && <div><p className="mb-1 text-xs font-bold uppercase tracking-[.08em] text-jx-ink-3">Site address</p><p className="text-sm text-jx-ink">{job.address}</p></div>}
                {job.squareFootage && <div><p className="mb-1 text-xs font-bold uppercase tracking-[.08em] text-jx-ink-3">Square footage</p><p className="font-mono text-sm">{Number(job.squareFootage).toLocaleString()} sq ft</p></div>}
              </div>
              <div className="space-y-4">
                <div><p className="mb-1 text-xs font-bold uppercase tracking-[.08em] text-jx-ink-3">Schedule</p><p className="text-sm text-jx-ink">{dateRange(job)}</p></div>
                <div><p className="mb-1 text-xs font-bold uppercase tracking-[.08em] text-jx-ink-3">Created</p><p className="text-sm text-jx-ink">{shortDate(job.createdAt)}</p></div>
                <div><p className="mb-1 text-xs font-bold uppercase tracking-[.08em] text-jx-ink-3">Client</p><p className="text-sm text-jx-ink">{job.client?.name || "Client not assigned"}</p></div>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-3xl border-jx-line shadow-none">
            <CardHeader className="px-5 pb-2 pt-5"><SectionTitle count={referenceCodes.length}>Reference codes</SectionTitle></CardHeader>
            <CardContent className="px-5 pb-5">
              {referenceCodes.length === 0 ? <div className="rounded-2xl bg-jx-surface px-4 py-5 text-sm text-jx-ink-2">No reference codes added to this job.</div> :
                <div className="divide-y divide-jx-line">{referenceCodes.map((reference, index) => <div key={`${reference.label}-${index}`} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0" data-testid={`ref-code-${index}`}>
                  <div className="min-w-0"><p className="truncate text-xs text-jx-ink-2">{reference.label}</p><p className="truncate font-mono text-sm font-semibold tracking-wide text-jx-ink" data-testid={`ref-code-value-${index}`}>{reference.code}</p></div>
                  <Button variant="ghost" size="sm" className="min-h-9 shrink-0 rounded-full px-3 text-jx-ink-2 hover:bg-jx-green-tint hover:text-jx-green-ink" data-testid={`button-copy-ref-code-${index}`} onClick={() => {
                    navigator.clipboard.writeText(reference.code).then(() => {
                      setCopiedIndex(index); window.setTimeout(() => setCopiedIndex(null), 2000);
                    }).catch(() => toast({ title: "Copy failed", description: "Could not access clipboard. Please copy manually.", variant: "destructive" }));
                  }}>{copiedIndex === index ? <Check className="mr-1 h-4 w-4" /> : <Clipboard className="mr-1 h-4 w-4" />}{copiedIndex === index ? "Copied" : "Copy"}</Button>
                </div>)}</div>}
            </CardContent>
          </Card>
        </section>

        <Card className="rounded-3xl border-jx-line shadow-none">
          <CardHeader className="flex flex-row items-center justify-between gap-3 px-5 pb-3 pt-5">
            <div><SectionTitle count={allChangeOrders.length}>Change orders</SectionTitle><p className="mt-1 text-sm text-jx-ink-2">Scope additions recorded on job invoices</p></div>
            {invoices.length > 0 && <Button onClick={() => invoices.length === 1 ? setLocation(`/invoices/${invoices[0].id}`) : setChangeOrderInvoiceId("choose")} variant="outline" className="min-h-10 rounded-full border-2 border-jx-ink px-4 font-semibold"><Plus className="mr-1.5 h-4 w-4" />Add change order</Button>}
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {allChangeOrders.length === 0 ? <div className="rounded-2xl bg-jx-orange-tint px-5 py-6 text-center">
              <CircleAlert className="mx-auto h-6 w-6 text-jx-orange-ink" /><p className="mt-2 font-semibold text-jx-ink">No change orders yet</p>
              <p className="mx-auto mt-1 max-w-lg text-sm text-jx-ink-2">{invoices.length ? "Open an invoice to record a change in scope. Change orders must be attached to an invoice." : "Create an invoice first. Change orders are recorded on an existing invoice."}</p>
            {invoices.length > 1 && <Button onClick={() => setChangeOrderInvoiceId("choose")} className="mt-4 min-h-10 rounded-full bg-jx-green px-4 font-semibold text-white hover:bg-jx-green-hover">Choose an invoice</Button>}
            </div> : <div className="space-y-2">
              {allChangeOrders.map((order) => <div key={order.id} className="grid gap-3 rounded-2xl bg-jx-orange-tint/70 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_150px_120px] sm:items-center">
                <div><p className="font-semibold text-jx-ink">{order.description}</p>{order.changeOrderReason && <p className="mt-0.5 text-xs italic text-jx-ink-2">{order.changeOrderReason}</p>}</div>
                <Link href={`/invoices/${order.invoice.id}`} className="font-mono text-xs text-jx-ink-2 hover:text-jx-green-ink">{order.invoice.invoiceNumber} <span className="font-sans">· {order.category.replaceAll("_", " ")}</span></Link>
                <span className="font-mono text-sm font-semibold tabular-nums text-jx-orange-ink sm:text-right">+{money(order.amount)}</span>
              </div>)}
              <div className="flex justify-end gap-2 pt-2 text-sm text-jx-ink-2">Total change order value <span className="font-mono font-semibold text-jx-orange-ink">+{money(totalChanges)}</span></div>
            </div>}
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-jx-line shadow-none">
          <CardHeader className="flex flex-wrap flex-row items-center justify-between gap-3 px-5 pb-3 pt-5">
            <div><SectionTitle count={documents?.length ?? 0}>Plan documents</SectionTitle><p className="mt-1 text-sm text-jx-ink-2">Plans, permits, specs and site photos</p></div>
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="min-h-10 rounded-full bg-jx-green px-4 font-bold text-white hover:bg-jx-green-hover" data-testid="button-upload-document"><Upload className="mr-1.5 h-4 w-4" />{uploading ? "Uploading…" : "Upload file"}</Button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} data-testid="input-document-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.txt,.csv" />
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {docsLoading ? <div className="space-y-2">{[0, 1].map((item) => <Skeleton key={item} className="h-14 rounded-xl" />)}</div> :
              docsError ? <div className="rounded-2xl bg-jx-orange-tint px-4 py-4 text-sm text-jx-orange-ink">Documents couldn’t be loaded. Refresh the page to try again.</div> :
              !documents?.length ? <div className="rounded-2xl bg-jx-surface px-5 py-8 text-center">
                <File className="mx-auto h-7 w-7 text-jx-ink-3" /><p className="mt-2 font-semibold text-jx-ink">No documents uploaded</p><p className="mt-1 text-sm text-jx-ink-2">Add a plan or site photo to keep it with the job.</p>
                <Button variant="outline" size="sm" className="mt-4 min-h-10 rounded-full border-2 border-jx-ink px-4 font-semibold" onClick={() => fileInputRef.current?.click()} disabled={uploading} data-testid="button-upload-first-document"><Upload className="mr-2 h-4 w-4" />Upload document</Button>
              </div> : <div className="space-y-2">{documents.map((doc) => <div key={doc.id} className="flex items-center gap-3 rounded-2xl border border-jx-line bg-card px-3 py-3 transition-colors hover:bg-jx-surface" data-testid={`document-row-${doc.id}`}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jx-blue-tint text-jx-blue-ink">{doc.fileType.toLowerCase().startsWith("image/") ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-jx-ink">{doc.fileName}</p><p className="text-xs text-jx-ink-2">{formatBytes(doc.fileSize)} · {shortDate(doc.uploadedAt)}</p></div>
                <Button variant="ghost" size="icon" aria-label={`Download ${doc.fileName}`} className="h-9 w-9 rounded-full text-jx-ink-2 hover:bg-jx-green-tint hover:text-jx-green-ink" onClick={() => handleDownload(doc)} data-testid={`button-download-doc-${doc.id}`}><Download className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label={`Delete ${doc.fileName}`} className="h-9 w-9 rounded-full text-jx-ink-3 hover:bg-jx-orange-tint hover:text-jx-orange-ink" onClick={() => setDeleteDocId(doc.id)} data-testid={`button-delete-doc-${doc.id}`}><Trash2 className="h-4 w-4" /></Button>
              </div>)}</div>}
          </CardContent>
        </Card>
      </div>
    </main>
  </>;
}
