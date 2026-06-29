import { useQuery, useMutation } from "@tanstack/react-query";
import { formatPhone } from "@/lib/formatPhone";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Building2,
  Mail,
  Phone,
  MapPin,
  Receipt,
  Clock,
  Save,
  Users,
  Plus,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  MessageSquare,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import type { Settings, Invite } from "@shared/schema";

const settingsFormSchema = z.object({
  companyName: z.string().optional(),
  companyEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  companyPhone: z.string().optional(),
  companyAddress: z.string().optional(),
  taxRate: z.string().optional(),
  invoicePrefix: z.string().optional(),
  invoiceTerms: z.string().optional(),
  inboxSyncHour: z.coerce.number().int().min(0).max(23).optional(),
});

type SettingsFormValues = z.infer<typeof settingsFormSchema>;

function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function InvitePanel() {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: invites = [], isLoading } = useQuery<Invite[]>({
    queryKey: ["/api/invites"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/invites", { label: label.trim() || undefined });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invites"] });
      setLabel("");
      toast({ title: "Invite code created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create code", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/invites/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invites"] });
      toast({ title: "Invite code removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove code", description: err.message, variant: "destructive" });
    },
  });

  const copyCode = (invite: Invite) => {
    navigator.clipboard.writeText(invite.code);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const unused = invites.filter((i) => !i.usedAt);
  const used = invites.filter((i) => i.usedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Team Access
        </CardTitle>
        <CardDescription>
          Generate single-use invite codes so others can create an account on your JobsOxo site
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Create new invite */}
        <div className="flex gap-2">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. For Mike) — optional"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-testid="input-invite-label"
          />
          <Button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            data-testid="button-create-invite"
            className="shrink-0"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Generate Code
          </Button>
        </div>

        {/* Active (unused) codes */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : unused.length === 0 && used.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No invite codes yet — generate one above to share with your team
          </p>
        ) : (
          <div className="space-y-2">
            {unused.length > 0 && (
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active codes</p>
            )}
            {unused.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between p-3 rounded-md bg-muted/50 gap-3" data-testid={`invite-row-${invite.id}`}>
                <div className="min-w-0">
                  <span className="font-mono text-sm font-semibold tracking-widest">{invite.code}</span>
                  {invite.label && <span className="ml-2 text-xs text-muted-foreground">— {invite.label}</span>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => copyCode(invite)}
                    data-testid={`button-copy-invite-${invite.id}`}
                  >
                    {copiedId === invite.id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => deleteMutation.mutate(invite.id)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-revoke-invite-${invite.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            {used.length > 0 && (
              <>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">Used codes</p>
                {used.map((invite) => (
                  <div key={invite.id} className="flex items-center justify-between p-3 rounded-md opacity-50 gap-3" data-testid={`invite-row-used-${invite.id}`}>
                    <div className="min-w-0">
                      <span className="font-mono text-sm tracking-widest line-through">{invite.code}</span>
                      {invite.label && <span className="ml-2 text-xs text-muted-foreground">— {invite.label}</span>}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">Used</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Each code can only be used once. Share it directly with the person you want to invite.
        </p>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const { data: settings, isLoading } = useQuery<Settings & { nextInboxSync?: string; lastInboxSync?: string | null }>({
    queryKey: ["/api/settings"],
  });

  const [copiedPhone, setCopiedPhone] = useState(false);
  const { data: smsConfig } = useQuery<{ phoneNumber: string | null }>({
    queryKey: ["/api/sms/config"],
  });

  const copyPhone = () => {
    if (smsConfig?.phoneNumber) {
      navigator.clipboard.writeText(smsConfig.phoneNumber);
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
    }
  };

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    values: {
      companyName: settings?.companyName || "",
      companyEmail: settings?.companyEmail || "",
      companyPhone: settings?.companyPhone || "",
      companyAddress: settings?.companyAddress || "",
      taxRate: settings?.taxRate?.toString() || "0",
      invoicePrefix: settings?.invoicePrefix || "INV",
      invoiceTerms: settings?.invoiceTerms || "",
      inboxSyncHour: settings?.inboxSyncHour ?? 8,
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: SettingsFormValues) => {
      const payload = {
        ...data,
        taxRate: parseFloat(data.taxRate || "0"),
        inboxSyncHour: data.inboxSyncHour ?? 8,
      };
      const res = await apiRequest("PATCH", "/api/settings", payload);
      return res.json();
    },
    onSuccess: (data, variables) => {
      const hour = variables.inboxSyncHour ?? 8;
      const nextInboxSync = computeNextSyncTime(hour).toISOString();
      queryClient.setQueryData(["/api/settings"], (old: (Settings & { nextInboxSync?: string }) | undefined) => ({
        ...old,
        ...data,
        nextInboxSync,
      }));
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Settings saved",
        description: "Your company settings have been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const syncNowMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/inbox/sync/all");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Inbox synced",
        description: "The inbox was synced successfully for all connected users.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function computeNextSyncTime(hour: number, fromDate: Date = new Date()): Date {
    const next = new Date(fromDate);
    next.setHours(hour, 0, 0, 0);
    if (next <= fromDate) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  const watchedSyncHour = form.watch("inboxSyncHour");

  const liveNextSync = (() => {
    if (watchedSyncHour === "" || watchedSyncHour === null || watchedSyncHour === undefined) return null;
    const parsed = Number(watchedSyncHour);
    const hour = Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null;
    if (hour === null) return null;
    return computeNextSyncTime(hour, now);
  })();

  const onSubmit = (data: SettingsFormValues) => {
    updateSettingsMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your company information and preferences</p>
        </div>
        <SettingsSkeleton />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your company information and preferences</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Company Information
              </CardTitle>
              <CardDescription>
                This information will appear on your invoices
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="companyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Your Painting Company" {...field} data-testid="input-company-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="companyEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input type="email" placeholder="info@company.com" className="pl-9" {...field} data-testid="input-company-email" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="companyPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input placeholder="(555) 123-4567" className="pl-9" {...field} onChange={e => field.onChange(formatPhone(e.target.value))} data-testid="input-company-phone" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="companyAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Textarea placeholder="123 Main St, City, State 12345" className="pl-9 min-h-20" {...field} data-testid="input-company-address" />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Invoice Settings
              </CardTitle>
              <CardDescription>
                Configure defaults for your invoices
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="invoicePrefix"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Invoice Number Prefix</FormLabel>
                      <FormControl>
                        <Input placeholder="INV" {...field} data-testid="input-invoice-prefix" />
                      </FormControl>
                      <FormDescription>
                        Prefix for invoice numbers (e.g., INV-001)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="taxRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default Tax Rate (%)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="0" {...field} data-testid="input-tax-rate" />
                      </FormControl>
                      <FormDescription>
                        Applied to new invoices by default
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="invoiceTerms"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default Terms & Conditions</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Payment is due within 30 days. Late payments may incur additional fees."
                        className="min-h-24"
                        {...field}
                        data-testid="input-invoice-terms"
                      />
                    </FormControl>
                    <FormDescription>
                      Added to all new invoices
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Payment Reminders
              </CardTitle>
              <CardDescription>
                Automated reminder settings for overdue invoices
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                  <div>
                    <span className="font-medium">First Reminder</span>
                    <p className="text-muted-foreground">7 days after due date</p>
                  </div>
                  <Badge variant="outline">Active</Badge>
                </div>
                <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                  <div>
                    <span className="font-medium">Second Reminder</span>
                    <p className="text-muted-foreground">14 days after due date</p>
                  </div>
                  <Badge variant="outline">Active</Badge>
                </div>
                <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                  <div>
                    <span className="font-medium">Final Notice</span>
                    <p className="text-muted-foreground">30 days after due date</p>
                  </div>
                  <Badge variant="outline">Active</Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                Reminders are sent automatically when invoices become overdue. Configure email settings to enable sending.
              </p>
            </CardContent>
          </Card>

          {user?.isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Inbox Sync Schedule
                </CardTitle>
                <CardDescription>
                  Configure when the daily Gmail inbox sync runs
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="inboxSyncHour"
                  render={({ field }) => (
                    <FormItem className="max-w-xs">
                      <FormLabel>Inbox sync hour (0–23)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={23}
                          step={1}
                          placeholder="8"
                          {...field}
                          data-testid="input-inbox-sync-hour"
                        />
                      </FormControl>
                      <FormDescription>
                        Hour of the day (server local time) when inbox auto-sync runs. Changes apply at the next scheduling cycle — no restart needed.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {liveNextSync && (
                  <p className="text-sm text-muted-foreground" data-testid="text-next-inbox-sync">
                    Next sync:{" "}
                    <span className="font-medium text-foreground">
                      {(() => {
                        const next = liveNextSync;
                        const isToday =
                          next.getFullYear() === now.getFullYear() &&
                          next.getMonth() === now.getMonth() &&
                          next.getDate() === now.getDate();
                        const timeStr = next.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                        return isToday ? `today at ${timeStr}` : `tomorrow at ${timeStr}`;
                      })()}
                    </span>
                  </p>
                )}
                <p className="text-sm text-muted-foreground" data-testid="text-last-inbox-sync">
                  Last synced:{" "}
                  {settings?.lastInboxSync ? (
                    <span className="font-medium text-foreground">
                      {(() => {
                        const last = new Date(settings.lastInboxSync!);
                        const diffMs = now.getTime() - last.getTime();
                        const diffMins = Math.floor(diffMs / 60000);
                        const diffHours = Math.floor(diffMins / 60);
                        if (diffMins < 1) return "just now";
                        if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
                        if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
                        const timeStr = last.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                        const isToday =
                          last.getFullYear() === now.getFullYear() &&
                          last.getMonth() === now.getMonth() &&
                          last.getDate() === now.getDate();
                        return isToday ? `today at ${timeStr}` : last.toLocaleDateString([], { month: "short", day: "numeric" }) + ` at ${timeStr}`;
                      })()}
                    </span>
                  ) : (
                    <span className="font-medium text-muted-foreground">Never</span>
                  )}
                </p>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={syncNowMutation.isPending}
                    onClick={() => syncNowMutation.mutate()}
                    data-testid="button-sync-now"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${syncNowMutation.isPending ? "animate-spin" : ""}`} />
                    {syncNowMutation.isPending ? "Syncing…" : "Sync now"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={updateSettingsMutation.isPending} data-testid="button-save-settings">
              <Save className="h-4 w-4 mr-2" />
              {updateSettingsMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      </Form>

      {/* SMS Time Logging — shown to all users so they can share the number */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            SMS Time Logging
          </CardTitle>
          <CardDescription>
            Employees can text their hours directly to this number — no app or login needed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {smsConfig?.phoneNumber ? (
            <>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-sm tracking-wider"
                  data-testid="text-sms-phone-number"
                >
                  {smsConfig.phoneNumber}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyPhone}
                  title="Copy number"
                  data-testid="button-copy-sms-phone"
                >
                  {copiedPhone ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <div className="rounded-md bg-muted/60 p-3 text-sm space-y-1 text-muted-foreground">
                <p className="font-medium text-foreground">How employees log hours</p>
                <p>Text <code className="rounded bg-background px-1 py-0.5 text-xs font-mono">8</code> for 8 hours today</p>
                <p>Text <code className="rounded bg-background px-1 py-0.5 text-xs font-mono">7.5 painting fence</code> for 7.5 hours with a note</p>
                <p>Text <code className="rounded bg-background px-1 py-0.5 text-xs font-mono">HELP</code> anytime for a reminder</p>
                <p className="pt-1">Each employee's mobile number must be saved in their profile (Payroll → Employees) for the system to recognise them.</p>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground space-y-2" data-testid="text-sms-not-configured">
              <Phone className="mx-auto h-8 w-8 opacity-40" />
              <p className="font-medium">SMS not yet configured</p>
              <p>Add your <code className="rounded bg-muted px-1 text-xs font-mono">TWILIO_ACCOUNT_SID</code>, <code className="rounded bg-muted px-1 text-xs font-mono">TWILIO_AUTH_TOKEN</code>, and <code className="rounded bg-muted px-1 text-xs font-mono">TWILIO_PHONE_NUMBER</code> secrets, then point your Twilio number's incoming-SMS webhook to:</p>
              <code className="block rounded bg-muted px-2 py-1 text-xs font-mono break-all">
                https://your-domain.replit.app/api/sms/inbound
              </code>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Only admins can manage invite codes */}
      {user?.isAdmin && <InvitePanel />}
    </div>
  );
}
