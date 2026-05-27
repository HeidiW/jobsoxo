import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PaintBucket, Loader2, Check, X, ArrowLeft, CheckCircle2 } from "lucide-react";
import { SiGoogle, SiApple } from "react-icons/si";

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function YahooIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#6001D2" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 3h5.4l6.6 9.9L18.6 3H24l-9.9 14.7V24h-4.2v-6.3L0 3z" />
    </svg>
  );
}
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
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

// ─── Schemas ──────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const passwordRules = [
  { label: "At least 10 characters", test: (p: string) => p.length >= 10 },
  { label: "Uppercase letter (A–Z)", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter (a–z)", test: (p: string) => /[a-z]/.test(p) },
  { label: "Special character (!@#$%…)", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

const setupSchema = z.object({
  username: z.string().min(3, "At least 3 characters"),
  password: z
    .string()
    .min(10, "At least 10 characters")
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[^A-Za-z0-9]/, "Must contain a special character (e.g. !@#$%)"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

const forgotSchema = z.object({
  username: z.string().min(1, "Username is required"),
});

type LoginValues = z.infer<typeof loginSchema>;
type SetupValues = z.infer<typeof setupSchema>;
type ForgotValues = z.infer<typeof forgotSchema>;

// ─── Password strength ────────────────────────────────────────────────────────

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

// ─── Social provider config ───────────────────────────────────────────────────

const PROVIDERS = [
  {
    key: "google" as const,
    label: "Google",
    icon: SiGoogle as React.ComponentType<{ className?: string }>,
    href: "/api/auth/google",
  },
  {
    key: "microsoft" as const,
    label: "Microsoft",
    icon: MicrosoftIcon,
    href: "/api/auth/microsoft",
  },
  {
    key: "apple" as const,
    label: "Apple",
    icon: SiApple as React.ComponentType<{ className?: string }>,
    href: "/api/auth/apple",
  },
  {
    key: "yahoo" as const,
    label: "Yahoo",
    icon: YahooIcon,
    href: "/api/auth/yahoo",
  },
] as const;

type ProviderKey = (typeof PROVIDERS)[number]["key"];

// ─── Main component ───────────────────────────────────────────────────────────

type View = "login" | "setup" | "forgot" | "forgot-sent";

export default function Login() {
  const { toast } = useToast();
  const [view, setView] = useState<View>("login");

  // Show error toast if an OAuth redirect came back with ?oauth_error=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_error")) {
      toast({
        title: "Sign-in failed",
        description: "We couldn't sign you in with that provider. Please try again.",
        variant: "destructive",
      });
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { data: setupStatus, isLoading: checkingSetup } = useQuery<{ needsSetup: boolean }>({
    queryKey: ["/api/auth/setup-status"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });

  const { data: enabledProviders } = useQuery<Record<ProviderKey, boolean>>({
    queryKey: ["/api/auth/providers"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });

  const activeProviders = PROVIDERS.filter((p) => enabledProviders?.[p.key]);

  const isSetup = setupStatus?.needsSetup === true;

  // ── Forms ──────────────────────────────────────────────────────────────────

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const setupForm = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { username: "", password: "", confirmPassword: "" },
  });

  const forgotForm = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { username: "" },
  });

  const passwordValue = useWatch({ control: setupForm.control, name: "password" });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const loginMutation = useMutation({
    mutationFn: async (data: LoginValues) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      return res.json();
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/me"], user);
    },
    onError: (err: Error) => {
      toast({
        title: "Login failed",
        description: err.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const setupMutation = useMutation({
    mutationFn: async (data: SetupValues) => {
      const res = await apiRequest("POST", "/api/auth/register", {
        username: data.username,
        password: data.password,
      });
      return res.json();
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/me"], user);
    },
    onError: (err: Error) => {
      toast({
        title: "Setup failed",
        description: err.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const forgotMutation = useMutation({
    mutationFn: async (data: ForgotValues) => {
      const res = await apiRequest("POST", "/api/auth/forgot-password", data);
      return res.json();
    },
    onSuccess: () => {
      setView("forgot-sent");
    },
    onError: (err: Error) => {
      toast({
        title: "Request failed",
        description: err.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  // ── Loading ────────────────────────────────────────────────────────────────

  if (checkingSetup) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const currentView = isSetup ? "setup" : view;

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
              {currentView === "setup" && "Create your account to get started"}
              {currentView === "login" && "Sign in to your account"}
              {currentView === "forgot" && "Reset your password"}
              {currentView === "forgot-sent" && "Check your email"}
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">

          {/* Setup form */}
          {currentView === "setup" && (
            <>
            <Form {...setupForm}>
              <form onSubmit={setupForm.handleSubmit((d) => setupMutation.mutate(d))} className="space-y-4">
                <FormField control={setupForm.control} name="username" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. john" autoComplete="username" data-testid="input-setup-username" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={setupForm.control} name="password" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input {...field} type="password" placeholder="10+ chars, A-Z, a-z, !@#$%" autoComplete="new-password" data-testid="input-setup-password" />
                    </FormControl>
                    <PasswordStrength password={passwordValue} />
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={setupForm.control} name="confirmPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input {...field} type="password" placeholder="Repeat your password" autoComplete="new-password" data-testid="input-setup-confirm" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={setupMutation.isPending} data-testid="button-create-account">
                  {setupMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Account
                </Button>
              </form>
            </Form>

            {/* Social login on setup screen */}
            {activeProviders.length > 0 && (
              <>
                <div className="relative mt-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  {activeProviders.map((provider) => {
                    const Icon = provider.icon;
                    return (
                      <a
                        key={provider.key}
                        href={provider.href}
                        data-testid={`button-oauth-setup-${provider.key}`}
                        className="flex items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        <Icon className="h-4 w-4 shrink-0" style={{ color: provider.iconColor }} />
                        {provider.label}
                      </a>
                    );
                  })}
                </div>
              </>
            )}
            </>
          )}

          {/* Login form */}
          {currentView === "login" && (
            <div className="space-y-4">
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit((d) => loginMutation.mutate(d))} className="space-y-4">
                  <FormField control={loginForm.control} name="username" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Your username" autoComplete="username" data-testid="input-login-username" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={loginForm.control} name="password" render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Password</FormLabel>
                        <button
                          type="button"
                          onClick={() => setView("forgot")}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          data-testid="link-forgot-password"
                        >
                          Forgot password?
                        </button>
                      </div>
                      <FormControl>
                        <Input {...field} type="password" placeholder="Your password" autoComplete="current-password" data-testid="input-login-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full" disabled={loginMutation.isPending} data-testid="button-sign-in">
                    {loginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Sign In
                  </Button>
                </form>
              </Form>

              {/* Social login — only shown when at least one provider is configured */}
              {activeProviders.length > 0 && (
                <>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {activeProviders.map((provider) => {
                      const Icon = provider.icon;
                      return (
                        <a
                          key={provider.key}
                          href={provider.href}
                          data-testid={`button-oauth-${provider.key}`}
                          className="flex items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          <Icon
                            className="h-4 w-4 shrink-0"
                            style={{ color: provider.iconColor }}
                          />
                          {provider.label}
                        </a>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Forgot password form */}
          {currentView === "forgot" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter your username and we'll send a reset link to your email address on file.
              </p>
              <Form {...forgotForm}>
                <form onSubmit={forgotForm.handleSubmit((d) => forgotMutation.mutate(d))} className="space-y-4">
                  <FormField control={forgotForm.control} name="username" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Your username" autoComplete="username" data-testid="input-forgot-username" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full" disabled={forgotMutation.isPending} data-testid="button-send-reset">
                    {forgotMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Send Reset Link
                  </Button>
                </form>
              </Form>
              <button
                type="button"
                onClick={() => setView("login")}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                data-testid="link-back-to-login"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </button>
            </div>
          )}

          {/* Sent confirmation */}
          {currentView === "forgot-sent" && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
              <p className="text-sm text-muted-foreground">
                If that account exists and has an email on file, a reset link has been sent. Check your inbox — the link expires in 1 hour.
              </p>
              <Button variant="outline" className="w-full" onClick={() => setView("login")} data-testid="button-back-to-login">
                Back to sign in
              </Button>
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
