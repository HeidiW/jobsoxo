import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Check, X, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Mail, Lock, Ticket, TriangleAlert } from "lucide-react";
import { SiApple } from "react-icons/si";
import { Link } from "wouter";
import "./login.css";

function OwlMark({ watermark = false }: { watermark?: boolean }) {
  return (
    <svg width={watermark ? 520 : 40} height={watermark ? undefined : 40}
      viewBox={watermark ? "0 20 196 112" : "0 0 200 200"} aria-hidden="true"
      className={watermark ? "pointer-events-none absolute -bottom-10 -right-[120px] opacity-[.09]" : "block shrink-0"}>
      {!watermark && <rect width="200" height="200" rx="44" fill="#ECF39E" />}
      <g transform={watermark ? undefined : "translate(21.6 46) scale(0.8)"}>
        <polygon points="2,80 30,60 6,28" fill={watermark ? "#ECF39E" : "#31572C"} />
        <polygon points="194,80 166,60 190,28" fill={watermark ? "#ECF39E" : "#31572C"} />
        <g fill="none" stroke={watermark ? "#ECF39E" : "#31572C"} strokeWidth={watermark ? 13 : 18}>
          <circle cx="36" cy="95" r="29" /><circle cx="160" cy="95" r="29" />
          <path d="M82 80 L114 130 M114 80 L82 130" strokeWidth={watermark ? 12 : 16} />
        </g>
      </g>
    </svg>
  );
}

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

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function YahooIcon({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`${className ?? ""} font-display !font-extrabold leading-none text-[#6001D2]`}>Y!</span>
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
  setupCode: z.string().optional(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

const forgotSchema = z.object({
  username: z.string().min(1, "Username is required"),
});

const signupSchema = z.object({
  username: z.string().min(3, "At least 3 characters"),
  password: z
    .string()
    .min(10, "At least 10 characters")
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[^A-Za-z0-9]/, "Must contain a special character (e.g. !@#$%)"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
  inviteCode: z.string().min(1, "Invite code is required"),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type LoginValues = z.infer<typeof loginSchema>;
type SetupValues = z.infer<typeof setupSchema>;
type SignupValues = z.infer<typeof signupSchema>;
type ForgotValues = z.infer<typeof forgotSchema>;

// ─── Password strength ────────────────────────────────────────────────────────

function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const passed = passwordRules.filter((r) => r.test(password)).length;
  const colors = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-blue-500", "bg-jx-green"];
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
            <li key={rule.label} className={`flex items-center gap-1.5 text-xs ${ok ? "text-jx-green-ink" : "text-muted-foreground"}`}>
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
    icon: GoogleIcon,
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

type View = "login" | "setup" | "signup" | "forgot" | "forgot-sent";

export default function Login() {
  const { toast } = useToast();
  const [view, setView] = useState<View>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Show error toast if an OAuth redirect came back with ?oauth_error=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_error")) {
      toast({
        title: "Sign-in failed",
        description: "We couldn't sign you in with that provider. If you don't have a JobsOxo account yet, ask your admin for an invite.",
        variant: "destructive",
      });
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { data: setupStatus, isLoading: checkingSetup } = useQuery<{ needsSetup: boolean; setupCodeRequired?: boolean }>({
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
  const setupCodeRequired = isSetup && setupStatus?.setupCodeRequired === true;

  // ── Forms ──────────────────────────────────────────────────────────────────

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const setupForm = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { username: "", password: "", confirmPassword: "", setupCode: "" },
  });

  const signupForm = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { username: "", password: "", confirmPassword: "", inviteCode: "" },
  });

  const forgotForm = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { username: "" },
  });

  const passwordValue = useWatch({ control: setupForm.control, name: "password" });
  const signupPasswordValue = useWatch({ control: signupForm.control, name: "password" });

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
      setAuthError(err.message.replace(/^\d+:\s*/, ""));
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
        setupCode: data.setupCode,
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

  const signupMutation = useMutation({
    mutationFn: async (data: SignupValues) => {
      const res = await apiRequest("POST", "/api/auth/signup", {
        username: data.username,
        password: data.password,
        inviteCode: data.inviteCode,
      });
      return res.json();
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/me"], user);
    },
    onError: (err: Error) => {
      toast({
        title: "Sign up failed",
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
      <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6" role="status" aria-label="Loading sign in">
        <div className="w-full max-w-[440px] space-y-6 animate-pulse">
          <div className="h-12 w-3/4 rounded-xl bg-jx-surface" />
          <div className="h-14 rounded-xl bg-jx-surface" />
          <div className="h-14 rounded-xl bg-jx-surface" />
          <div className="h-14 rounded-full bg-jx-green-tint" />
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const currentView = isSetup && view !== "forgot" && view !== "forgot-sent" ? "setup" : view;

  return (
    <div className="login-page">
      <aside className="login-brand">
        <Link href="/" className="flex items-center gap-3 text-white hover:text-white">
          <OwlMark />
          <span className="flex flex-col gap-0.5">
            <span className="font-display text-xl !font-extrabold leading-none !tracking-[-0.03em]">JobsOxo</span>
            <span className="text-[13px] leading-none text-white/70">Construction Painting &amp; Decorating</span>
          </span>
        </Link>
        <div className="login-brand-copy">
          <h1><span className="text-[#ECF39E]">Price it.</span> Run it. Get paid.</h1>
          <p className="max-w-[440px] text-lg leading-normal text-white/80">
            Your jobs, invoices, crew and change orders, all in one place. Pick up right where you left off.
          </p>
          <p className="text-[13px] text-white/60">Built by a contractor, for small construction businesses.</p>
        </div>
        <OwlMark watermark />
      </aside>
      <main className="login-main">
        <div className="flex items-center justify-end gap-2.5 text-sm font-medium text-jx-ink-2">
          {currentView === "login" ? "New to JobsOxo?" : "Already have an account?"}
          <button type="button" onClick={() => setView(currentView === "login" ? "signup" : "login")}
            className="rounded-full border-[1.5px] border-jx-ink px-4 py-[9px] text-[13px] font-semibold text-jx-ink hover:bg-jx-surface">
            {currentView === "login" ? "Create account" : "Sign in"}
          </button>
        </div>
        <div className="login-content">
          <header className="flex flex-col gap-2.5">
            <h2>
              {currentView === "login" && "Welcome back"}
              {currentView === "setup" && "Let’s get started"}
              {currentView === "signup" && "Make it yours"}
              {currentView === "forgot" && "Forgot password?"}
              {currentView === "forgot-sent" && "Check your email"}
            </h2>
            <p className="text-[17px] text-jx-ink-2">
              {currentView === "login" && "Sign in to your account."}
              {currentView === "setup" && "Create your account to get started."}
              {currentView === "signup" && "Create your account with an invite code."}
              {currentView === "forgot" && "Let’s get you back to work."}
              {currentView === "forgot-sent" && "Your next step is in your inbox."}
            </p>
          </header>
        <div>

          {/* Setup form */}
          {currentView === "setup" && (
            <>
            <Form {...setupForm}>
              <form
                onSubmit={setupForm.handleSubmit((d) => {
                  if (setupCodeRequired && !d.setupCode?.trim()) {
                    setupForm.setError("setupCode", { message: "Setup code is required" });
                    return;
                  }
                  setupMutation.mutate(d);
                })}
                className="space-y-4"
              >
                <FormField control={setupForm.control} name="username" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username or Email</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. john or john@example.com" autoComplete="username" data-testid="input-setup-username" />
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
                {setupCodeRequired && (
                  <FormField control={setupForm.control} name="setupCode" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Setup Code</FormLabel>
                      <FormControl>
                        <Input {...field} type="password" placeholder="From your server's SETUP_CODE setting" autoComplete="off" data-testid="input-setup-code" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
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
                        <Icon className="h-4 w-4 shrink-0" />
                        {provider.label}
                      </a>
                    );
                  })}
                </div>
              </>
            )}

            <div className="mt-4 flex flex-col gap-1 text-center">
              <button
                type="button"
                onClick={() => setView("forgot")}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                data-testid="link-setup-forgot-password"
              >
                Forgot your password?
              </button>
              <button
                type="button"
                onClick={() => setView("login")}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                data-testid="link-already-have-account"
              >
                Already have an account? <span className="font-medium">Sign in</span>
              </button>
            </div>
            </>
          )}

          {/* Signup form (invite-based) */}
          {currentView === "signup" && (
            <Form {...signupForm}>
              <form onSubmit={signupForm.handleSubmit((d) => signupMutation.mutate(d))} className="space-y-4">
                <FormField control={signupForm.control} name="username" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Choose a username" autoComplete="username" data-testid="input-signup-username" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={signupForm.control} name="password" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input {...field} type="password" placeholder="10+ chars, A-Z, a-z, !@#$%" autoComplete="new-password" data-testid="input-signup-password" />
                    </FormControl>
                    <PasswordStrength password={signupPasswordValue} />
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={signupForm.control} name="confirmPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input {...field} type="password" placeholder="Repeat your password" autoComplete="new-password" data-testid="input-signup-confirm" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={signupForm.control} name="inviteCode" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invite Code</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="8-character code" autoComplete="off" className="font-mono uppercase tracking-widest" data-testid="input-signup-invite-code" onChange={(e) => field.onChange(e.target.value.toUpperCase())} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={signupMutation.isPending} data-testid="button-create-account-invite">
                  {signupMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Account
                </Button>
                <button type="button" onClick={() => setView("login")} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-back-to-login-from-signup">
                  Already have an account? <span className="font-medium">Sign in</span>
                </button>
              </form>
            </Form>
          )}

          {/* Login form */}
          {currentView === "login" && (
            <div className="space-y-7">
              {authError && (
                <div role="alert" className="flex items-start gap-3 rounded-2xl bg-jx-orange-tint px-4 py-3.5 text-sm font-medium leading-[1.45] text-jx-orange-ink">
                  <TriangleAlert className="mt-px h-[18px] w-[18px] shrink-0" />
                  <span>{authError} Check your details and try again, or{" "}
                    <button type="button" onClick={() => setView("forgot")} className="underline">reset your password</button>.
                  </span>
                </div>
              )}
              <Form {...loginForm}>
                <form noValidate onSubmit={loginForm.handleSubmit((d) => { setAuthError(null); loginMutation.mutate(d); })} className="space-y-4">
                  <FormField control={loginForm.control} name="username" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username or Email</FormLabel>
                      <div className="login-field">
                        <Mail aria-hidden="true" />
                        <FormControl>
                          <Input {...field} placeholder="mike@russopainting.com" autoComplete="username" data-testid="input-login-username"
                            onChange={(e) => { field.onChange(e); setAuthError(null); }} />
                        </FormControl>
                      </div>
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
                          className="text-[13px] font-semibold text-jx-green-ink hover:text-jx-green"
                          data-testid="link-forgot-password"
                        >
                          Forgot password?
                        </button>
                      </div>
                          <div className="login-field">
                            <Lock aria-hidden="true" />
                            <FormControl>
                              <Input {...field} type={showPassword ? "text" : "password"} placeholder="Your password" autoComplete="current-password" data-testid="input-login-password"
                                onChange={(e) => { field.onChange(e); setAuthError(null); }} />
                            </FormControl>
                            <button type="button" className="login-show" aria-label={showPassword ? "Hide password" : "Show password"}
                              aria-pressed={showPassword} onClick={() => setShowPassword((s) => !s)}>
                              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              {showPassword ? "Hide" : "Show"}
                            </button>
                          </div>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full" disabled={loginMutation.isPending} data-testid="button-sign-in">
                    {loginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {loginMutation.isPending ? "SIGNING IN…" : "SIGN IN"}
                    {!loginMutation.isPending && <ArrowRight className="ml-2 h-[18px] w-[18px]" />}
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
                      <span className="bg-background px-3.5 text-xs font-semibold tracking-[.06em] text-jx-ink-3">OR CONTINUE WITH</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {activeProviders.map((provider) => {
                      const Icon = provider.icon;
                      return (
                        <a
                          key={provider.key}
                          href={provider.href}
                          data-testid={`button-oauth-${provider.key}`}
                          className="flex items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {provider.label}
                        </a>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="flex flex-wrap items-center gap-3.5 rounded-[20px] bg-jx-gold-tint px-[18px] py-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card">
                  <Ticket className="h-5 w-5 text-jx-ink" />
                </span>
                <span className="flex min-w-[130px] flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">Have an invite code?</span>
                  <span className="text-[13px] text-jx-ink-2">Use it to set up your company.</span>
                </span>
                <button
                  type="button"
                  onClick={() => setView("signup")}
                  className="whitespace-nowrap rounded-full border-[1.5px] border-jx-ink px-4 py-2.5 text-[13px] font-semibold text-jx-ink hover:bg-card"
                  data-testid="link-signup-with-invite"
                >
                  Create account
                </button>
              </div>
            </div>
          )}

          {/* Forgot password form */}
          {currentView === "forgot" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter your username or email and we'll send a reset link to your email address on file.
              </p>
              <Form {...forgotForm}>
                <form onSubmit={forgotForm.handleSubmit((d) => forgotMutation.mutate(d))} className="space-y-4">
                  <FormField control={forgotForm.control} name="username" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username or Email</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Your username or email" autoComplete="username" data-testid="input-forgot-username" />
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
              <CheckCircle2 className="h-10 w-10 text-jx-green-ink mx-auto" />
              <p className="text-sm text-muted-foreground">
                If that account exists and has an email on file, a reset link has been sent. Check your inbox — the link expires in 1 hour.
              </p>
              <Button variant="outline" className="w-full" onClick={() => setView("login")} data-testid="button-back-to-login">
                Back to sign in
              </Button>
            </div>
          )}

        </div>

        </div>
        <footer className="flex flex-wrap justify-center gap-[18px] text-[13px] text-jx-ink-3">
          <span>© 2026 JobsOxo LLC</span>
          <Link href="/terms" className="text-jx-ink-2 hover:text-jx-ink">Terms</Link>
          <Link href="/privacy" className="text-jx-ink-2 hover:text-jx-ink">Privacy</Link>
        </footer>
      </main>
    </div>
  );
}
