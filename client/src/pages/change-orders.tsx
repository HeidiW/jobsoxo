import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Search, FileText, Briefcase } from "lucide-react";
import type { LineItem, Invoice, Job, Client } from "@shared/schema";

interface ChangeOrder extends LineItem {
  invoice: Invoice | null;
  job: Job | null;
  client: Client | null;
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <Badge variant="secondary" className="text-xs capitalize">
      {category.replace(/_/g, " ")}
    </Badge>
  );
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => (
        <TableRow key={i}>
          <TableCell><Skeleton className="h-4 w-40" /></TableCell>
          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
          <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default function ChangeOrders() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const { data: changeOrders, isLoading, error } = useQuery<ChangeOrder[]>({
    queryKey: ["/api/change-orders"],
  });

  const fmt = (n: string | number | null | undefined) => {
    if (!n) return "$0.00";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(Number(n));
  };

  const categories = changeOrders
    ? Array.from(new Set(changeOrders.map((co) => co.category)))
    : [];

  const filtered = changeOrders?.filter((co) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      co.description.toLowerCase().includes(q) ||
      co.changeOrderReason?.toLowerCase().includes(q) ||
      co.job?.title?.toLowerCase().includes(q) ||
      co.client?.name?.toLowerCase().includes(q) ||
      co.invoice?.invoiceNumber?.toLowerCase().includes(q);
    const matchesCategory =
      categoryFilter === "all" || co.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const totalValue = filtered?.reduce((s, co) => s + Number(co.amount), 0) ?? 0;

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold flex items-center gap-3">
            <AlertTriangle className="h-7 w-7 text-amber-600 dark:text-amber-400" />
            Change Orders
          </h1>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-destructive font-medium">Failed to load change orders</p>
          <p className="text-muted-foreground text-sm mt-1">Please refresh the page or try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-semibold flex items-center gap-3">
          <AlertTriangle className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          Change Orders
        </h1>
        <p className="text-muted-foreground mt-1">
          Track all scope changes and additions across jobs
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Change Orders</p>
            <p className="text-2xl font-bold" data-testid="stat-total-count">
              {isLoading ? "—" : (changeOrders?.length ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Value</p>
            <p className="text-2xl font-bold font-mono text-amber-700 dark:text-amber-400" data-testid="stat-total-value">
              {isLoading ? "—" : fmt(changeOrders?.reduce((s, co) => s + Number(co.amount), 0))}
            </p>
          </CardContent>
        </Card>
        <Card className="col-span-2 md:col-span-1">
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Filtered Value</p>
            <p className="text-2xl font-bold font-mono" data-testid="stat-filtered-value">
              {isLoading ? "—" : fmt(totalValue)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              All Change Orders
              {filtered && (
                <Badge className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900 dark:text-amber-200 ml-1">
                  {filtered.length}
                </Badge>
              )}
            </CardTitle>
            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search change orders..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-change-orders"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-44" data-testid="select-category-filter">
                  <SelectValue placeholder="Filter by category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!isLoading && (!filtered || filtered.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <AlertTriangle className="h-12 w-12 text-amber-400 mb-4" />
              <h3 className="font-medium text-lg">No change orders found</h3>
              <p className="text-muted-foreground mt-1 text-sm max-w-sm">
                {search || categoryFilter !== "all"
                  ? "Try different search terms or clear the filters."
                  : "Change orders appear here when you add them to invoices on the invoice detail page."}
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-amber-200 dark:border-amber-800">
              <Table>
                <TableHeader>
                  <TableRow className="bg-amber-50/50 dark:bg-amber-950/20">
                    <TableHead>Description</TableHead>
                    <TableHead className="hidden md:table-cell">Client / Job</TableHead>
                    <TableHead className="hidden md:table-cell">Invoice</TableHead>
                    <TableHead className="hidden lg:table-cell">Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <SkeletonRows />
                  ) : (
                    filtered!.map((co) => (
                      <TableRow
                        key={co.id}
                        className="bg-amber-50/20 dark:bg-amber-950/10 hover:bg-amber-50/60 dark:hover:bg-amber-950/30 transition-colors"
                        data-testid={`row-change-order-${co.id}`}
                      >
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-sm">{co.description}</span>
                            {co.changeOrderReason && (
                              <span className="text-xs text-muted-foreground italic">
                                Reason: {co.changeOrderReason}
                              </span>
                            )}
                            {/* Mobile: show client/job inline */}
                            <span className="text-xs text-muted-foreground md:hidden">
                              {co.client?.name}
                              {co.job?.title && ` · ${co.job.title}`}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex flex-col gap-0.5">
                            {co.client && (
                              <span className="text-sm font-medium">{co.client.name}</span>
                            )}
                            {co.job && (
                              <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-muted-foreground justify-start hover:text-foreground" asChild>
                                <Link href={`/jobs/${co.job.id}`} data-testid={`link-job-${co.id}`}>
                                  <Briefcase className="h-3 w-3 mr-1" />
                                  {co.job.title}
                                </Link>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {co.invoice ? (
                            <Button variant="ghost" size="sm" className="h-auto p-0 font-mono text-xs justify-start hover:text-foreground" asChild>
                              <Link href={`/invoices/${co.invoice.id}`} data-testid={`link-invoice-${co.id}`}>
                                <FileText className="h-3 w-3 mr-1" />
                                {co.invoice.invoiceNumber}
                              </Link>
                            </Button>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <CategoryBadge category={co.category} />
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-mono font-semibold text-amber-700 dark:text-amber-400 text-sm">
                            +{fmt(co.amount)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {/* Footer total */}
          {filtered && filtered.length > 0 && (
            <div className="mt-4 flex justify-end">
              <p className="text-sm text-muted-foreground">
                Showing {filtered.length} change order{filtered.length !== 1 ? "s" : ""} ·{" "}
                <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">
                  +{fmt(totalValue)}
                </span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
