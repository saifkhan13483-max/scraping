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
  Zap, Loader2, Eye, EyeOff, ArrowRight, CheckCircle2,
  Globe, Shield, BarChart3, Star, Lock, Users,
} from "lucide-react";
import { Link } from "wouter";

// ─── Schemas ──────────────────────────────────────────────────────────────────

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

// ─── Password Input ───────────────────────────────────────────────────────────

function PasswordInput({ field, placeholder, autoComplete, testId, showStrength = false }: {
  field: any; placeholder: string; autoComplete: string; testId: string; showStrength?: boolean;
}) {
  const [show, setShow] = useState(false);

  const getStrength = (val: string) => {
    if (!val) return 0;
    let score = 0;
    if (val.length >= 8) score++;
    if (val.length >= 12) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;
    return score;
  };

  const strength = showStrength ? getStrength(field.value || "") : 0;
  const strengthLabel = ["", "Weak", "Fair", "Good", "Strong", "Very strong"][strength];
  const strengthColor = ["", "bg-red-500", "bg-orange-400", "bg-yellow-400", "bg-emerald-500", "bg-emerald-500"][strength];

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Input
          {...field}
          type={show ? "text" : "password"}
          placeholder={placeholder}
          autoComplete={autoComplete}
          data-testid={testId}
          className="h-11 pr-10 bg-background border-border/70 focus:border-primary transition-all"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-0.5"
          tabIndex={-1}
          data-testid={`${testId}-toggle`}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {showStrength && field.value && (
        <div className="space-y-1">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                  i <= strength ? strengthColor : "bg-border"
                }`}
              />
            ))}
          </div>
          <p className={`text-xs font-medium ${
            strength <= 1 ? "text-red-500" :
            strength === 2 ? "text-orange-500" :
            strength === 3 ? "text-yellow-600" :
            "text-emerald-600"
          }`}>{strengthLabel}</p>
        </div>
      )}
    </div>
  );
}

// ─── Left Panel ───────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: Globe, label: "Distributed workers", desc: "Playwright across multiple machines" },
  { icon: Shield, label: "Fault tolerant", desc: "Auto-recovery for stuck jobs" },
  { icon: BarChart3, label: "Live dashboard", desc: "Real-time job monitoring" },
];

const TESTIMONIAL = {
  quote: "ScraperCloud cut our data pipeline build time in half. The JSON results are clean and ready to use.",
  name: "Alex Chen",
  role: "Data Engineer",
  initials: "AC",
};

function LeftPanel() {
  return (
    <div className="hidden lg:flex lg:w-[44%] xl:w-[42%] flex-col bg-sidebar text-sidebar-foreground relative overflow-hidden shrink-0">
      {/* Background effects */}
      <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-sidebar-primary/12 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[350px] h-[350px] rounded-full bg-sidebar-primary/8 blur-[100px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-sidebar-primary/4 blur-[140px] pointer-events-none" />

      {/* Subtle grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
          `,
          backgroundSize: "48px 48px",
        }}
      />

      {/* Dot accent top-right */}
      <div
        className="absolute top-0 right-0 w-48 h-48 pointer-events-none opacity-20"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.4) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      />

      <div className="relative flex flex-col h-full px-10 py-10">
        {/* Logo */}
        <Link href="/">
          <div className="flex items-center gap-3 w-fit group cursor-pointer">
            <div className="w-9 h-9 rounded-xl bg-sidebar-primary/20 border border-sidebar-primary/30 flex items-center justify-center group-hover:bg-sidebar-primary/30 transition-colors">
              <Zap className="w-[18px] h-[18px] text-sidebar-primary" strokeWidth={2.5} />
            </div>
            <span className="font-bold text-base text-sidebar-foreground tracking-tight">ScraperCloud</span>
          </div>
        </Link>

        {/* Main content */}
        <div className="flex-1 flex flex-col justify-center gap-10">
          {/* Headline */}
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sidebar-primary/12 border border-sidebar-primary/20 mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-sidebar-primary animate-pulse shrink-0" />
              <span className="text-[11px] font-semibold text-sidebar-primary tracking-wide uppercase">Browser automation at scale</span>
            </div>
            <h1 className="text-[2.1rem] xl:text-[2.35rem] font-bold leading-[1.15] text-sidebar-foreground mb-4">
              Web scraping at scale,<br />
              <span className="text-sidebar-primary">without the infra.</span>
            </h1>
            <p className="text-sm text-sidebar-foreground/50 leading-relaxed max-w-[300px]">
              Submit a URL, receive structured JSON. Our distributed worker network handles browser automation and fault tolerance — so you don't have to.
            </p>
          </div>

          {/* Features */}
          <div className="flex flex-col gap-3.5">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-center gap-3.5">
                <div className="w-8 h-8 rounded-lg bg-sidebar-primary/15 border border-sidebar-primary/20 flex items-center justify-center shrink-0">
                  <Icon className="w-3.5 h-3.5 text-sidebar-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-sidebar-foreground leading-none">{label}</p>
                  <p className="text-xs text-sidebar-foreground/40 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "50", unit: "jobs / mo", label: "Free tier" },
              { value: "2m", unit: "auto-heal", label: "Recovery" },
              { value: "100%", unit: "structured", label: "JSON output" },
            ].map(({ value, unit, label }) => (
              <div key={label} className="rounded-xl bg-sidebar-accent/25 border border-sidebar-border/40 p-3 text-center">
                <p className="text-lg font-bold text-sidebar-primary tabular-nums leading-none">{value}</p>
                <p className="text-[10px] text-sidebar-foreground/35 mt-1.5 leading-tight font-medium">{unit}</p>
                <p className="text-[9px] text-sidebar-foreground/25 leading-tight">{label}</p>
              </div>
            ))}
          </div>

          {/* Testimonial */}
          <div className="rounded-2xl bg-sidebar-accent/20 border border-sidebar-border/30 p-4 space-y-3">
            <div className="flex gap-0.5">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-3 h-3 text-amber-400 fill-amber-400" />
              ))}
            </div>
            <p className="text-sm text-sidebar-foreground/65 leading-relaxed italic">
              "{TESTIMONIAL.quote}"
            </p>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-sidebar-primary/30 border border-sidebar-primary/30 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-bold text-sidebar-primary">{TESTIMONIAL.initials}</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-sidebar-foreground">{TESTIMONIAL.name}</p>
                <p className="text-[10px] text-sidebar-foreground/40">{TESTIMONIAL.role}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-sidebar-foreground/25 relative">© 2026 ScraperCloud. All rights reserved.</p>
          <div className="flex items-center gap-1 text-sidebar-foreground/25">
            <Lock className="w-2.5 h-2.5" />
            <span className="text-[10px]">Secure & encrypted</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Auth Page ────────────────────────────────────────────────────────────────

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
        try { return JSON.parse(match[1]).error || fallback; } catch { return match[1] || fallback; }
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
        email: data.email, password: data.password, name: data.name,
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

  const switchTab = (t: "login" | "register") => {
    setTab(t);
    loginForm.clearErrors();
    registerForm.clearErrors();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col lg:flex-row">

      {/* ── Left branding ─────────────────────────────────── */}
      <LeftPanel />

      {/* ── Right form panel ──────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-screen lg:min-h-0 relative px-5 py-10">

        {/* Subtle background pattern */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.025]"
          style={{
            backgroundImage: "radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        {/* Mobile logo */}
        <Link href="/">
          <div className="flex items-center gap-2.5 mb-8 lg:hidden cursor-pointer group">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <Zap className="w-3.5 h-3.5 text-primary" strokeWidth={2.5} />
            </div>
            <span className="font-bold text-sm tracking-tight">ScraperCloud</span>
          </div>
        </Link>

        <div className="relative w-full max-w-[420px]">

          {/* ── Tab switcher (above card) ────────────────────── */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/60 border border-border/50 mb-5">
            {(["login", "register"] as const).map((t) => (
              <button
                key={t}
                onClick={() => switchTab(t)}
                data-testid={`tab-${t}`}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  tab === t
                    ? "bg-card text-foreground shadow-sm border border-border/60"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          {/* ── Form card ───────────────────────────────────── */}
          <div className="bg-card border border-border/60 rounded-2xl shadow-lg overflow-hidden">
            <div className="px-7 pt-7 pb-7">

              {/* Heading */}
              <div className="mb-6">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
                    {tab === "login"
                      ? <Lock className="w-3.5 h-3.5 text-primary" />
                      : <Users className="w-3.5 h-3.5 text-primary" />
                    }
                  </div>
                  <h2 className="text-xl font-bold text-foreground">
                    {tab === "login" ? "Welcome back" : "Get started free"}
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  {tab === "login"
                    ? "Enter your credentials to access your dashboard."
                    : "Create your account — no credit card required."}
                </p>
              </div>

              {/* ── Login Form ─────────────────────────────────── */}
              {tab === "login" && (
                <Form {...loginForm}>
                  <form
                    onSubmit={loginForm.handleSubmit((d) => loginMutation.mutate(d))}
                    className="space-y-4"
                  >
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
                            className="h-11 bg-background border-border/70 focus:border-primary transition-all"
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

                    <div className="pt-1">
                      <Button
                        type="submit"
                        className="w-full h-11 font-semibold gap-2 text-sm"
                        disabled={loginMutation.isPending}
                        data-testid="button-login"
                      >
                        {loginMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>Sign in <ArrowRight className="w-4 h-4" /></>
                        )}
                      </Button>
                    </div>

                    <p className="text-center text-sm text-muted-foreground">
                      No account?{" "}
                      <button
                        type="button"
                        onClick={() => switchTab("register")}
                        className="text-primary font-semibold hover:underline underline-offset-2"
                        data-testid="link-to-register"
                      >
                        Create one free
                      </button>
                    </p>
                  </form>
                </Form>
              )}

              {/* ── Register Form ──────────────────────────────── */}
              {tab === "register" && (
                <Form {...registerForm}>
                  <form
                    onSubmit={registerForm.handleSubmit((d) => registerMutation.mutate(d))}
                    className="space-y-3.5"
                  >
                    <FormField control={registerForm.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-foreground/80">Full name</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Your full name"
                            autoComplete="name"
                            data-testid="input-name"
                            className="h-11 bg-background border-border/70 focus:border-primary transition-all"
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
                            className="h-11 bg-background border-border/70 focus:border-primary transition-all"
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
                            showStrength
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
                    <div className="rounded-xl bg-primary/5 border border-primary/12 px-4 py-3 space-y-2">
                      {[
                        "50 free scraping jobs every month",
                        "No credit card required",
                        "Upgrade or cancel anytime",
                      ].map((item) => (
                        <div key={item} className="flex items-center gap-2.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="text-xs text-muted-foreground">{item}</span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-0.5">
                      <Button
                        type="submit"
                        className="w-full h-11 font-semibold gap-2 text-sm"
                        disabled={registerMutation.isPending}
                        data-testid="button-register"
                      >
                        {registerMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>Create free account <ArrowRight className="w-4 h-4" /></>
                        )}
                      </Button>
                    </div>

                    <p className="text-center text-sm text-muted-foreground">
                      Already have an account?{" "}
                      <button
                        type="button"
                        onClick={() => switchTab("login")}
                        className="text-primary font-semibold hover:underline underline-offset-2"
                        data-testid="link-to-login"
                      >
                        Sign in
                      </button>
                    </p>
                  </form>
                </Form>
              )}
            </div>
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-muted-foreground/55 mt-5 leading-relaxed">
            By continuing, you agree to our{" "}
            <span className="underline underline-offset-2 cursor-pointer hover:text-muted-foreground transition-colors">Terms of Service</span>
            {" and "}
            <span className="underline underline-offset-2 cursor-pointer hover:text-muted-foreground transition-colors">Privacy Policy</span>
          </p>

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-4 mt-4">
            {[
              { icon: Lock, label: "SSL encrypted" },
              { icon: Shield, label: "GDPR compliant" },
              { icon: Users, label: "10k+ developers" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5 text-muted-foreground/40">
                <Icon className="w-3 h-3" />
                <span className="text-[10px] font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
