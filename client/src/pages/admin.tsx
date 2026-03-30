import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ShieldCheck, Users, Briefcase, TrendingUp, CheckCircle2, XCircle, Clock,
  Loader2, Trash2, Crown, RefreshCw, Globe, AlertTriangle, Search, X,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import type { Job, JobStatus, Subscription } from "@shared/schema";
import { PLAN_CONFIG } from "@shared/schema";
import type { AuthUser } from "@/hooks/use-auth";

// ─── Types ────────────────────────────────────────────────────────────────────

type UserWithSub = AuthUser & { subscription?: Subscription; isAdmin?: boolean };

type AdminStats = {
  totalUsers: number;
  planCounts: Record<string, number>;
  totalJobs: number;
  jobStatusCounts: Record<string, number>;
};

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, colorClass, sub,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
  sub?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-start gap-4" data-testid={`stat-card-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className={`p-2.5 rounded-lg ${colorClass}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
        {sub && <p className="text-xs text-muted-foreground/60 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<JobStatus, string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  processing: "bg-primary/10 text-primary border-primary/20",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
};

function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

// ─── Plan Badge ───────────────────────────────────────────────────────────────

const PLAN_STYLES: Record<string, string> = {
  free: "bg-muted text-muted-foreground border-border",
  pro: "bg-primary/10 text-primary border-primary/20",
  business: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
};

