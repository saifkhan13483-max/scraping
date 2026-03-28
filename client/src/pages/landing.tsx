import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Zap, CheckCircle2, Globe, Shield, BarChart3, ArrowRight, Code2,
  Menu, X, ChevronDown, ChevronUp, Clock, Cpu, Database, Layers,
  Terminal, MousePointerClick, RefreshCw, Lock
} from "lucide-react";
import { PLAN_CONFIG, type PlanType } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

const plans: PlanType[] = ["free", "pro", "business"];

const features = [
  {
    icon: Globe,
    title: "Distributed Workers",
    desc: "Multiple Playwright workers running in parallel across separate machines, auto-scaling based on queue depth.",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    icon: Shield,
    title: "Fault Tolerant",
    desc: "Automatic job recovery — stuck jobs are detected and re-queued within 2 minutes with zero data loss.",
    color: "text-green-500",
    bg: "bg-green-500/10",
  },
  {
    icon: Database,
    title: "Redis Queue",
    desc: "Atomic job handoff via Redis RPOPLPUSH ensures no job is lost or processed twice, even under heavy load.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    icon: BarChart3,
    title: "Live Dashboard",
    desc: "Monitor pending, processing, completed, and failed jobs in real time with rich charts and filters.",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
  {
    icon: Code2,
    title: "REST API",
    desc: "Submit jobs and retrieve structured JSON results via a clean, well-documented REST API with API key auth.",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
  },
  {
    icon: CheckCircle2,
    title: "Rich Data Extraction",
    desc: "Extract meta tags, headings, full page text, all links, and image URLs from any public web page.",
    color: "text-teal-500",
    bg: "bg-teal-500/10",
  },
];

const steps = [
  {
    step: "01",
    icon: MousePointerClick,
    title: "Submit a URL",
    desc: "Send a POST request to our API with any public URL. Your job is instantly queued in Redis.",
  },
  {
    step: "02",
    icon: Cpu,
    title: "Worker processes it",
    desc: "A distributed Playwright worker picks up the job, launches a headless browser, and navigates to the page.",
  },
  {
    step: "03",
    icon: Layers,
    title: "Data is extracted",
    desc: "Structured JSON data — including meta, headings, links, images, and full text — is extracted and stored.",
  },
  {
    step: "04",
    icon: Terminal,
    title: "Retrieve results",
    desc: "Poll the job status or stream results from our API. Your data is ready in seconds.",
  },
];

const stats = [
  { value: "99.9%", label: "Uptime SLA" },
  { value: "<2s", label: "Avg job time" },
  { value: "10M+", label: "Jobs processed" },
  { value: "2 min", label: "Max recovery time" },
];

const faqs = [
  {
    q: "How does the free plan work?",
    a: "The free plan gives you 50 scraping jobs per month at no cost, forever. No credit card required to get started.",
  },
  {
    q: "Can I scrape JavaScript-rendered pages?",
    a: "Yes. Every job runs a full Playwright browser, so JavaScript-heavy single-page apps are handled just like static pages.",
  },
  {
    q: "How does fault tolerance work?",
    a: "A recovery watchdog runs every 30 seconds. Any job stuck in 'processing' for more than 2 minutes is automatically re-queued.",
  },
  {
    q: "Is there an API I can use to integrate?",
    a: "Absolutely. Pro and Business plans include API key access. You can submit jobs, poll status, and retrieve results — all via REST.",
  },
  {
    q: "What data do I get back?",
    a: "Each completed job returns a structured JSON object with page title, meta description, Open Graph tags, all headings (h1–h6), links, image URLs, and full page text.",
  },
  {
    q: "Can I upgrade or downgrade my plan?",
    a: "Yes. You can change your plan at any time from the subscription page in your dashboard. Changes take effect immediately.",
  },
];

export default function Landing() {
  const { user, isLoading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const handleNavLinkClick = () => setMobileMenuOpen(false);

  const ctaHref = user ? "/dashboard" : "/auth?tab=register";

  return (
    <div className="min-h-screen bg-background">
      {/* ── Navigation ── */}
      <nav className="border-b border-border bg-card/70 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <span className="font-bold text-sm">ScraperCloud</span>
          </div>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors" data-testid="nav-features">Features</a>
            <a href="#how-it-works" className="hover:text-foreground transition-colors" data-testid="nav-how-it-works">How it works</a>
            <a href="#pricing" className="hover:text-foreground transition-colors" data-testid="nav-pricing">Pricing</a>
            <a href="#faq" className="hover:text-foreground transition-colors" data-testid="nav-faq">FAQ</a>
          </div>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-2">
            {!isLoading && (
              user ? (
                <Link href="/dashboard">
                  <Button size="sm" data-testid="link-dashboard">Go to Dashboard</Button>
                </Link>
              ) : (
                <>
                  <Link href="/auth">
                    <Button variant="ghost" size="sm" data-testid="link-login">Sign in</Button>
                  </Link>
                  <Link href="/auth?tab=register">
                    <Button size="sm" data-testid="link-signup">Get started free</Button>
                  </Link>
                </>
              )
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 rounded-md hover:bg-muted transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="button-mobile-menu"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-card px-4 py-4 flex flex-col gap-3">
            <a href="#features" onClick={handleNavLinkClick} className="text-sm text-muted-foreground hover:text-foreground transition-colors py-1" data-testid="mobile-nav-features">Features</a>
            <a href="#how-it-works" onClick={handleNavLinkClick} className="text-sm text-muted-foreground hover:text-foreground transition-colors py-1" data-testid="mobile-nav-how-it-works">How it works</a>
            <a href="#pricing" onClick={handleNavLinkClick} className="text-sm text-muted-foreground hover:text-foreground transition-colors py-1" data-testid="mobile-nav-pricing">Pricing</a>
            <a href="#faq" onClick={handleNavLinkClick} className="text-sm text-muted-foreground hover:text-foreground transition-colors py-1" data-testid="mobile-nav-faq">FAQ</a>
            <div className="pt-2 border-t border-border flex flex-col gap-2">
              {!isLoading && (
                user ? (
                  <Link href="/dashboard" onClick={handleNavLinkClick}>
                    <Button className="w-full" size="sm" data-testid="mobile-link-dashboard">Go to Dashboard</Button>
                  </Link>
                ) : (
                  <>
                    <Link href="/auth" onClick={handleNavLinkClick}>
                      <Button variant="outline" className="w-full" size="sm" data-testid="mobile-link-login">Sign in</Button>
                    </Link>
                    <Link href="/auth?tab=register" onClick={handleNavLinkClick}>
                      <Button className="w-full" size="sm" data-testid="mobile-link-signup">Get started free</Button>
                    </Link>
                  </>
                )
              )}
            </div>
          </div>
        )}
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5 pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/8 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-20 pb-16 sm:pt-28 sm:pb-24 text-center">
          <Badge variant="secondary" className="mb-5 text-xs sm:text-sm" data-testid="badge-hero">
            <span className="w-1.5 h-1.5 rounded-full bg-primary mr-2 animate-pulse inline-block" />
            Distributed Browser Automation
          </Badge>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-foreground mb-6 leading-tight">
            Web scraping at scale,<br />
            <span className="text-primary">without the infrastructure</span>
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
            Submit URLs, get structured JSON data. Our distributed worker network handles
            browser automation, Redis queuing, and fault tolerance — so you don't have to.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-14">
            <Link href={ctaHref}>
              <Button size="lg" className="gap-2 w-full sm:w-auto" data-testid="button-hero-cta">
                Start scraping for free <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <a href="#how-it-works">
              <Button size="lg" variant="outline" className="w-full sm:w-auto" data-testid="button-how-it-works">
                See how it works
              </Button>
            </a>
          </div>

          {/* Code demo card */}
          <div className="max-w-2xl mx-auto rounded-xl border border-border bg-card shadow-lg overflow-hidden text-left" data-testid="card-code-demo">
            <div className="flex items-center gap-1.5 px-4 py-3 bg-muted/50 border-b border-border">
              <span className="w-3 h-3 rounded-full bg-red-400" />
              <span className="w-3 h-3 rounded-full bg-yellow-400" />
              <span className="w-3 h-3 rounded-full bg-green-400" />
              <span className="ml-2 text-xs text-muted-foreground font-mono">REST API · Submit a job</span>
            </div>
            <pre className="p-4 sm:p-5 text-xs sm:text-sm font-mono overflow-x-auto leading-relaxed">
<code><span className="text-muted-foreground"># Submit a scraping job</span>
<span className="text-primary">curl</span> -X POST https://api.scrapercloud.io/api/job \
  -H <span className="text-green-500">"x-api-key: YOUR_API_KEY"</span> \
  -H <span className="text-green-500">"Content-Type: application/json"</span> \
  -d <span className="text-green-500">'&#123;"url": "https://example.com"&#125;'</span>

<span className="text-muted-foreground"># Response</span>
<span className="text-yellow-500">&#123;</span>
  <span className="text-blue-400">"id"</span>: <span className="text-green-500">"job_abc123"</span>,
  <span className="text-blue-400">"status"</span>: <span className="text-green-500">"pending"</span>,
  <span className="text-blue-400">"url"</span>: <span className="text-green-500">"https://example.com"</span>
<span className="text-yellow-500">&#125;</span></code>
            </pre>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="border-y border-border bg-card/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
            {stats.map(({ value, label }) => (
              <div key={label} className="text-center" data-testid={`stat-${label.replace(/\s+/g, "-").toLowerCase()}`}>
                <div className="text-2xl sm:text-3xl font-bold text-foreground">{value}</div>
                <div className="text-sm text-muted-foreground mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-20 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <Badge variant="secondary" className="mb-4 text-xs">Features</Badge>
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Everything you need to scrape at scale</h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-sm sm:text-base">
              Built from the ground up for reliability, scale, and ease of use.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map(({ icon: Icon, title, desc, color, bg }) => (
              <div
                key={title}
                className="p-6 rounded-xl border border-border bg-card hover:shadow-md transition-shadow"
                data-testid={`card-feature-${title.replace(/\s+/g, "-").toLowerCase()}`}
              >
                <div className={`p-2.5 rounded-lg ${bg} w-fit mb-4`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <h3 className="font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="py-20 sm:py-24 bg-card/30 border-y border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <Badge variant="secondary" className="mb-4 text-xs">How it works</Badge>
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">From URL to data in seconds</h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-sm sm:text-base">
              ScraperCloud handles the hard parts. You just submit a URL and collect the results.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map(({ step, icon: Icon, title, desc }, idx) => (
              <div key={step} className="relative" data-testid={`card-step-${step}`}>
                {/* Connector line (hidden on mobile, last item) */}
                {idx < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-6 left-[calc(50%+2rem)] w-[calc(100%-1rem)] h-px bg-border z-0" />
                )}
                <div className="relative z-10 flex flex-col items-center text-center sm:items-start sm:text-left lg:items-center lg:text-center">
                  <div className="relative mb-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <span className="absolute -top-2 -right-2 text-[10px] font-bold text-primary bg-primary/10 rounded-full w-5 h-5 flex items-center justify-center">
                      {idx + 1}
                    </span>
                  </div>
                  <h3 className="font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="py-20 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <Badge variant="secondary" className="mb-4 text-xs">Pricing</Badge>
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Simple, transparent pricing</h2>
            <p className="text-muted-foreground max-w-md mx-auto text-sm sm:text-base">
              Start free. Upgrade when you need more. No hidden fees, no surprises.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {plans.map((planKey) => {
              const plan = PLAN_CONFIG[planKey];
              const isPopular = planKey === "pro";
              return (
                <div
                  key={planKey}
                  className={`relative rounded-xl border flex flex-col p-6 transition-shadow hover:shadow-lg ${
                    isPopular
                      ? "border-primary shadow-md bg-card ring-1 ring-primary/20"
                      : "border-border bg-card"
                  }`}
                  data-testid={`card-plan-${planKey}`}
                >
                  {isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground px-3 text-xs">Most popular</Badge>
                    </div>
                  )}

                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-lg">{plan.label}</h3>
                      {planKey === "free" && <Badge variant="secondary" className="text-xs">No card needed</Badge>}
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold">${plan.price}</span>
                      {plan.price > 0 && <span className="text-muted-foreground text-sm">/month</span>}
                      {plan.price === 0 && <span className="text-muted-foreground text-sm">forever</span>}
                    </div>
                  </div>

                  <ul className="space-y-3 flex-1 mb-6">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Link href={user ? "/subscription" : "/auth?tab=register"}>
                    <Button
                      className="w-full"
                      variant={isPopular ? "default" : "outline"}
                      data-testid={`button-select-plan-${planKey}`}
                    >
                      {planKey === "free" ? "Get started free" : `Start ${plan.label}`}
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>

          {/* Enterprise note */}
          <div className="text-center mt-10 p-6 rounded-xl border border-border bg-card/50 max-w-2xl mx-auto" data-testid="card-enterprise">
            <Lock className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium mb-1">Need more than Business?</p>
            <p className="text-xs text-muted-foreground mb-3">Custom job limits, dedicated infrastructure, and SLA guarantees for enterprise teams.</p>
            <Button variant="outline" size="sm" data-testid="button-contact-enterprise" asChild>
              <a href="mailto:hello@scrapercloud.io">Contact us</a>
            </Button>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="py-20 sm:py-24 bg-card/30 border-y border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-4 text-xs">FAQ</Badge>
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Frequently asked questions</h2>
            <p className="text-muted-foreground text-sm sm:text-base">
              Can't find your answer? <a href="mailto:hello@scrapercloud.io" className="text-primary hover:underline">Email us</a>.
            </p>
          </div>
          <div className="space-y-3">
            {faqs.map(({ q, a }, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-border bg-card overflow-hidden"
                data-testid={`faq-item-${idx}`}
              >
                <button
                  className="w-full flex items-center justify-between px-5 py-4 text-left gap-3 hover:bg-muted/30 transition-colors"
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  data-testid={`faq-toggle-${idx}`}
                  aria-expanded={openFaq === idx}
                >
                  <span className="font-medium text-sm sm:text-base">{q}</span>
                  {openFaq === idx
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  }
                </button>
                {openFaq === idx && (
                  <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border pt-3" data-testid={`faq-answer-${idx}`}>
                    {a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-20 sm:py-28">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <div className="relative rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-purple-500/5 p-10 sm:p-14 overflow-hidden">
            <div className="absolute inset-0 bg-primary/3 pointer-events-none rounded-2xl" />
            <div className="relative">
              <div className="p-3 rounded-xl bg-primary/10 w-fit mx-auto mb-5">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold mb-3">Ready to start scraping?</h2>
              <p className="text-muted-foreground mb-8 text-sm sm:text-base max-w-md mx-auto">
                Join developers who rely on ScraperCloud for fast, reliable web data extraction.
                Your first 50 jobs are completely free.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href={ctaHref}>
                  <Button size="lg" className="gap-2 w-full sm:w-auto" data-testid="button-final-cta">
                    Get started for free <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <a href="#pricing">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto" data-testid="button-final-view-pricing">
                    View pricing
                  </Button>
                </a>
              </div>
              <p className="mt-4 text-xs text-muted-foreground flex items-center justify-center gap-1">
                <Clock className="w-3 h-3" /> No credit card required · Up and running in 2 minutes
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border bg-card/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-10">
            {/* Brand */}
            <div className="col-span-2 sm:col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <Zap className="w-4 h-4 text-primary" />
                </div>
                <span className="font-bold text-sm">ScraperCloud</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Distributed browser automation infrastructure for developers.
              </p>
            </div>

            {/* Product */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Product</p>
              <ul className="space-y-2">
                <li><a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-features">Features</a></li>
                <li><a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-pricing">Pricing</a></li>
                <li><a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-how-it-works">How it works</a></li>
                <li><a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-faq">FAQ</a></li>
              </ul>
            </div>

            {/* Account */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Account</p>
              <ul className="space-y-2">
                <li>
                  <Link href="/auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-signin">
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link href="/auth?tab=register" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-register">
                    Register
                  </Link>
                </li>
                {user && (
                  <>
                    <li>
                      <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-dashboard">
                        Dashboard
                      </Link>
                    </li>
                    <li>
                      <Link href="/subscription" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-subscription">
                        Subscription
                      </Link>
                    </li>
                  </>
                )}
              </ul>
            </div>

            {/* Support */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Support</p>
              <ul className="space-y-2">
                <li>
                  <a href="mailto:hello@scrapercloud.io" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-contact">
                    Contact us
                  </a>
                </li>
                <li>
                  <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-faq-2">
                    FAQ
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-border pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">© 2026 ScraperCloud. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <a href="#" className="text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-privacy">Privacy</a>
              <a href="#" className="text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-terms">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
