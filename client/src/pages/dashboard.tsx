import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertJobSchema } from "@shared/schema";
import type { Job, JobStatus, InsertJob, Subscription } from "@shared/schema";
import { PLAN_CONFIG } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import AppLayout from "@/components/app-layout";
import { Link } from "wouter";
import {
  Globe, Clock, CheckCircle2, XCircle, Loader2, RefreshCw, Trash2, Plus,
  Terminal, AlertCircle, Copy, Zap, ArrowUpRight, Send, ListFilter,
  RotateCcw, Inbox, TrendingUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<JobStatus, {
  label: string;
  textClass: string;
  badgeClass: string;
  dotClass: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = {
  pending: {
    label: "Pending",
    textClass: "text-amber-600 dark:text-amber-400",
    badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/25",
    dotClass: "bg-amber-500",
    Icon: Clock,
  },
  processing: {
    label: "Processing",
    textClass: "text-primary",
    badgeClass: "bg-primary/10 text-primary border border-primary/25",
    dotClass: "bg-primary animate-pulse",
    Icon: Loader2,
  },
  completed: {
    label: "Completed",
    textClass: "text-emerald-600 dark:text-emerald-400",
    badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25",
    dotClass: "bg-emerald-500",
    Icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    textClass: "text-red-600 dark:text-red-400",
    badgeClass: "bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/25",
    dotClass: "bg-red-500",
    Icon: XCircle,
  },
};

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: JobStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${cfg.badgeClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dotClass}`} />
      {cfg.label}
    </span>
  );
}

// ─── Stat Cards ──────────────────────────────────────────────────────────────

function StatCard({
  label, value, total, icon: Icon, colorClass, bgClass, barClass,
}: {
  label: string; value: number; total: number;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string; bgClass: string; barClass: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="bg-card border border-border/60 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${bgClass}`}>
          <Icon className={`w-4 h-4 ${colorClass}`} />
        </div>
      </div>
      <div>
        <p className={`text-3xl font-bold tabular-nums ${colorClass}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {total > 0 ? `${pct}% of total` : "No jobs yet"}
        </p>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Quota Banner ─────────────────────────────────────────────────────────────

function QuotaBanner({ sub }: { sub: Subscription }) {
  const plan = sub.plan as keyof typeof PLAN_CONFIG;
  const limit = PLAN_CONFIG[plan].jobLimit;
  const used = sub.jobsUsedThisMonth;
  const isUnlimited = limit >= 999999;
  if (isUnlimited) return null;

  const pct = Math.min((used / limit) * 100, 100);
  const nearLimit = pct >= 80;
  const critical = pct >= 95;

  return (
    <div className={`rounded-2xl border p-4 flex items-center gap-4 ${
      critical ? "border-red-500/30 bg-red-500/5" :
      nearLimit ? "border-amber-500/30 bg-amber-500/5" :
      "border-border/60 bg-card"
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-2 gap-2">
          <p className="text-xs font-semibold text-muted-foreground">Monthly Usage</p>
          <p className={`text-xs font-semibold tabular-nums shrink-0 ${
            critical ? "text-red-600 dark:text-red-400" :
            nearLimit ? "text-amber-600 dark:text-amber-400" :
            "text-muted-foreground"
          }`}>{used} / {limit}</p>
        </div>
        <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              critical ? "bg-red-500" : nearLimit ? "bg-amber-500" : "bg-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {nearLimit && (
          <p className={`text-xs mt-1.5 ${critical ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
            {critical ? "You've almost hit your limit" : "Approaching your monthly limit"}
          </p>
        )}
      </div>
      {nearLimit && (
        <Link href="/subscription">
          <Button size="sm" className="gap-1.5 shrink-0 h-8" data-testid="button-upgrade-banner">
            <Zap className="w-3.5 h-3.5" />Upgrade
          </Button>
        </Link>
      )}
    </div>
  );
}

// ─── Job Row ──────────────────────────────────────────────────────────────────

function JobRow({ job, onSelect }: { job: Job; onSelect: (j: Job) => void }) {
  const { toast } = useToast();

  const retryMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/retry", { id: job.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job queued for retry" });
    },
    onError: () => toast({ title: "Failed to retry job", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/jobs/${job.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job deleted" });
    },
    onError: () => toast({ title: "Failed to delete job", variant: "destructive" }),
  });

  return (
    <div
      className="group flex items-center gap-3 px-4 py-3.5 hover:bg-accent/40 active:bg-accent/60 cursor-pointer transition-colors border-b border-border/50 last:border-0"
      onClick={() => onSelect(job)}
      data-testid={`row-job-${job.id}`}
    >
      {/* Status dot */}
      <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_CONFIG[job.status as JobStatus].dotClass}`} />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-sm font-medium text-foreground truncate max-w-[200px] sm:max-w-xs md:max-w-sm"
            data-testid={`text-url-${job.id}`}
          >
            {job.url}
          </span>
          <StatusBadge status={job.status as JobStatus} />
          {parseInt(job.retryCount) > 0 && (
            <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium">
              retry ×{job.retryCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5 mt-1">
          <span className="text-xs text-muted-foreground font-mono opacity-60">{job.id.slice(0, 8)}…</span>
          <span className="text-[10px] text-muted-foreground/50">·</span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div
        className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {job.status === "failed" && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            disabled={retryMutation.isPending}
            onClick={() => retryMutation.mutate()}
            data-testid={`button-retry-${job.id}`}
            title="Retry"
          >
            {retryMutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RotateCcw className="w-3.5 h-3.5" />}
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          disabled={deleteMutation.isPending}
          onClick={() => deleteMutation.mutate()}
          data-testid={`button-delete-${job.id}`}
          title="Delete"
        >
          {deleteMutation.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Trash2 className="w-3.5 h-3.5" />}
        </Button>
        <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 hidden sm:block" />
      </div>
    </div>
  );
}

// ─── Job Detail ───────────────────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
      <span className="text-xs font-semibold text-muted-foreground sm:w-20 shrink-0 uppercase tracking-wider">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function JobDetailPanel({
  job, open, onClose, isMobile,
}: {
  job: Job | null; open: boolean; onClose: () => void; isMobile: boolean;
}) {
  const { toast } = useToast();
  if (!job) return null;

  const cfg = STATUS_CONFIG[job.status as JobStatus];
  const resultStr = job.result ? JSON.stringify(job.result, null, 2) : null;
  const copy = (text: string, label = "Copied to clipboard") => {
    navigator.clipboard.writeText(text);
    toast({ title: label });
  };

  const retryMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/retry", { id: job.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job queued for retry" });
      onClose();
    },
    onError: () => toast({ title: "Failed to retry job", variant: "destructive" }),
  });

  const content = (
    <div className="flex flex-col gap-5 pt-2">
      {/* Status + badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={job.status as JobStatus} />
        {parseInt(job.retryCount) > 0 && (
          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
            {job.retryCount} retries
          </span>
        )}
      </div>

      {/* Metadata */}
      <div className="space-y-3.5 bg-muted/40 rounded-xl border border-border/50 p-4">
        <DetailRow label="Job ID">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-foreground break-all">{job.id}</span>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => copy(job.id, "Job ID copied")}>
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        </DetailRow>
        <div className="border-t border-border/40" />
        <DetailRow label="URL">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary text-sm break-all hover:underline inline-flex items-center gap-1"
          >
            {job.url}
            <ArrowUpRight className="w-3 h-3 shrink-0 opacity-60" />
          </a>
        </DetailRow>
        <div className="border-t border-border/40" />
        <DetailRow label="Created">
          <span className="text-sm text-muted-foreground">
            {new Date(job.createdAt).toLocaleString()}{" "}
            <span className="opacity-60">({formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })})</span>
          </span>
        </DetailRow>
        <div className="border-t border-border/40" />
        <DetailRow label="Updated">
          <span className="text-sm text-muted-foreground">{new Date(job.updatedAt).toLocaleString()}</span>
        </DetailRow>
      </div>

      {/* Error */}
      {job.error && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Error</p>
          <div className="bg-red-500/6 border border-red-500/20 rounded-xl p-3.5 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-400 font-mono break-all leading-relaxed">{job.error}</p>
          </div>
          {job.status === "failed" && (
            <Button
              size="sm"
              variant="outline"
              className="mt-3 gap-2"
              disabled={retryMutation.isPending}
              onClick={() => retryMutation.mutate()}
            >
              {retryMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Retry this job
            </Button>
          )}
        </div>
      )}

      {/* Result */}
      {resultStr && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Result</p>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-xs"
              onClick={() => copy(resultStr, "Result copied")}
            >
              <Copy className="w-3 h-3" />Copy JSON
            </Button>
          </div>
          <div className="bg-muted/60 rounded-xl border border-border/50 p-3">
            <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-all overflow-auto max-h-72 leading-relaxed">
              {resultStr}
            </pre>
          </div>
        </div>
      )}

      {/* Pending / processing empty */}
      {!job.error && !resultStr && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
          {job.status === "processing" ? (
            <>
              <Loader2 className="w-8 h-8 animate-spin opacity-30" />
              <p className="text-sm font-medium">Processing…</p>
              <p className="text-xs opacity-60">Results will appear here when complete</p>
            </>
          ) : (
            <>
              <Clock className="w-8 h-8 opacity-25" />
              <p className="text-sm font-medium">Awaiting processing</p>
              <p className="text-xs opacity-60">This job is in the queue</p>
            </>
          )}
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="bottom" className="h-[85vh] px-0 flex flex-col">
          <SheetHeader className="px-5 py-4 border-b border-border/50 shrink-0">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Terminal className="w-4 h-4 text-primary" />
              Job Details
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 px-5 py-1">{content}</ScrollArea>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[88vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 py-4 border-b border-border/50 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-primary" />
            Job Details
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 px-6 py-2">{content}</ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ─── Filter Tabs ──────────────────────────────────────────────────────────────

const FILTERS: { label: string; value: "all" | JobStatus }[] = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Processing", value: "processing" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
];

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [filter, setFilter] = useState<"all" | JobStatus>("all");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: jobs = [], isLoading, isFetching, refetch } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    refetchInterval: 3000,
    enabled: !!user,
  });

  const { data: sub } = useQuery<Subscription>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const form = useForm<InsertJob>({
    resolver: zodResolver(insertJobSchema),
    defaultValues: { url: "" },
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertJob) => apiRequest("POST", "/api/job", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      form.reset();
      toast({ title: "Job submitted successfully" });
    },
    onError: (err: unknown) => {
      let message = "Failed to create job";
      if (err instanceof Error) {
        const match = err.message.match(/^\d+: (.+)$/);
        if (match) {
          try { message = JSON.parse(match[1]).error || message; } catch { message = match[1] || message; }
        }
      }
      toast({ title: message, variant: "destructive" });
    },
  });

  const stats = {
    total: jobs.length,
    pending: jobs.filter((j) => j.status === "pending").length,
    processing: jobs.filter((j) => j.status === "processing").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  };

  const filtered = filter === "all" ? jobs : jobs.filter((j) => j.status === filter);
  const filterCount: Record<string, number> = {
    all: stats.total,
    pending: stats.pending,
    processing: stats.processing,
    completed: stats.completed,
    failed: stats.failed,
  };

  const handleOpenDetail = (job: Job) => {
    setSelectedJob(job);
    setDetailOpen(true);
  };

  // Use sheet on narrow screens, dialog on wider
  const [isMobileView, setIsMobileView] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 640 : false
  );
  // Sync on resize
  useEffect(() => {
    const handler = () => setIsMobileView(window.innerWidth < 640);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return (
    <AppLayout>
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-7 space-y-5 sm:space-y-6">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-none">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Welcome back{user ? `, ${user.name.split(" ")[0]}` : ""}! Here's what's happening.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {stats.processing > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-primary bg-primary/8 border border-primary/20 rounded-full px-3 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                {stats.processing} running
              </div>
            )}
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 rounded-xl border-border/60"
              onClick={() => refetch()}
              data-testid="button-refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* ── Quota Banner ──────────────────────────────────── */}
        {sub && <QuotaBanner sub={sub} />}

        {/* ── Stats ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Pending" value={stats.pending} total={stats.total}
            icon={Clock} colorClass="text-amber-500" bgClass="bg-amber-500/10"
          />
          <StatCard
            label="Processing" value={stats.processing} total={stats.total}
            icon={Loader2} colorClass="text-primary" bgClass="bg-primary/10"
          />
          <StatCard
            label="Completed" value={stats.completed} total={stats.total}
            icon={CheckCircle2} colorClass="text-emerald-500" bgClass="bg-emerald-500/10"
          />
          <StatCard
            label="Failed" value={stats.failed} total={stats.total}
            icon={XCircle} colorClass="text-red-500" bgClass="bg-red-500/10"
          />
        </div>

        {/* ── Submit Form ────────────────────────────────────── */}
        <div className="bg-card border border-border/60 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Send className="w-3.5 h-3.5 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">Submit a Scraping Job</h2>
          </div>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((data) => createMutation.mutate(data))}
              className="flex flex-col sm:flex-row gap-2"
            >
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          {...field}
                          placeholder="https://example.com"
                          className="pl-9 h-11 font-mono text-sm bg-background border-border/70 focus:border-primary transition-colors"
                          data-testid="input-url"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="h-11 gap-2 px-5 shrink-0 font-semibold"
                disabled={createMutation.isPending}
                data-testid="button-submit-job"
              >
                {createMutation.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><Plus className="w-4 h-4" />Submit</>
                }
              </Button>
            </form>
          </Form>
        </div>

        {/* ── Job List ───────────────────────────────────────── */}
        <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">

          {/* List header */}
          <div className="px-4 sm:px-5 pt-4 pb-0">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <ListFilter className="w-3.5 h-3.5 text-primary" />
                </div>
                <h2 className="text-sm font-semibold">Jobs</h2>
                <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 font-medium">
                  {filtered.length}
                </span>
              </div>
              {stats.processing > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-primary sm:hidden">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  {stats.processing} running
                </div>
              )}
            </div>

            {/* Filter tabs — scrollable on mobile */}
            <div className="flex gap-1 overflow-x-auto pb-3 -mx-1 px-1 scrollbar-hide">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  data-testid={`button-filter-${f.value}`}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all shrink-0 ${
                    filter === f.value
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  {f.label}
                  <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-bold tabular-nums ${
                    filter === f.value ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                  }`}>
                    {filterCount[f.value]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-border/50" />

          {/* Job rows */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Loader2 className="w-7 h-7 animate-spin opacity-40" />
              <p className="text-sm">Loading jobs…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center">
                {filter === "all"
                  ? <Inbox className="w-7 h-7 opacity-40" />
                  : <TrendingUp className="w-7 h-7 opacity-40" />
                }
              </div>
              <div className="text-center">
                <p className="font-semibold text-sm text-foreground/70">
                  {filter === "all" ? "No jobs yet" : `No ${filter} jobs`}
                </p>
                <p className="text-xs opacity-60 mt-0.5">
                  {filter === "all" ? "Submit a URL above to start scraping" : `Switch filter to see other jobs`}
                </p>
              </div>
            </div>
          ) : (
            <ScrollArea className="max-h-[520px]">
              {filtered.map((job) => (
                <JobRow key={job.id} job={job} onSelect={handleOpenDetail} />
              ))}
            </ScrollArea>
          )}
        </div>

      </div>

      {/* Job detail panel */}
      <JobDetailPanel
        job={selectedJob}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        isMobile={isMobileView}
      />
    </AppLayout>
  );
}
