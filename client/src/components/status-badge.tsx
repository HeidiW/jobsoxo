import { CheckCircle, Clock, DollarSign, FileText, Mail, AlertTriangle, Calendar, Wrench, Ban } from "lucide-react";

const INVOICE_CONFIG: Record<string, { bg: string; fg: string; label: string; icon: React.ElementType }> = {
  draft:   { bg: "#eef0f3", fg: "#6b7686", label: "Draft",   icon: FileText },
  sent:    { bg: "#eef2fe", fg: "#2563eb", label: "Sent",    icon: Mail },
  paid:    { bg: "#e7f7ee", fg: "#15a35a", label: "Paid",    icon: CheckCircle },
  overdue: { bg: "#fdeeec", fg: "#d23b1f", label: "Overdue", icon: Clock },
  partial: { bg: "#fef5e7", fg: "#b6731a", label: "Partial", icon: DollarSign },
};

const JOB_CONFIG: Record<string, { bg: string; fg: string; label: string; icon: React.ElementType }> = {
  quoted:      { bg: "#eef0f3", fg: "#6b7686", label: "Quoted",      icon: FileText },
  scheduled:   { bg: "#eef2fe", fg: "#2563eb", label: "Scheduled",   icon: Calendar },
  in_progress: { bg: "#fef5e7", fg: "#b6731a", label: "In Progress", icon: Wrench },
  completed:   { bg: "#e7f7ee", fg: "#15a35a", label: "Completed",   icon: CheckCircle },
  on_hold:     { bg: "#eef0f3", fg: "#6b7686", label: "On Hold",     icon: Ban },
};

interface StatusBadgeProps {
  status: string;
  showIcon?: boolean;
  className?: string;
}

export function InvoiceStatusBadge({ status, showIcon = true, className = "" }: StatusBadgeProps) {
  const cfg = INVOICE_CONFIG[status] ?? { bg: "#eef0f3", fg: "#6b7686", label: status, icon: FileText };
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}
    >
      {showIcon && <Icon className="h-3 w-3" />}
      {cfg.label}
    </span>
  );
}

export function JobStatusBadge({ status, showIcon = false, className = "" }: StatusBadgeProps) {
  const cfg = JOB_CONFIG[status] ?? { bg: "#eef0f3", fg: "#6b7686", label: status, icon: FileText };
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}
    >
      {showIcon && <Icon className="h-3 w-3" />}
      {cfg.label}
    </span>
  );
}
