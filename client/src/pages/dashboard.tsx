import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertJobSchema } from "@shared/schema";
import type { Job, JobStatus, InsertJob, Subscription } from "@shared/schema";
import { PLAN_CONFIG } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import AppLayout from "@/components/app-layout";
import { Link } from "wouter";
import {
  Globe, Clock, CheckCircle2, XCircle, Loader2, RefreshCw, Trash2, Plus, Activity,
  Terminal, ChevronRight, AlertCircle, Copy, Filter, Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const STATUS_CONFIG: Record<JobStatus, { label: string; color: string; bgColor: string; icon: React.ComponentType<any> }> = {
  pending: { label: "Pending", color: "text-amber-500 dark:text-amber-400", bgColor: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20", icon: Clock },
  processing: { label: "Processing", color: "text-primary", bgColor: "bg-primary/10 text-primary border-primary/20", icon: Loader2 },
  completed: { label: "Completed", color: "text-emerald-500 dark:text-emerald-400", bgColor: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20", icon: CheckCircle2 },
  failed: { label: "Failed", color: "text-destructive", bgColor: "bg-destructive/10 text-destructive border-destructive/20", icon: XCircle },
};

function StatusBadge({ status }: { status: JobStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border ${cfg.bgColor}`}>
      <cfg.icon className={`w-3 h-3 ${status === "processing" ? "animate-spin" : ""}`} />
      {cfg.label}
    </span>
  );
}

function StatCard({ label, value, icon: Icon, colorClass, bgClass }: { label: string; value: number; icon: React.ComponentType<any>; colorClass: string; bgClass: string }) {
  return (
    <Card className="border-card-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${colorClass}`}>{value}</p>
          </div>
          <div className={`p-2.5 rounded-lg ${bgClass}`}>
            <Icon className={`w-5 h-5 ${colorClass}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function JobRow({ job, onSelect }: { job: Job; onSelect: (j: Job) => void }) {
  const { toast } = useToast();

  const retryMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/retry", { id: job.id }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/jobs"] }); toast({ title: "Job queued for retry" }); },
    onError: () => toast({ title: "Failed to retry job", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/jobs/${job.id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/jobs"] }); toast({ title: "Job deleted" }); },
    onError: () => toast({ title: "Failed to delete job", variant: "destructive" }),
  });

  return (
    <div
      className="group flex items-center gap-3 px-4 py-3 hover:bg-accent/50 cursor-pointer transition-colors border-b border-border last:border-0"
      onClick={() => onSelect(job)}
      data-testid={`row-job-${job.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate max-w-xs" data-testid={`text-url-${job.id}`}>{job.url}</span>
          <StatusBadge status={job.status as JobStatus} />
          {parseInt(job.retryCount) > 0 && <span className="text-xs text-muted-foreground">retry #{job.retryCount}</span>}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-muted-foreground font-mono">{job.id.slice(0, 8)}…</span>
          <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
        {job.status === "failed" && (
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={retryMutation.isPending} onClick={() => retryMutation.mutate()} data-testid={`button-retry-${job.id}`}>
            <RefreshCw className={`w-3.5 h-3.5 ${retryMutation.isPending ? "animate-spin" : ""}`} />
          </Button>
        )}
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()} data-testid={`button-delete-${job.id}`}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </div>
    </div>
  );
}

function JobDetailDialog({ job, open, onClose }: { job: Job | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  if (!job) return null;
  const resultStr = job.result ? JSON.stringify(job.result, null, 2) : null;
  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); toast({ title: "Copied to clipboard" }); };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 py-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2"><Terminal className="w-4 h-4 text-primary" />Job Details</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <StatusBadge status={job.status as JobStatus} />
              {parseInt(job.retryCount) > 0 && <span className="text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground">{job.retryCount} retries</span>}
            </div>
            <div className="space-y-3">
              <DetailRow label="Job ID"><div className="flex items-center gap-2"><span className="font-mono text-sm">{job.id}</span><Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copyToClipboard(job.id)}><Copy className="w-3 h-3" /></Button></div></DetailRow>
              <DetailRow label="URL"><a href={job.url} target="_blank" rel="noopener noreferrer" className="text-primary underline text-sm break-all">{job.url}</a></DetailRow>
              <DetailRow label="Created"><span className="text-sm text-muted-foreground">{new Date(job.createdAt).toLocaleString()} ({formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })})</span></DetailRow>
              <DetailRow label="Updated"><span className="text-sm text-muted-foreground">{new Date(job.updatedAt).toLocaleString()}</span></DetailRow>
            </div>
            {job.error && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Error</p>
                <div className="bg-destructive/8 border border-destructive/20 rounded-md p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                  <p className="text-sm text-destructive font-mono break-all">{job.error}</p>
                </div>
              </div>
            )}
            {resultStr && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Result</p>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => copyToClipboard(resultStr)}><Copy className="w-3 h-3" /> Copy</Button>
                </div>
                <div className="bg-muted rounded-md p-3 border border-border">
                  <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-all overflow-auto max-h-64">{resultStr}</pre>
                </div>
              </div>
            )}
            {!job.error && !resultStr && (
              <div className="text-center py-6 text-muted-foreground">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No result data yet</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <span className="text-xs font-medium text-muted-foreground w-20 shrink-0 mt-0.5 uppercase tracking-wider">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

const FILTERS: { label: string; value: "all" | JobStatus }[] = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Processing", value: "processing" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
];

function QuotaBanner({ sub }: { sub: Subscription }) {
  const plan = sub.plan as keyof typeof PLAN_CONFIG;
  const limit = PLAN_CONFIG[plan].jobLimit;
  const used = sub.jobsUsedThisMonth;
  const isUnlimited = limit >= 999999;
  const pct = isUnlimited ? 0 : (used / limit) * 100;
  const nearLimit = pct >= 80;

  if (isUnlimited) return null;

  return (
    <div className={`rounded-xl border p-4 flex items-center gap-4 ${nearLimit ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card"}`}>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-muted-foreground">Monthly job usage</p>
          <p className="text-xs text-muted-foreground">{used} / {limit}</p>
        </div>
        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
          <div className={`h-full rounded-full ${pct > 85 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      {nearLimit && (
        <Link href="/subscription">
          <Button size="sm" className="gap-1.5 shrink-0" data-testid="button-upgrade-banner">
            <Zap className="w-3.5 h-3.5" /> Upgrade
          </Button>
        </Link>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [filter, setFilter] = useState<"all" | JobStatus>("all");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: jobs = [], isLoading, refetch } = useQuery<Job[]>({
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
      toast({ title: "Job created successfully" });
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

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Header row */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Welcome back{user ? `, ${user.name.split(" ")[0]}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 text-xs ${stats.processing > 0 ? "text-primary" : "text-muted-foreground"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${stats.processing > 0 ? "bg-primary animate-pulse-soft" : "bg-muted-foreground/40"}`} />
              {stats.processing > 0 ? `${stats.processing} running` : "Idle"}
            </div>
            <Button size="icon" variant="ghost" onClick={() => refetch()} data-testid="button-refresh">
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Quota banner */}
        {sub && <QuotaBanner sub={sub} />}

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Pending" value={stats.pending} icon={Clock} colorClass="text-amber-500 dark:text-amber-400" bgClass="bg-amber-500/10" />
          <StatCard label="Processing" value={stats.processing} icon={Loader2} colorClass="text-primary" bgClass="bg-primary/10" />
          <StatCard label="Completed" value={stats.completed} icon={CheckCircle2} colorClass="text-emerald-500 dark:text-emerald-400" bgClass="bg-emerald-500/10" />
          <StatCard label="Failed" value={stats.failed} icon={XCircle} colorClass="text-destructive" bgClass="bg-destructive/10" />
        </div>

        {/* Submit form */}
        <Card className="border-card-border">
          <CardHeader className="pb-3 pt-4 px-5">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />
              Add New Job
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="flex gap-2">
                <FormField control={form.control} name="url" render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <Input {...field} placeholder="https://example.com" className="font-mono text-sm" data-testid="input-url" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-job">
                  {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" />Submit</>}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Job list */}
        <Card className="border-card-border">
          <CardHeader className="pb-0 pt-4 px-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Filter className="w-4 h-4 text-primary" />
                Jobs
                <span className="text-xs font-normal text-muted-foreground">({filtered.length})</span>
              </CardTitle>
              <div className="flex gap-1 flex-wrap">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setFilter(f.value)}
                    data-testid={`button-filter-${f.value}`}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${filter === f.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
                  >
                    {f.label}
                    {f.value !== "all" && (
                      <span className="ml-1 opacity-70">
                        {f.value === "pending" ? stats.pending : f.value === "processing" ? stats.processing : f.value === "completed" ? stats.completed : stats.failed}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <Separator className="mt-3" />
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
                <Activity className="w-10 h-10 mb-3 opacity-30" />
                <p className="font-medium text-sm">No jobs {filter !== "all" ? `with status "${filter}"` : "yet"}</p>
                <p className="text-xs mt-1 opacity-70">Submit a URL above to get started</p>
              </div>
            ) : (
              <ScrollArea className="max-h-[480px]">
                {filtered.map((job) => <JobRow key={job.id} job={job} onSelect={(j) => { setSelectedJob(j); setDetailOpen(true); }} />)}
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
      <JobDetailDialog job={selectedJob} open={detailOpen} onClose={() => setDetailOpen(false)} />
    </AppLayout>
  );
}
