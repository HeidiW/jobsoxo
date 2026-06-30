import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  ArrowLeft,
  Briefcase,
  MapPin,
  Calendar,
  Ruler,
  Users,
  FileText,
  AlertTriangle,
  Edit,
  Plus,
  Trash2,
  Tag,
  Upload,
  Download,
  File,
  Paperclip,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { Job, Client, Invoice, LineItem, Employee, JobDocument } from "@shared/schema";
import JobForm from "@/components/job-form";
import { InvoiceStatusBadge, JobStatusBadge } from "@/components/status-badge";

interface InvoiceWithItems extends Invoice {
  lineItems: LineItem[];
}

interface JobDetail extends Job {
  client: Client;
  invoices: InvoiceWithItems[];
  employees: Employee[];
  outstandingBalance: string;
}


function SkeletonPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex gap-4 items-center">
        <Skeleton className="h-9 w-9 rounded" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-lg" />)}
      </div>
      <Skeleton className="h-48 rounded-lg" />
      <Skeleton className="h-48 rounded-lg" />
    </div>
  );
}

type JobDocumentMeta = Omit<JobDocument, "fileData">;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteInvoiceId, setDeleteInvoiceId] = useState<string | null>(null);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: documents, isLoading: docsLoading } = useQuery<JobDocumentMeta[]>({
    queryKey: ["/api/jobs", id, "documents"],
    enabled: !!id,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/jobs/${id}/documents`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", id, "documents"] });
      toast({ title: "Document uploaded" });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
    onSettled: () => setUploading(false),
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (docId: string) => {
      await apiRequest("DELETE", `/api/job-documents/${docId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", id, "documents"] });
      toast({ title: "Document deleted" });
      setDeleteDocId(null);
    },
    onError: () => {
      toast({ title: "Failed to delete document", variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    uploadMutation.mutate(file);
    e.target.value = "";
  };

  const handleDownload = (doc: JobDocumentMeta) => {
    const a = document.createElement("a");
    a.href = `/api/job-documents/${doc.id}/download`;
    a.download = doc.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      await apiRequest("DELETE", `/api/invoices/${invoiceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", id] });
      toast({ title: "Invoice deleted" });
      setDeleteInvoiceId(null);
    },
    onError: () => {
      toast({ title: "Failed to delete invoice", variant: "destructive" });
    },
  });

  const { data: job, isLoading } = useQuery<JobDetail>({
    queryKey: ["/api/jobs", id],
    enabled: !!id,
  });

  const fmt = (n: string | number | null | undefined) => {
    if (!n) return "$0.00";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(n));
  };

  if (isLoading) return <SkeletonPage />;

  if (!job) {
    return (
      <div className="p-6 max-w-5xl mx-auto text-center py-16">
        <Briefcase className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-xl font-medium">Job not found</h2>
        <Button onClick={() => setLocation("/jobs")} className="mt-4">Back to Jobs</Button>
      </div>
    );
  }

  const allChangeOrders = job.invoices.flatMap((inv) =>
    inv.lineItems.filter((li) => li.isChangeOrder).map((li) => ({ ...li, invoice: inv }))
  );
  const totalInvoiced = job.invoices.reduce((s, inv) => s + Number(inv.total), 0);
  const totalPaid = job.invoices.reduce((s, inv) => s + Number(inv.amountPaid), 0);
  const outstanding = Number(job.outstandingBalance);

  return (
    <>
      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Job</DialogTitle>
          </DialogHeader>
          <JobForm
            job={job}
            onSuccess={() => {}}
            onClose={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <div className="p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/jobs")} data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-semibold">{job.title}</h1>
                <JobStatusBadge status={job.status} showIcon={true} />
              </div>
              <p className="text-muted-foreground mt-1">{job.client?.name}</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setEditOpen(true)} data-testid="button-edit-job">
              <Edit className="h-4 w-4 mr-2" />
              Edit Job
            </Button>
            <Button asChild data-testid="button-create-invoice-for-job">
              <Link href={`/invoices/new?jobId=${job.id}`}>
                <Plus className="h-4 w-4 mr-2" />
                Create Invoice
              </Link>
            </Button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Estimate</p>
              <p className="text-xl font-bold font-mono">{fmt(job.estimatedTotal)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Invoiced</p>
              <p className="text-xl font-bold font-mono">{fmt(totalInvoiced)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Collected</p>
              <p className="text-xl font-bold font-mono text-green-600 dark:text-green-400">{fmt(totalPaid)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Outstanding</p>
              <p className={`text-xl font-bold font-mono ${outstanding > 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                {fmt(outstanding)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Job Details */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              Job Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                {job.description && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                    <p className="text-sm">{job.description}</p>
                  </div>
                )}
                {job.address && (
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Address</p>
                      <p className="text-sm">{job.address}</p>
                    </div>
                  </div>
                )}
                {job.squareFootage && (
                  <div className="flex items-center gap-2">
                    <Ruler className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Square Footage</p>
                      <p className="text-sm font-mono">{Number(job.squareFootage).toLocaleString()} sq ft</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                {(job.startDate || job.endDate) && (
                  <div className="flex items-start gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Schedule</p>
                      {job.startDate && (
                        <p className="text-sm">Start: {format(new Date(job.startDate), "MMMM d, yyyy")}</p>
                      )}
                      {job.endDate && (
                        <p className="text-sm text-muted-foreground">End: {format(new Date(job.endDate), "MMMM d, yyyy")}</p>
                      )}
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Created</p>
                  <p className="text-sm">{format(new Date(job.createdAt), "MMMM d, yyyy")}</p>
                </div>
              </div>
            </div>
            {(() => {
              const codes = (job.referenceCodes as { label: string; code: string }[] | null | undefined) ?? [];
              return codes.length > 0 ? (
                <>
                  <Separator className="mt-4 mb-4" />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5" />
                      Reference Codes
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {codes.map((rc, i) => (
                        <div key={i} className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1" data-testid={`ref-code-${i}`}>
                          <span className="text-xs text-muted-foreground">{rc.label}:</span>
                          <span className="text-xs font-mono font-medium">{rc.code}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null;
            })()}
          </CardContent>
        </Card>

        {/* Assigned Employees */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Assigned Employees
              {job.employees.length > 0 && (
                <Badge variant="secondary">{job.employees.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {job.employees.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                No employees assigned to this job yet.
                <Button variant="ghost" className="pl-1 h-auto text-primary underline-offset-4 hover:underline" onClick={() => setEditOpen(true)}>
                  Assign employees →
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {job.employees.map((emp) => (
                  <div
                    key={emp.id}
                    className="flex items-center gap-3 rounded-md border p-3"
                    data-testid={`employee-card-${emp.id}`}
                  >
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-semibold text-primary">
                        {emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{emp.name}</p>
                      {emp.position && (
                        <p className="text-xs text-muted-foreground truncate">{emp.position}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invoices */}
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Invoices
              {job.invoices.length > 0 && (
                <Badge variant="secondary">{job.invoices.length}</Badge>
              )}
            </CardTitle>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/invoices/new?jobId=${job.id}`} data-testid="button-add-invoice">
                <Plus className="h-4 w-4 mr-1" />
                New Invoice
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {job.invoices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No invoices yet for this job.
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">Due Date</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {job.invoices.map((inv) => (
                      <TableRow key={inv.id} className="hover-elevate">
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono font-medium text-sm">{inv.invoiceNumber}</span>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(inv.issueDate), "MMM d, yyyy")}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <InvoiceStatusBadge status={inv.status} />
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">
                          {format(new Date(inv.dueDate), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">
                          {fmt(inv.total)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          <span className={Number(inv.balance) > 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}>
                            {fmt(inv.balance)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" asChild>
                              <Link href={`/invoices/${inv.id}`} data-testid={`button-view-invoice-${inv.id}`}>
                                View
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteInvoiceId(inv.id)}
                              data-testid={`button-delete-invoice-${inv.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Change Orders — always visible */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <span>Change Orders</span>
              {allChangeOrders.length > 0 && (
                <Badge className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900 dark:text-amber-200">
                  {allChangeOrders.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {allChangeOrders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <AlertTriangle className="h-8 w-8 text-amber-300 dark:text-amber-700 mx-auto mb-3" />
                <p className="font-medium text-foreground">No change orders yet</p>
                <p className="mt-1 max-w-sm mx-auto">
                  Open an invoice for this job and use the "Add Change Order" form to record scope changes.
                </p>
                {job.invoices.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2 justify-center">
                    {job.invoices.map((inv) => (
                      <Button key={inv.id} variant="outline" size="sm" asChild>
                        <Link href={`/invoices/${inv.id}`}>
                          {inv.invoiceNumber} →
                        </Link>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="rounded-md border border-amber-200 dark:border-amber-800">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-amber-50/50 dark:bg-amber-950/20">
                        <TableHead>Description &amp; Reason</TableHead>
                        <TableHead className="hidden md:table-cell">Invoice</TableHead>
                        <TableHead className="hidden md:table-cell">Category</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allChangeOrders.map((co) => (
                        <TableRow key={co.id} className="bg-amber-50/30 dark:bg-amber-950/10">
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-sm">{co.description}</span>
                              {co.changeOrderReason && (
                                <span className="text-xs text-muted-foreground italic">
                                  {co.changeOrderReason}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Button variant="ghost" size="sm" className="h-auto p-0 font-mono text-xs hover:text-foreground" asChild>
                              <Link href={`/invoices/${co.invoice.id}`}>
                                {co.invoice.invoiceNumber}
                              </Link>
                            </Button>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Badge variant="secondary" className="text-xs">
                              {co.category.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium text-amber-700 dark:text-amber-400">
                            +{fmt(co.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-3 flex justify-end">
                  <p className="text-sm text-muted-foreground">
                    Total change order value:{" "}
                    <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">
                      +{fmt(allChangeOrders.reduce((s, co) => s + Number(co.amount), 0))}
                    </span>
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        {/* Documents */}
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Paperclip className="h-5 w-5" />
              Plan Documents
              {documents && documents.length > 0 && (
                <Badge variant="secondary">{documents.length}</Badge>
              )}
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              data-testid="button-upload-document"
            >
              <Upload className="h-4 w-4 mr-1" />
              {uploading ? "Uploading…" : "Upload"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
              data-testid="input-document-file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.txt,.csv"
            />
          </CardHeader>
          <CardContent>
            {docsLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-md border">
                    <Skeleton className="h-8 w-8 rounded" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !documents || documents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <File className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
                <p className="font-medium text-foreground">No documents uploaded</p>
                <p className="mt-1">Upload plans, permits, specs, or any job-related files.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  data-testid="button-upload-first-document"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Document
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 p-3 rounded-md border hover:bg-muted/30 transition-colors"
                    data-testid={`document-row-${doc.id}`}
                  >
                    <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(doc.fileSize)} · {format(new Date(doc.uploadedAt), "MMM d, yyyy")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleDownload(doc)}
                        data-testid={`button-download-doc-${doc.id}`}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteDocId(doc.id)}
                        data-testid={`button-delete-doc-${doc.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!deleteDocId} onOpenChange={(o) => { if (!o) setDeleteDocId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the file and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteDocId && deleteDocMutation.mutate(deleteDocId)}
              data-testid="button-confirm-delete-document"
            >
              {deleteDocMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteInvoiceId} onOpenChange={(o) => { if (!o) setDeleteInvoiceId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the invoice and all its line items. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteInvoiceId && deleteInvoiceMutation.mutate(deleteInvoiceId)}
              data-testid="button-confirm-delete-invoice"
            >
              {deleteInvoiceMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
