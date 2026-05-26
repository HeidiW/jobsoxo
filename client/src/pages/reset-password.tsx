import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PaintBucket, Loader2, Check, X, CheckCircle2, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
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
import { getQueryFn } from "@/lib/queryClient";

const passwordRules = [
  { label: "At least 10 characters", test: (p: string) => p.length >= 10 },
  { label: "Uppercase letter (A–Z)", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter (a–z)", test: (p: string) => /[a-z]/.test(p) },
  { label: "Special character (!@#$%…)", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

const schema = z.object({
  password: z
    .string()
    .min(10, "At least 10 characters")
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[^A-Za-z0-9]/, "Must contain a special character"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type FormValues = z.infer<typeof schema>;

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
            <li key={rule.label} className={`flex items-center gap-1.5 text-xs ${ok ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
              {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  const { data: tokenData, isLoading: verifying, error: tokenError } = useQuery<{ valid: boolean; username: string }>({
    queryKey: ["/api/auth/verify-reset-token", token],
    queryFn: async () => {
      const res = await fetch(`/api/auth/verify-reset-token?token=${encodeURIComponent(token)}`);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Invalid link");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const passwordValue = useWatch({ control: form.control, name: "password" });

  const resetMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const res = await apiRequest("POST", "/api/auth/reset-password", {
        token,
        password: data.password,
      });
      return res.json();
    },
    onError: (err: Error) => {
      toast({
        title: "Reset failed",
        description: err.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h1 className="text-xl font-semibold">Invalid Link</h1>
          <p className="text-sm text-muted-foreground">This reset link is missing required information.</p>
          <Button variant="outline" onClick={() => navigate("/")}>Back to sign in</Button>
        </div>
      </div>
    );
  }

  if (verifying) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tokenError || !tokenData?.valid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h1 className="text-xl font-semibold">Link Expired or Invalid</h1>
          <p className="text-sm text-muted-foreground">
            This password reset link has expired or already been used. Reset links are valid for 1 hour.
          </p>
          <Button variant="outline" onClick={() => navigate("/")}>Back to sign in</Button>
        </div>
      </div>
    );
  }

  if (resetMutation.isSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
          <h1 className="text-xl font-semibold">Password Updated</h1>
          <p className="text-sm text-muted-foreground">
            Your password has been changed. You can now sign in with your new password.
          </p>
          <Button onClick={() => navigate("/")}>Sign in</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary shadow-md">
            <PaintBucket className="h-7 w-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
            <p className="text-sm text-muted-foreground mt-1">
              For account <strong>{tokenData.username}</strong>
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <Form {...form}>
            <form onSubmit={form.handleSubmit((d) => resetMutation.mutate(d))} className="space-y-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
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
                    <FormLabel>Confirm New Password</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder="Repeat your new password"
                        autoComplete="new-password"
                        data-testid="input-confirm-new-password"
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
                {resetMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Set New Password
              </Button>
            </form>
          </Form>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Construction Painting &amp; Decorating
        </p>
      </div>
    </div>
  );
}