function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${PLAN_STYLES[plan] ?? PLAN_STYLES.free}`}>
      {plan}
    </span>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<UserWithSub | null>(null);

  const { data: users, isLoading } = useQuery<UserWithSub[]>({
    queryKey: ["/api/admin/users"],
  });

  const updatePlanMutation = useMutation({
    mutationFn: ({ userId, plan }: { userId: number; plan: string }) =>
      apiRequest("PATCH", `/api/admin/users/${userId}/plan`, { plan }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Plan updated" });
    },
    onError: () => toast({ title: "Failed to update plan", variant: "destructive" }),
  });

  const toggleAdminMutation = useMutation({
    mutationFn: ({ userId, isAdmin }: { userId: number; isAdmin: boolean }) =>
      apiRequest("PATCH", `/api/admin/users/${userId}/admin`, { isAdmin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Admin status updated" });
    },
    onError: () => toast({ title: "Failed to update admin status", variant: "destructive" }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: number) => apiRequest("DELETE", `/api/admin/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setConfirmDelete(null);
      toast({ title: "User deleted" });
    },
    onError: () => toast({ title: "Failed to delete user", variant: "destructive" }),
  });

  const filtered = (users ?? []).filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          data-testid="input-user-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full pl-9 pr-9 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plan</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Usage</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Joined</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-4 py-3" colSpan={6}>
                        <Skeleton className="h-5 w-full" />
                      </td>
                    </tr>
                  ))
                : filtered.length === 0
                ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                        No users found
                      </td>
                    </tr>
                  )
                : filtered.map((u) => {
                    const plan = u.subscription?.plan ?? "free";
                    const used = u.subscription?.jobsUsedThisMonth ?? 0;
                    const limit = PLAN_CONFIG[plan as keyof typeof PLAN_CONFIG]?.jobLimit ?? 0;
                    const isSelf = u.id === currentUser?.id;
                    return (
                      <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`row-user-${u.id}`}>
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-foreground flex items-center gap-1.5">
                              {u.name}
                              {isSelf && <span className="text-xs text-primary">(you)</span>}
                            </p>
                            <p className="text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Select
                            value={plan}
                            onValueChange={(val) => updatePlanMutation.mutate({ userId: u.id, plan: val })}
                            disabled={updatePlanMutation.isPending}
                          >
                            <SelectTrigger className="w-32 h-7 text-xs" data-testid={`select-plan-${u.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="free">Free</SelectItem>
                              <SelectItem value="pro">Pro</SelectItem>
                              <SelectItem value="business">Business</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-muted-foreground text-xs">
                            {used} / {limit === 999999 ? "∞" : limit}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(u.createdAt ?? Date.now()), "MMM d, yyyy")}
                        </td>
                        <td className="px-4 py-3">
                          {u.isAdmin ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              <Crown className="w-3 h-3" /> Admin
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">User</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 justify-end">
                            {!isSelf && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                data-testid={`button-toggle-admin-${u.id}`}
                                onClick={() => toggleAdminMutation.mutate({ userId: u.id, isAdmin: !u.isAdmin })}
                                disabled={toggleAdminMutation.isPending}
                              >
                                {u.isAdmin ? "Revoke Admin" : "Make Admin"}
                              </Button>
                            )}
                            {!isSelf && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                                data-testid={`button-delete-user-${u.id}`}
                                onClick={() => setConfirmDelete(u)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete confirm dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" /> Delete User
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{confirmDelete?.name}</strong> ({confirmDelete?.email})? This will permanently remove their account, subscription, and API keys.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              data-testid="button-confirm-delete-user"
              onClick={() => confirmDelete && deleteUserMutation.mutate(confirmDelete.id)}
              disabled={deleteUserMutation.isPending}
            >
              {deleteUserMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Jobs Tab ─────────────────────────────────────────────────────────────────

function JobsTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [confirmDeleteJob, setConfirmDeleteJob] = useState<Job | null>(null);

  const { data: jobs, isLoading, refetch, isFetching } = useQuery<Job[]>({
    queryKey: ["/api/admin/jobs"],
  });

  const deleteJobMutation = useMutation({
    mutationFn: (jobId: string) => apiRequest("DELETE", `/api/admin/jobs/${jobId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setConfirmDeleteJob(null);
      toast({ title: "Job deleted" });
    },
    onError: () => toast({ title: "Failed to delete job", variant: "destructive" }),
  });

  const filtered = (jobs ?? []).filter((j) => {
    const matchesSearch = j.url.toLowerCase().includes(search.toLowerCase()) || j.id.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || j.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            data-testid="input-job-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by URL or job ID…"
            className="w-full pl-9 pr-9 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-9" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-jobs"
          className="h-9"
        >
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        <ScrollArea className="max-h-[560px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Job ID</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">URL</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Priority</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-4 py-3" colSpan={7}><Skeleton className="h-5 w-full" /></td>
                    </tr>
                  ))
                : filtered.length === 0
                ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                        No jobs found
                      </td>
                    </tr>
                  )
                : filtered.map((job) => (
                    <tr key={job.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`row-job-${job.id}`}>
                      <td className="px-4 py-3">
                        <code className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {job.id.slice(0, 8)}…
                        </code>
                      </td>
                      <td className="px-4 py-3 max-w-[220px]">
                        <div className="flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate text-xs text-foreground" title={job.url}>{job.url}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground capitalize">{job.priority}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground">
                          {job.userId ? `#${job.userId}` : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                          data-testid={`button-delete-job-${job.id}`}
                          onClick={() => setConfirmDeleteJob(job)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </ScrollArea>
      </div>

      {/* Delete confirm dialog */}
      <Dialog open={!!confirmDeleteJob} onOpenChange={() => setConfirmDeleteJob(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" /> Delete Job
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete job <code className="bg-muted px-1 rounded text-xs">{confirmDeleteJob?.id.slice(0, 8)}</code>?
            <br />URL: <span className="text-foreground">{confirmDeleteJob?.url}</span>
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteJob(null)}>Cancel</Button>
            <Button
              variant="destructive"
              data-testid="button-confirm-delete-job"
              onClick={() => confirmDeleteJob && deleteJobMutation.mutate(confirmDeleteJob.id)}
              disabled={deleteJobMutation.isPending}
            >
              {deleteJobMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ stats }: { stats: AdminStats | undefined; isLoading: boolean }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* User stats */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Users</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Users" value={stats.totalUsers} icon={Users} colorClass="bg-primary/10 text-primary" />
          <StatCard label="Free Plan" value={stats.planCounts.free ?? 0} icon={TrendingUp} colorClass="bg-muted text-muted-foreground" />
          <StatCard label="Pro Plan" value={stats.planCounts.pro ?? 0} icon={TrendingUp} colorClass="bg-primary/10 text-primary" />
          <StatCard label="Business Plan" value={stats.planCounts.business ?? 0} icon={Crown} colorClass="bg-amber-500/10 text-amber-600 dark:text-amber-400" />
        </div>
      </div>

      {/* Job stats */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Jobs</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Jobs" value={stats.totalJobs} icon={Briefcase} colorClass="bg-blue-500/10 text-blue-600 dark:text-blue-400" />
          <StatCard label="Completed" value={stats.jobStatusCounts.completed ?? 0} icon={CheckCircle2} colorClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
          <StatCard label="Failed" value={stats.jobStatusCounts.failed ?? 0} icon={XCircle} colorClass="bg-red-500/10 text-red-600 dark:text-red-400" />
          <StatCard label="Pending / Processing" value={(stats.jobStatusCounts.pending ?? 0) + (stats.jobStatusCounts.processing ?? 0)} icon={Clock} colorClass="bg-amber-500/10 text-amber-600 dark:text-amber-400" />
        </div>
      </div>

      {/* Success rate */}
      {stats.totalJobs > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Job Success Rate</h3>
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
              <div
                className="bg-emerald-500 h-3 rounded-full transition-all"
                style={{ width: `${Math.round(((stats.jobStatusCounts.completed ?? 0) / stats.totalJobs) * 100)}%` }}
              />
            </div>
            <span className="text-sm font-semibold text-foreground w-12 text-right" data-testid="text-success-rate">
              {Math.round(((stats.jobStatusCounts.completed ?? 0) / stats.totalJobs) * 100)}%
            </span>
          </div>
          <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {stats.jobStatusCounts.completed ?? 0} completed</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> {stats.jobStatusCounts.failed ?? 0} failed</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> {(stats.jobStatusCounts.pending ?? 0) + (stats.jobStatusCounts.processing ?? 0)} active</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Admin Page ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user, isLoading: authLoading } = useAuth();

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: !!user?.isAdmin,
    refetchInterval: 30_000,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Redirect to="/auth" />;
  if (!user.isAdmin) return <Redirect to="/dashboard" />;

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Admin Panel</h1>
            <p className="text-sm text-muted-foreground">Platform management and monitoring</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview">
          <TabsList className="h-9">
            <TabsTrigger value="overview" data-testid="tab-overview" className="text-sm">Overview</TabsTrigger>
            <TabsTrigger value="users" data-testid="tab-users" className="text-sm">Users</TabsTrigger>
            <TabsTrigger value="jobs" data-testid="tab-jobs" className="text-sm">Jobs</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <OverviewTab stats={stats} isLoading={statsLoading} />
          </TabsContent>

          <TabsContent value="users" className="mt-4">
            <UsersTab />
          </TabsContent>

          <TabsContent value="jobs" className="mt-4">
            <JobsTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
