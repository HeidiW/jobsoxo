import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PaintBucket, Loader2, Check, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
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

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const passwordRules = [
  { label: "At least 10 characters", test: (p: string) => p.length >= 10 },
  { label: "Uppercase letter (A–Z)", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter (a–z)", test: (p: string) => /[a-z]/.test(p) },
  { label: "Number (0–9)", test: (p: string) => /[0-9]/.test(p) },
  { label: "Special character (!@#$%…)", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

const setupSchema = z.object({
  username: z.string().min(3, "At least 3 characters"),
  password: z
    .string()
    .min(10, "At least 10 characters")
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[0-9]/, "Must contain a number")
    .regex(/[^A-Za-z0-9]/, "Must contain a special character (e.g. !@#$%)"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type LoginValues = z.infer<typeof loginSchema>;
type SetupValues = z.infer<typeof setupSchema>;

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

export default function Login() {
  const { toast } = useToast();

  const { data: setupStatus, isLoading: checkingSetup } = useQuery<{ needsSetup: boolean }>({
    queryKey: ["/api/auth/setup-status"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });

  const isSetup = setupStatus?.needsSetup === true;

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const setupForm = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { username: "", password: "", confirmPassword: "" },
  });

  const passwordValue = useWatch({ control: setupForm.control, name: "password" });

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

  if (checkingSetup) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
            <h1 className="text-2xl font-semibold tracking-tight">PaintPro</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isSetup ? "Create your account to get started" : "Sign in to your account"}
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          {isSetup ? (
            <Form {...setupForm}>
              <form
                onSubmit={setupForm.handleSubmit((d) => setupMutation.mutate(d))}
                className="space-y-4"
              >
                <FormField
                  control={setupForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="e.g. john"
                          autoComplete="username"
                          data-testid="input-setup-username"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={setupForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder="Create a strong password"
                          autoComplete="new-password"
                          data-testid="input-setup-password"
                        />
                      </FormControl>
                      <PasswordStrength password={passwordValue} />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={setupForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder="Repeat your password"
                          autoComplete="new-password"
                          data-testid="input-setup-confirm"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={setupMutation.isPending}
                  data-testid="button-create-account"
                >
                  {setupMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Account
                </Button>
              </form>
            </Form>
          ) : (
            <Form {...loginForm}>
              <form
                onSubmit={loginForm.handleSubmit((d) => loginMutation.mutate(d))}
                className="space-y-4"
              >
                <FormField
                  control={loginForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Your username"
                          autoComplete="username"
                          data-testid="input-login-username"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={loginForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder="Your password"
                          autoComplete="current-password"
                          data-testid="input-login-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loginMutation.isPending}
                  data-testid="button-sign-in"
                >
                  {loginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign In
                </Button>
              </form>
            </Form>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Construction Painting &amp; Decorating
        </p>
      </div>
    </div>
  );
}
