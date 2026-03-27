import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, CheckCircle2, Globe, Shield, BarChart3, ArrowRight, Code2 } from "lucide-react";
import { PLAN_CONFIG, type PlanType } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

const plans: PlanType[] = ["free", "pro", "business"];

export default function Landing() {
  const { user, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <span className="font-semibold text-sm">ScraperCloud</span>
          </div>
          <div className="flex items-center gap-2">
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
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <Badge variant="secondary" className="mb-6">Distributed Browser Automation</Badge>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-6">
          Web scraping at scale,<br />
          <span className="text-primary">without the infrastructure</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10">
          Submit URLs, get structured JSON data. Our distributed worker network handles the browser automation, Redis queuing, and fault tolerance — so you don't have to.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link href="/auth?tab=register">
            <Button size="lg" className="gap-2" data-testid="button-hero-cta">
              Start scraping for free <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <Link href="#pricing">
            <Button size="lg" variant="outline" data-testid="button-view-pricing">View pricing</Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="bg-card/30 border-y border-border py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-12">Everything you need to scrape at scale</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Globe, title: "Distributed Workers", desc: "Multiple Playwright workers running in parallel across separate machines." },
              { icon: Shield, title: "Fault Tolerant", desc: "Automatic job recovery — stuck jobs are detected and re-queued within 2 minutes." },
              { icon: Zap, title: "Redis Queue", desc: "Atomic job handoff via Redis RPOPLPUSH ensures no job is processed twice." },
              { icon: BarChart3, title: "Live Dashboard", desc: "Monitor pending, processing, completed, and failed jobs in real time." },
              { icon: Code2, title: "REST API", desc: "Submit jobs and retrieve structured JSON results via a simple REST API." },
              { icon: CheckCircle2, title: "Rich Data Extraction", desc: "Extract meta tags, headings, text, links, and images from any page." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-5 rounded-xl border border-border bg-card">
                <div className="p-2.5 rounded-lg bg-primary/10 w-fit mb-4">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-1.5">{title}</h3>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-2xl font-bold text-center mb-4">Simple, transparent pricing</h2>
        <p className="text-center text-muted-foreground mb-12">Start free. Upgrade when you need more.</p>
        <div className="grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {plans.map((planKey) => {
            const plan = PLAN_CONFIG[planKey];
            const isPopular = planKey === "pro";
            return (
              <div
                key={planKey}
                className={`relative rounded-xl border p-6 flex flex-col ${isPopular ? "border-primary shadow-lg" : "border-border"} bg-card`}
                data-testid={`card-plan-${planKey}`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground">Most popular</Badge>
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="font-bold text-lg mb-1">{plan.label}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold">${plan.price}</span>
                    {plan.price > 0 && <span className="text-muted-foreground text-sm">/month</span>}
                    {plan.price === 0 && <span className="text-muted-foreground text-sm">forever</span>}
                  </div>
                </div>
                <ul className="space-y-2.5 flex-1 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      {f}
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
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">ScraperCloud</span>
          </div>
          <p className="text-xs text-muted-foreground">© 2026 ScraperCloud. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
