import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PaintBucket, Loader2, Check, X, CheckCircle2, AlertCircle } from "lucide-react";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";

// ─── Password rules (mirrors login.tsx) ──────────────────────────────────────

const passwordRules = [
  { label: "At least 10 characters", test: (p: string) => p.length >= 10 },
  { label: "Uppercase letter (A–Z)", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter (a–z)", test: (p: string) => /[a-z]/.test(p) },
  { label: "Special character (!@#$%…)", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

const resetSchema = z
  .object({
    password: z
      .string()
      .min(10, "At least 10 characters")
      .regex(/[A-Z]/, "Must contain an uppercase letter")
      .regex(/[a-z]/, "Must contain a lowercase letter")
      .regex(/[^A-Za-z0-9]/, "Must contain a special character (e.g. !@#$%)"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ResetValues = z.infer<typeof resetSchema>;

// ─── Password strength bar ────────────────────────────────────────────────────

function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const passed = passwordRules.filter((r) => r.test(password)).length;
  const colors = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-blue-500", "bg-green-500"];
  const barColor = colors[passed - 1] ?? "bg-muted";

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {passwordRules.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
              i < passed ? barColor : "bg-muted"
            }`}
          />
        ))}
      </div>
      <ul className="space-y-1">
        {passwordRules.map((rule) => {
          const ok = rule.test(password);
          return (
            <li
              key={rule.label}
              className={`flex items-center gap-1.5 text-xs ${
                ok ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
              }`}
            >
              {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ResetPassword() {
  const { toast } = useToast();
  const [done, setDone] = useState(false);

  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const { data: tokenData, isLoading: verifying, isError: tokenInvalid } = useQuery<{
    valid: boolean;
    username: string;
  }>({
    queryKey: ["/api/auth/verify-reset-token", token],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!token,
    retry: false,
  });

  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const passwordValue = useWatch({ control: form.control, name: "password" });

  const resetMutation = useMutation({
    mutationFn: async (data: ResetValues) => {
      const res = await apiRequest("POST", "/api/auth/reset-password", {
        token,
        password: data.password,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to reset password");
      }
      return res.json();
    },
    onSuccess: () => {
      setDone(true);
    },
    onError: (err: Error) => {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    },
  });

  // Redirect to login after success
  useEffect(() => {
    if (done) {
      const t = setTimeout(() => {
        window.location.href = "/";
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [done]);

  const isTokenMissing = !token;
  const isTokenBad = !verifying && (tokenInvalid || (tokenData && !tokenData.valid));

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary shadow-md">
            <PaintBucket className="h-7 w-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">JobsOxo</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {done ? "Password updated" : "Set a new password"}
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          {/* Verifying token */}
          {verifying && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Verifying your reset link…</p>
            </div>
          )}

          {/* Invalid / missing token */}
          {!verifying && (isTokenMissing || isTokenBad) && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <div className="space-y-1">
                <p className="font-medium">Link invalid or expired</p>
                <p className="text-sm text-muted-foreground">
                  Reset links are only valid for 1 hour. Please request a new one.
                </p>
              </div>
              <Button
                className="w-full"
                onClick={() => (window.location.href = "/")}
                data-testid="button-back-to-login-invalid"
              >
                Back to sign in
              </Button>
            </div>
          )}

          {/* Success */}
          {done && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <div className="space-y-1">
                <p className="font-medium">Password updated!</p>
                <p className="text-sm text-muted-foreground">
                  You'll be redirected to sign in automatically in a moment.
                </p>
              </div>
              <Button
                className="w-full"
                onClick={() => (window.location.href = "/")}
                data-testid="button-go-to-login"
              >
                Sign in now
              </Button>
            </div>
          )}

          {/* Reset form */}
          {!verifying && !isTokenMissing && !isTokenBad && !done && (
            <div className="space-y-4">
              {tokenData?.username && (
                <p className="text-sm text-muted-foreground">
                  Setting a new password for{" "}
                  <span className="font-medium text-foreground">{tokenData.username}</span>.
                </p>
              )}
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((d) => resetMutation.mutate(d))}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New password</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            placeholder="10+ chars, A-Z, a-z, !@#$%"
                            autoComplete="new-password"
                            data-testid="input-new-password"
                          />
                        </FormControl>
                        <PasswordStrength password={passwordValue} />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm new password</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            placeholder="Repeat your new password"
                            autoComplete="new-password"
                            data-testid="input-confirm-password"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={resetMutation.isPending}
                    data-testid="button-reset-password"
                  >
                    {resetMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Update password
                  </Button>
                </form>
              </Form>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Construction Painting &amp; Decorating
        </p>
      </div>
    </div>
  );
}
