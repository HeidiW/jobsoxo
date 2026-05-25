import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PaintBucket, Loader2 } from "lucide-react";
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

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const setupSchema = z.object({
  username: z.string().min(3, "At least 3 characters"),
  password: z.string().min(6, "At least 6 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type LoginValues = z.infer<typeof loginSchema>;
type SetupValues = z.infer<typeof setupSchema>;

export default function Login() {
  const { toast } = useToast();

  const { data: setupStatus, isLoading: checkingSetup } = useQuery<{ needsSetup: boolean }>({
    queryKey: ["/api/auth/setup-status"],
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
                          placeholder="At least 6 characters"
                          autoComplete="new-password"
                          data-testid="input-setup-password"
                        />
                      </FormControl>
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
