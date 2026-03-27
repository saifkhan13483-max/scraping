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
import { Zap, Loader2, Eye, EyeOff, ArrowRight, CheckCircle2, Globe, Shield, BarChart3 } from "lucide-react";
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
        className="h-11 pr-10 bg-white dark:bg-card border-border/70 focus:border-primary transition-colors"
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

const PERKS = [
  { icon: Globe, label: "Distributed Workers", desc: "Playwright across multiple machines" },
  { icon: Shield, label: "Fault Tolerant", desc: "Auto-recovery for stuck jobs" },
  { icon: BarChart3, label: "Live Dashboard", desc: "Real-time job monitoring" },
];

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
    <div className="min-h-screen bg-background flex flex-col lg:flex-row">

      {/* ── Left branding panel ─────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[420px] xl:w-[460px] flex-col bg-sidebar text-sidebar-foreground relative overflow-hidden shrink-0">
        {/* Radial glow blobs */}
        <div className="absolute -top-40 -left-40 w-[480px] h-[480px] rounded-full bg-sidebar-primary/10 blur-[100px] pointer-events-none" />
        <div className="absolute bottom-10 right-0 w-[320px] h-[320px] rounded-full bg-sidebar-primary/6 blur-[80px] pointer-events-none" />

        {/* Grid overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
            `,
            backgroundSize: "40px 40px",
          }}
        />

        <div className="relative flex flex-col h-full px-10 py-10">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 w-fit group">
            <div className="w-9 h-9 rounded-xl bg-sidebar-primary/20 border border-sidebar-primary/30 flex items-center justify-center group-hover:bg-sidebar-primary/30 transition-colors">
              <Zap className="w-4.5 h-4.5 text-sidebar-primary" strokeWidth={2.5} />
            </div>
            <span className="font-bold text-base text-sidebar-foreground tracking-tight">ScraperCloud</span>
          </Link>

          {/* Center content */}
          <div className="flex-1 flex flex-col justify-center gap-10">
            {/* Headline */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sidebar-primary/10 border border-sidebar-primary/20 mb-5">
                <span className="w-1.5 h-1.5 rounded-full bg-sidebar-primary animate-pulse shrink-0" />
                <span className="text-xs font-medium text-sidebar-primary">Browser automation at scale</span>
              </div>
              <h1 className="text-[2rem] xl:text-[2.25rem] font-bold leading-tight text-sidebar-foreground mb-3">
                Scrape smarter,<br />
                <span className="text-sidebar-primary">not harder.</span>
              </h1>
              <p className="text-sm text-sidebar-foreground/55 leading-relaxed max-w-[280px]">
                Submit a URL, receive structured JSON. Our distributed Playwright network handles the rest.
              </p>
            </div>

            {/* Feature list */}
            <div className="flex flex-col gap-4">
              {PERKS.map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex items-center gap-3.5">
                  <div className="w-9 h-9 rounded-lg bg-sidebar-accent/60 border border-sidebar-border/60 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-sidebar-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-sidebar-foreground leading-none">{label}</p>
                    <p className="text-xs text-sidebar-foreground/45 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { value: "50", unit: "jobs/mo", label: "Free tier" },
                { value: "2m", unit: "recovery", label: "Auto-heal" },
                { value: "100%", unit: "JSON", label: "Output" },
              ].map(({ value, unit, label }) => (
                <div key={label} className="rounded-xl bg-sidebar-accent/30 border border-sidebar-border/40 px-3 py-3 text-center">
                  <p className="text-lg font-bold text-sidebar-primary leading-none">{value}</p>
                  <p className="text-[10px] text-sidebar-foreground/40 mt-1 leading-tight">{unit}<br />{label}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-sidebar-foreground/25 relative">© 2026 ScraperCloud. All rights reserved.</p>
        </div>
      </div>

      {/* ── Right form panel ────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-screen lg:min-h-0 bg-background px-5 py-12">
        {/* Mobile logo */}
        <Link href="/" className="flex items-center gap-2.5 mb-10 lg:hidden group">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-primary" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-sm tracking-tight">ScraperCloud</span>
        </Link>

        <div className="w-full max-w-[400px]">

          {/* Card */}
          <div className="bg-card border border-border/60 rounded-2xl shadow-lg overflow-hidden">

            {/* Tab header */}
            <div className="flex border-b border-border/60">
              {(["login", "register"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  data-testid={`tab-${t}`}
                  className={`
                    flex-1 py-4 text-sm font-semibold transition-all relative
                    ${tab === t
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/80"
                    }
                  `}
                >
                  {t === "login" ? "Sign in" : "Create account"}
                  {tab === t && (
                    <span className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>

            {/* Form body */}
            <div className="px-7 pt-7 pb-8">
              <div className="mb-6">
                <h2 className="text-xl font-bold text-foreground">
                  {tab === "login" ? "Welcome back" : "Get started free"}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {tab === "login"
                    ? "Sign in to access your scraping dashboard"
                    : "Create your account — no credit card required"}
                </p>
              </div>

              {tab === "login" ? (
                <Form {...loginForm}>
                  <form onSubmit={loginForm.handleSubmit((d) => loginMutation.mutate(d))} className="space-y-4">
                    <FormField control={loginForm.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-foreground/80">Email address</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="email"
                            placeholder="you@example.com"
                            autoComplete="email"
                            data-testid="input-email"
                            className="h-11 bg-white dark:bg-card border-border/70 focus:border-primary transition-colors"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={loginForm.control} name="password" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-foreground/80">Password</FormLabel>
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
                      className="w-full h-11 font-semibold gap-2 mt-2"
                      disabled={loginMutation.isPending}
                      data-testid="button-login"
                    >
                      {loginMutation.isPending
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <><span>Sign in</span><ArrowRight className="w-4 h-4" /></>
                      }
                    </Button>

                    <p className="text-center text-sm text-muted-foreground pt-1">
                      No account?{" "}
                      <button
                        type="button"
                        onClick={() => setTab("register")}
                        className="text-primary font-semibold hover:underline"
                      >
                        Create one free
                      </button>
                    </p>
                  </form>
                </Form>
              ) : (
                <Form {...registerForm}>
                  <form onSubmit={registerForm.handleSubmit((d) => registerMutation.mutate(d))} className="space-y-3.5">
                    <FormField control={registerForm.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-foreground/80">Full name</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Your full name"
                            autoComplete="name"
                            data-testid="input-name"
                            className="h-11 bg-white dark:bg-card border-border/70 focus:border-primary transition-colors"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={registerForm.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-foreground/80">Email address</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="email"
                            placeholder="you@example.com"
                            autoComplete="email"
                            data-testid="input-register-email"
                            className="h-11 bg-white dark:bg-card border-border/70 focus:border-primary transition-colors"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={registerForm.control} name="password" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-foreground/80">Password</FormLabel>
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
                        <FormLabel className="text-sm font-medium text-foreground/80">Confirm password</FormLabel>
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

                    {/* Perks */}
                    <div className="flex flex-col gap-1.5 py-1.5 px-3.5 rounded-xl bg-primary/5 border border-primary/10">
                      {["50 free jobs every month", "No credit card required", "Upgrade or cancel anytime"].map((item) => (
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
                      {registerMutation.isPending
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <><span>Create free account</span><ArrowRight className="w-4 h-4" /></>
                      }
                    </Button>

                    <p className="text-center text-sm text-muted-foreground">
                      Already have an account?{" "}
                      <button
                        type="button"
                        onClick={() => setTab("login")}
                        className="text-primary font-semibold hover:underline"
                      >
                        Sign in
                      </button>
                    </p>
                  </form>
                </Form>
              )}
            </div>
          </div>

          {/* Bottom note */}
          <p className="text-center text-xs text-muted-foreground/60 mt-5">
            By continuing, you agree to our{" "}
            <span className="underline underline-offset-2 cursor-pointer hover:text-muted-foreground transition-colors">Terms</span>
            {" & "}
            <span className="underline underline-offset-2 cursor-pointer hover:text-muted-foreground transition-colors">Privacy Policy</span>
          </p>
        </div>
      </div>
    </div>
  );
}
