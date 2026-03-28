import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertJobSchema } from "@shared/schema";
import type { Job, JobStatus, InsertJob, Subscription } from "@shared/schema";
import { PLAN_CONFIG } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import AppLayout from "@/components/app-layout";
import { Link } from "wouter";
import {
  Globe, Clock, CheckCircle2, XCircle, Loader2, RefreshCw, Trash2, Plus,
  Terminal, AlertCircle, Copy, Zap, ArrowUpRight, Send, ListFilter,
  RotateCcw, Inbox, TrendingUp, Search, X, Download, CheckCheck,
  Activity, BarChart3, Timer, ChevronDown, ChevronUp,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ─── Types ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<JobStatus, {
  label: string;
  textClass: string;
  badgeClass: string;
  dotClass: string;
  barClass: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = {
  pending: {
    label: "Pending",
    textClass: "text-amber-600 dark:text-amber-400",
    badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/25",
    dotClass: "bg-amber-500",
    barClass: "bg-amber-500",
    Icon: Clock,
  },
  processing: {
    label: "Processing",
    textClass: "text-primary",
    badgeClass: "bg-primary/10 text-primary border border-primary/25",
    dotClass: "bg-primary animate-pulse",
    barClass: "bg-primary",
    Icon: Loader2,
  },
  completed: {
    label: "Completed",
    textClass: "text-emerald-600 dark:text-emerald-400",
    badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25",
    dotClass: "bg-emerald-500",
    barClass: "bg-emerald-500",
    Icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    textClass: "text-red-600 dark:text-red-400",
    badgeClass: "bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/25",
    dotClass: "bg-red-500",
    barClass: "bg-red-500",
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

// ─── PriorityBadge ────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  high:   { label: "High",   cls: "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/25" },
  normal: { label: "Normal", cls: "bg-muted text-muted-foreground border border-border/50" },
  low:    { label: "Low",    cls: "bg-slate-500/10 text-slate-500 dark:text-slate-400 border border-slate-500/20" },
};

function PriorityBadge({ priority }: { priority?: string | null }) {
  const p = (priority ?? "normal") as keyof typeof PRIORITY_CONFIG;
  const cfg = PRIORITY_CONFIG[p] ?? PRIORITY_CONFIG.normal;
  if (p === "normal") return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, total, icon: Icon, colorClass, bgClass, barClass, onClick, active,
}: {
  label: string; value: number; total: number;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string; bgClass: string; barClass: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <button
      onClick={onClick}
      data-testid={`card-stat-${label.toLowerCase()}`}
      className={`bg-card border rounded-2xl p-4 flex flex-col gap-3 text-left w-full transition-all duration-200 ${
        active
          ? "border-primary/40 ring-2 ring-primary/20 shadow-sm"
          : "border-border/60 hover:border-border hover:shadow-sm"
      } ${onClick ? "cursor-pointer" : "cursor-default"}`}
    >
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
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ total, successRate }: { total: number; successRate: number }) {
  return (
    <div className="bg-card border border-border/60 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Jobs</span>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-violet-500/10">
          <BarChart3 className="w-4 h-4 text-violet-500" />
        </div>
      </div>
      <div>
        <p className="text-3xl font-bold tabular-nums text-foreground">{total}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {total > 0 ? `${successRate}% success rate` : "No jobs yet"}
        </p>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-violet-500 transition-all duration-700"
          style={{ width: `${successRate}%` }}
        />
      </div>
    </div>
  );
}

// ─── Stat Skeleton ────────────────────────────────────────────────────────────

function StatSkeleton() {
  return (
    <div className="bg-card border border-border/60 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3.5 w-20 rounded" />
        <Skeleton className="h-8 w-8 rounded-xl" />
      </div>
      <div>
        <Skeleton className="h-9 w-12 rounded mb-1" />
        <Skeleton className="h-3 w-24 rounded" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
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
    <div className={`rounded-2xl border p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 ${
      critical ? "border-red-500/30 bg-red-500/5" :
      nearLimit ? "border-amber-500/30 bg-amber-500/5" :
      "border-border/60 bg-card"
    }`}>
      <div className="flex items-center gap-2.5 shrink-0">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
          critical ? "bg-red-500/10" : nearLimit ? "bg-amber-500/10" : "bg-primary/10"
        }`}>
          <Activity className={`w-4 h-4 ${
            critical ? "text-red-500" : nearLimit ? "text-amber-500" : "text-primary"
          }`} />
        </div>
        <span className="text-sm font-semibold text-foreground">Monthly Usage</span>
      </div>
      <div className="flex-1 min-w-0 w-full sm:w-auto">
        <div className="flex items-center justify-between mb-1.5 gap-2">
          <p className="text-xs text-muted-foreground">{PLAN_CONFIG[plan].label} plan</p>
          <p className={`text-xs font-bold tabular-nums shrink-0 ${
            critical ? "text-red-600 dark:text-red-400" :
            nearLimit ? "text-amber-600 dark:text-amber-400" :
            "text-muted-foreground"
          }`}>{used} / {limit} jobs</p>
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
            {critical ? "You've almost hit your limit — upgrade now to keep scraping" : "Approaching your monthly limit"}
          </p>
        )}
      </div>
      {nearLimit && (
        <Link href="/subscription">
          <Button size="sm" className="gap-1.5 shrink-0 h-8 whitespace-nowrap" data-testid="button-upgrade-banner">
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

  const downloadResult = () => {
    if (!job.result) return;
    const blob = new Blob([JSON.stringify(job.result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-${job.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Result downloaded" });
  };

  return (
    <div
      className="group flex items-center gap-3 px-4 py-3.5 hover:bg-accent/40 active:bg-accent/60 cursor-pointer transition-colors border-b border-border/50 last:border-0"
      onClick={() => onSelect(job)}
      data-testid={`row-job-${job.id}`}
    >
      <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_CONFIG[job.status as JobStatus].dotClass}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-sm font-medium text-foreground truncate max-w-[140px] xs:max-w-[200px] sm:max-w-xs md:max-w-sm"
            data-testid={`text-url-${job.id}`}
          >
            {job.url}
          </span>
          <StatusBadge status={job.status as JobStatus} />
          <PriorityBadge priority={job.priority} />
          {parseInt(job.retryCount) > 0 && (
            <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium hidden sm:inline">
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

      <div
        className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {job.status === "completed" && !!job.result && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-emerald-600"
            onClick={downloadResult}
            data-testid={`button-download-${job.id}`}
            title="Download JSON"
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
        )}
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

// ─── Job Row Skeleton ─────────────────────────────────────────────────────────

function JobRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border/50 last:border-0">
      <Skeleton className="w-2 h-2 rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-48 rounded" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="h-3 w-20 rounded" />
        </div>
      </div>
      <Skeleton className="h-8 w-8 rounded" />
    </div>
  );
}

// ─── Job Detail Panel ─────────────────────────────────────────────────────────

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

  const retryMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/retry", { id: job?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job queued for retry" });
      onClose();
    },
    onError: () => toast({ title: "Failed to retry job", variant: "destructive" }),
  });

  if (!job) return null;

  const resultStr = job.result ? JSON.stringify(job.result, null, 2) : null;

  const copy = (text: string, label = "Copied to clipboard") => {
    navigator.clipboard.writeText(text);
    toast({ title: label });
  };

  const downloadResult = () => {
    if (!job.result) return;
    const blob = new Blob([JSON.stringify(job.result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-${job.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Result downloaded" });
  };

  const content = (
    <div className="flex flex-col gap-5 pt-2 pb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={job.status as JobStatus} />
        {parseInt(job.retryCount) > 0 && (
          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
            {job.retryCount} {parseInt(job.retryCount) === 1 ? "retry" : "retries"}
          </span>
        )}
      </div>

      <div className="space-y-3.5 bg-muted/40 rounded-xl border border-border/50 p-4">
        <DetailRow label="Job ID">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-foreground break-all">{job.id}</span>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0"
              onClick={() => copy(job.id, "Job ID copied")}
              data-testid="button-copy-id"
            >
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        </DetailRow>
        <div className="border-t border-border/40" />
        <DetailRow label="URL">
          <div className="flex items-start gap-2">
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary text-sm break-all hover:underline inline-flex items-center gap-1 flex-1 min-w-0"
              data-testid="link-job-url"
            >
              <span className="break-all">{job.url}</span>
              <ArrowUpRight className="w-3 h-3 shrink-0 opacity-60" />
            </a>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0 mt-0.5"
              onClick={() => copy(job.url, "URL copied")}
              data-testid="button-copy-url"
            >
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        </DetailRow>
        <div className="border-t border-border/40" />
        <DetailRow label="Priority">
          <span className="text-sm text-muted-foreground capitalize">{job.priority ?? "normal"}</span>
        </DetailRow>
        {job.workerId && (
          <>
            <div className="border-t border-border/40" />
            <DetailRow label="Worker">
              <span className="text-sm font-mono text-muted-foreground">{job.workerId}</span>
            </DetailRow>
          </>
        )}
        <div className="border-t border-border/40" />
        <DetailRow label="Created">
          <div>
            <span className="text-sm text-muted-foreground">
              {format(new Date(job.createdAt), "MMM d, yyyy 'at' h:mm a")}
            </span>
            <span className="text-xs opacity-50 ml-2">
              ({formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })})
            </span>
          </div>
        </DetailRow>
        <div className="border-t border-border/40" />
        <DetailRow label="Updated">
          <span className="text-sm text-muted-foreground">
            {format(new Date(job.updatedAt), "MMM d, yyyy 'at' h:mm a")}
          </span>
        </DetailRow>
      </div>

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
              data-testid="button-retry-detail"
            >
              {retryMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Retry this job
            </Button>
          )}
        </div>
      )}

      {resultStr && (
        <div>
          <div className="flex items-center justify-between mb-2 gap-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Result</p>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-xs"
                onClick={() => copy(resultStr, "Result copied")}
                data-testid="button-copy-result"
              >
                <Copy className="w-3 h-3" />Copy
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-xs"
                onClick={downloadResult}
                data-testid="button-download-result"
              >
                <Download className="w-3 h-3" />Download
              </Button>
            </div>
          </div>
          <div className="bg-muted/60 rounded-xl border border-border/50 p-3">
            <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-all overflow-auto max-h-64 leading-relaxed">
              {resultStr}
            </pre>
          </div>
        </div>
      )}

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
        <SheetContent side="bottom" className="h-[88vh] px-0 flex flex-col">
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
  const [search, setSearch] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { data: jobs = [], isLoading, isFetching, refetch } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    refetchInterval: 3000,
    enabled: !!user,
  });

  const { data: sub } = useQuery<Subscription>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
    refetchInterval: 10000,
  });

  const [showAdvanced, setShowAdvanced] = useState(false);

  const form = useForm<InsertJob>({
    resolver: zodResolver(insertJobSchema),
    defaultValues: { url: "", priority: "normal", delay: undefined },
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

  const clearCompletedMutation = useMutation({
    mutationFn: async () => {
      const completed = jobs.filter((j) => j.status === "completed");
      const results = await Promise.allSettled(
        completed.map((j) => apiRequest("DELETE", `/api/jobs/${j.id}`))
      );
      const succeeded = completed
        .filter((_, i) => results[i].status === "fulfilled")
        .map((j) => j.id);
      return succeeded;
    },
    onSuccess: (deletedIds) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      if (selectedJobId && deletedIds.includes(selectedJobId)) {
        setDetailOpen(false);
        setSelectedJobId(null);
      }
      toast({ title: `${deletedIds.length} completed job${deletedIds.length !== 1 ? "s" : ""} cleared` });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Failed to clear jobs", variant: "destructive" });
    },
  });

  const stats = {
    total: jobs.length,
    pending: jobs.filter((j) => j.status === "pending").length,
    processing: jobs.filter((j) => j.status === "processing").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  };

  const successRate = stats.total > 0
    ? Math.round((stats.completed / stats.total) * 100)
    : 0;

  const filtered = jobs
    .filter((j) => filter === "all" || j.status === filter)
    .filter((j) => !search || j.url.toLowerCase().includes(search.toLowerCase()) || j.id.toLowerCase().includes(search.toLowerCase()));

  const filterCount: Record<string, number> = {
    all: jobs.filter((j) => !search || j.url.toLowerCase().includes(search.toLowerCase()) || j.id.toLowerCase().includes(search.toLowerCase())).length,
    pending: jobs.filter((j) => j.status === "pending" && (!search || j.url.toLowerCase().includes(search.toLowerCase()))).length,
    processing: jobs.filter((j) => j.status === "processing" && (!search || j.url.toLowerCase().includes(search.toLowerCase()))).length,
    completed: jobs.filter((j) => j.status === "completed" && (!search || j.url.toLowerCase().includes(search.toLowerCase()))).length,
    failed: jobs.filter((j) => j.status === "failed" && (!search || j.url.toLowerCase().includes(search.toLowerCase()))).length,
  };

  // Always derive the displayed job from the live jobs list so the detail panel
  // reflects updates from the 3-second polling interval automatically.
  const selectedJob = selectedJobId ? (jobs.find((j) => j.id === selectedJobId) ?? null) : null;

  const handleOpenDetail = (job: Job) => {
    setSelectedJobId(job.id);
    setDetailOpen(true);
  };

  const [isMobileView, setIsMobileView] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 640 : false
  );
  useEffect(() => {
    const handler = () => setIsMobileView(window.innerWidth < 640);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const hasCompletedJobs = stats.completed > 0;
  const hasActiveFilter = filter !== "all" || search !== "";

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
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* ── Quota Banner ──────────────────────────────────── */}
        {sub && <QuotaBanner sub={sub} />}

        {/* ── Stats ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {isLoading ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : (
            <>
              <SummaryCard total={stats.total} successRate={successRate} />
              <StatCard
                label="Pending" value={stats.pending} total={stats.total}
                icon={Clock} colorClass="text-amber-500" bgClass="bg-amber-500/10" barClass="bg-amber-500"
                onClick={() => setFilter(filter === "pending" ? "all" : "pending")}
                active={filter === "pending"}
              />
              <StatCard
                label="Processing" value={stats.processing} total={stats.total}
                icon={Loader2} colorClass="text-primary" bgClass="bg-primary/10" barClass="bg-primary"
                onClick={() => setFilter(filter === "processing" ? "all" : "processing")}
                active={filter === "processing"}
              />
              <StatCard
                label="Completed" value={stats.completed} total={stats.total}
                icon={CheckCircle2} colorClass="text-emerald-500" bgClass="bg-emerald-500/10" barClass="bg-emerald-500"
                onClick={() => setFilter(filter === "completed" ? "all" : "completed")}
                active={filter === "completed"}
              />
              <StatCard
                label="Failed" value={stats.failed} total={stats.total}
                icon={XCircle} colorClass="text-red-500" bgClass="bg-red-500/10" barClass="bg-red-500"
                onClick={() => setFilter(filter === "failed" ? "all" : "failed")}
                active={filter === "failed"}
              />
            </>
          )}
        </div>

        {/* ── Submit Form ────────────────────────────────────── */}
        <div className="bg-card border border-border/60 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Send className="w-3.5 h-3.5 text-primary" />
              </div>
              <h2 className="text-sm font-semibold">Submit a Scraping Job</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              data-testid="button-toggle-advanced"
            >
              {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Options
            </button>
          </div>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((data) => createMutation.mutate(data))}
              className="space-y-2"
            >
              <div className="flex flex-col sm:flex-row gap-2">
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
              </div>

              {showAdvanced && (
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Select value={field.value ?? "normal"} onValueChange={field.onChange}>
                            <SelectTrigger className="h-9 text-xs bg-background border-border/70" data-testid="select-priority">
                              <div className="flex items-center gap-2">
                                <Zap className="w-3.5 h-3.5 text-muted-foreground" />
                                <SelectValue placeholder="Priority" />
                              </div>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="high">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-red-500" />
                                  High priority
                                </div>
                              </SelectItem>
                              <SelectItem value="normal">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-primary" />
                                  Normal priority
                                </div>
                              </SelectItem>
                              <SelectItem value="low">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                                  Low priority
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="delay"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <div className="relative">
                            <Timer className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                            <Input
                              type="number"
                              min={0}
                              max={3600000}
                              step={1000}
                              placeholder="Delay (ms) — optional"
                              className="pl-9 h-9 text-xs bg-background border-border/70"
                              data-testid="input-delay"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
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
                <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 font-medium tabular-nums">
                  {filtered.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {stats.processing > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-primary sm:hidden">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    {stats.processing} running
                  </div>
                )}
                {hasCompletedJobs && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs hidden sm:flex"
                    disabled={clearCompletedMutation.isPending}
                    onClick={() => clearCompletedMutation.mutate()}
                    data-testid="button-clear-completed"
                  >
                    {clearCompletedMutation.isPending
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <CheckCheck className="w-3 h-3" />
                    }
                    Clear completed
                  </Button>
                )}
              </div>
            </div>

            {/* Search */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by URL or job ID…"
                className="w-full pl-8 pr-8 py-2 text-sm rounded-lg bg-muted/50 border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder:text-muted-foreground/60"
                data-testid="input-search-jobs"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-clear-search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
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

          {/* Mobile clear completed */}
          {hasCompletedJobs && (
            <div className="sm:hidden px-4 py-2 border-b border-border/50">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs w-full"
                disabled={clearCompletedMutation.isPending}
                onClick={() => clearCompletedMutation.mutate()}
                data-testid="button-clear-completed-mobile"
              >
                {clearCompletedMutation.isPending
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <CheckCheck className="w-3 h-3" />
                }
                Clear completed jobs
              </Button>
            </div>
          )}

          {/* Active filter + search indicator */}
          {hasActiveFilter && !isLoading && (
            <div className="px-4 py-2 flex items-center gap-2 border-b border-border/50 bg-muted/30">
              <span className="text-xs text-muted-foreground">
                Showing {filtered.length} of {stats.total} jobs
              </span>
              <button
                onClick={() => { setFilter("all"); setSearch(""); }}
                className="text-xs text-primary hover:underline font-medium ml-auto"
                data-testid="button-clear-filters"
              >
                Clear filters
              </button>
            </div>
          )}

          {/* Job rows */}
          {isLoading ? (
            <div>
              {Array.from({ length: 5 }).map((_, i) => <JobRowSkeleton key={i} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center">
                {search
                  ? <Search className="w-7 h-7 opacity-40" />
                  : filter === "all"
                    ? <Inbox className="w-7 h-7 opacity-40" />
                    : <TrendingUp className="w-7 h-7 opacity-40" />
                }
              </div>
              <div className="text-center">
                <p className="font-semibold text-sm text-foreground/70">
                  {search
                    ? "No results found"
                    : filter === "all"
                      ? "No jobs yet"
                      : `No ${filter} jobs`
                  }
                </p>
                <p className="text-xs opacity-60 mt-0.5">
                  {search
                    ? `No jobs match "${search}"`
                    : filter === "all"
                      ? "Submit a URL above to start scraping"
                      : "Switch filter or submit new jobs"
                  }
                </p>
                {(search || filter !== "all") && (
                  <button
                    onClick={() => { setFilter("all"); setSearch(""); }}
                    className="text-xs text-primary hover:underline font-medium mt-2"
                    data-testid="button-reset-filters"
                  >
                    Clear filters
                  </button>
                )}
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
        onClose={() => { setDetailOpen(false); setSelectedJobId(null); }}
        isMobile={isMobileView}
      />
    </AppLayout>
  );
}
