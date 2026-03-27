import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertUserSchema } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, Loader2, Globe, Shield, BarChart3, ArrowRight, Eye, EyeOff, CheckCircle2,
} from "lucide-react";
import { Link } from "wouter";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});
type LoginData = z.infer<typeof loginSchema>;

const registerSchema = insertUserSchema.extend({
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});
type RegisterData = z.infer<typeof registerSchema>;

const FEATURES = [
  { icon: Globe, text: "Distributed Playwright workers across multiple machines" },
  { icon: Shield, text: "Fault-tolerant with automatic job recovery" },
  { icon: BarChart3, text: "Real-time dashboard with live job monitoring" },
];

const STATS = [
  { value: "50", label: "Free jobs/mo" },
  { value: "2min", label: "Recovery time" },
  { value: "100%", label: "JSON output" },
];

function PasswordInput({ field, placeholder, autoComplete, testId }: {
  field: any; placeholder: string; autoComplete: string; testId: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        {...field}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        autoComplete={autoComplete}
        data-testid={testId}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [tab, setTab] = useState<"login" | "register">("login");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "register") setTab("register");
  }, []);

  const loginForm = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<RegisterData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", confirmPassword: "", name: "" },
  });

  function parseApiError(err: unknown, fallback: string): string {
    if (err instanceof Error) {
      const match = err.message.match(/^\d+: (.+)$/);
      if (match) {
        try {
          const body = JSON.parse(match[1]);
          return body.error || fallback;
        } catch {
          return match[1] || fallback;
        }
      }
    }
    return fallback;
  }

  const loginMutation = useMutation({
    mutationFn: async (data: LoginData) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      return res.json();
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/me"], user);
      setLocation("/dashboard");
    },
    onError: (err) => {
      toast({ title: parseApiError(err, "Login failed"), variant: "destructive" });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: RegisterData) => {
      const res = await apiRequest("POST", "/api/auth/register", {
        email: data.email,
        password: data.password,
        name: data.name,
      });
      return res.json();
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/me"], user);
      setLocation("/dashboard");
    },
    onError: (err) => {
      toast({ title: parseApiError(err, "Registration failed"), variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel ─────────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[44%] xl:w-[42%] flex-col bg-sidebar text-sidebar-foreground relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-sidebar-primary/8 blur-3xl" />
          <div className="absolute bottom-0 right-0 w-80 h-80 rounded-full bg-sidebar-primary/6 blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-sidebar-primary/4 blur-3xl" />
        </div>

        {/* Grid overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage: `linear-gradient(hsl(var(--sidebar-foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--sidebar-foreground)) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />

        <div className="relative flex flex-col h-full px-10 py-10">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 w-fit">
            <div className="p-2 rounded-xl bg-sidebar-primary/15 border border-sidebar-primary/20">
              <Zap className="w-5 h-5 text-sidebar-primary" />
            </div>
            <span className="font-bold text-lg text-sidebar-foreground tracking-tight">ScraperCloud</span>
          </Link>

          {/* Main content */}
          <div className="flex-1 flex flex-col justify-center py-12">
            <div className="mb-10">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sidebar-primary/10 border border-sidebar-primary/20 mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-sidebar-primary animate-pulse" />
                <span className="text-xs font-medium text-sidebar-primary">Distributed scraping infrastructure</span>
              </div>
              <h1 className="text-3xl xl:text-4xl font-bold text-sidebar-foreground leading-tight mb-4">
                Scrape smarter,<br />
                <span className="text-sidebar-primary">not harder</span>
              </h1>
              <p className="text-sidebar-foreground/60 text-base leading-relaxed max-w-sm">
                Submit a URL, get structured JSON data. Our worker network handles the browser automation, queueing, and fault tolerance.
              </p>
            </div>

            {/* Features */}
            <div className="space-y-4 mb-10">
              {FEATURES.map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-start gap-3">
                  <div className="p-1.5 rounded-lg bg-sidebar-primary/10 border border-sidebar-primary/15 shrink-0 mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-sidebar-primary" />
                  </div>
                  <p className="text-sm text-sidebar-foreground/70 leading-relaxed">{text}</p>
                </div>
              ))}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              {STATS.map(({ value, label }) => (
                <div key={label} className="rounded-xl bg-sidebar-accent/40 border border-sidebar-border/50 p-3 text-center">
                  <p className="text-xl font-bold text-sidebar-primary">{value}</p>
                  <p className="text-xs text-sidebar-foreground/50 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <p className="text-xs text-sidebar-foreground/30 relative">
            © 2026 ScraperCloud. All rights reserved.
          </p>
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center bg-background px-6 py-10 min-h-screen lg:min-h-0">
        {/* Mobile logo */}
        <Link href="/" className="flex items-center gap-2 mb-8 lg:hidden">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <span className="font-bold text-sm">ScraperCloud</span>
        </Link>

        <div className="w-full max-w-[420px]">
          {/* Tab switcher */}
          <div className="flex gap-0 mb-8 border-b border-border">
            <button
              onClick={() => setTab("login")}
              data-testid="tab-login"
              className={`flex-1 pb-3 text-sm font-semibold transition-all border-b-2 -mb-px ${
                tab === "login"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => setTab("register")}
              data-testid="tab-register"
              className={`flex-1 pb-3 text-sm font-semibold transition-all border-b-2 -mb-px ${
                tab === "register"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Create account
            </button>
          </div>

          {/* Heading */}
          <div className="mb-7">
            <h2 className="text-2xl font-bold text-foreground">
              {tab === "login" ? "Welcome back" : "Get started free"}
            </h2>
            <p className="text-muted-foreground text-sm mt-1.5">
              {tab === "login"
                ? "Enter your credentials to access your dashboard"
                : "Create your account — no credit card required"}
            </p>
          </div>

          {/* Forms */}
          {tab === "login" ? (
            <Form {...loginForm}>
              <form onSubmit={loginForm.handleSubmit((d) => loginMutation.mutate(d))} className="space-y-5">
                <FormField control={loginForm.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Email address</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        data-testid="input-email"
                        className="h-11"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={loginForm.control} name="password" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        field={field}
                        placeholder="Enter your password"
                        autoComplete="current-password"
                        testId="input-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <Button
                  type="submit"
                  className="w-full h-11 font-semibold gap-2"
                  disabled={loginMutation.isPending}
                  data-testid="button-login"
                >
                  {loginMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>Sign in <ArrowRight className="w-4 h-4" /></>
                  )}
                </Button>

                <p className="text-center text-sm text-muted-foreground">
                  Don't have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setTab("register")}
                    className="text-primary font-medium hover:underline"
                  >
                    Create one free
                  </button>
                </p>
              </form>
            </Form>
          ) : (
            <Form {...registerForm}>
              <form onSubmit={registerForm.handleSubmit((d) => registerMutation.mutate(d))} className="space-y-4">
                <FormField control={registerForm.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Full name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Your full name"
                        autoComplete="name"
                        data-testid="input-name"
                        className="h-11"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={registerForm.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Email address</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        data-testid="input-register-email"
                        className="h-11"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={registerForm.control} name="password" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        field={field}
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                        testId="input-register-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={registerForm.control} name="confirmPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Confirm password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        field={field}
                        placeholder="Repeat your password"
                        autoComplete="new-password"
                        testId="input-confirm-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Mini feature list */}
                <div className="flex flex-col gap-1.5 py-1">
                  {["50 free scraping jobs every month", "No credit card required", "Upgrade or cancel anytime"].map((item) => (
                    <div key={item} className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="text-xs text-muted-foreground">{item}</span>
                    </div>
                  ))}
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 font-semibold gap-2"
                  disabled={registerMutation.isPending}
                  data-testid="button-register"
                >
                  {registerMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>Create free account <ArrowRight className="w-4 h-4" /></>
                  )}
                </Button>

                <p className="text-center text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setTab("login")}
                    className="text-primary font-medium hover:underline"
                  >
                    Sign in
                  </button>
                </p>
              </form>
            </Form>
          )}
        </div>
      </div>
    </div>
  );
}
