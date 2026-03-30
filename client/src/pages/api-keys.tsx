import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Key, Plus, Trash2, Copy, Loader2, AlertCircle, Eye, EyeOff, Zap, Shield } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ApiKey, Subscription } from "@shared/schema";
import { PLAN_CONFIG } from "@shared/schema";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

type ApiKeyWithSecret = ApiKey & { secret: string };
type ApiKeyDisplay = Omit<ApiKey, "keyHash"> & { keyPrefix: string };

const SCOPE_LABELS: Record<string, { label: string; color: string }> = {
  read: { label: "Read only", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  create_jobs: { label: "Create jobs", color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  full_access: { label: "Full access", color: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
};

function NewKeyDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (key: ApiKeyWithSecret) => void;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState("full_access");
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/keys", { name, scope }),
    onSuccess: async (res) => {
      const key = await res.json();
      onCreated(key);
      setName("");
      setScope("full_access");
      queryClient.invalidateQueries({ queryKey: ["/api/keys"] });
    },
    onError: (err: unknown) => {
      let message = "Failed to create API key";
      if (err instanceof Error) {
        const match = err.message.match(/^\d+: (.+)$/);
        if (match) {
          try { message = JSON.parse(match[1]).error || message; } catch { message = match[1] || message; }
        }
      }
      toast({ title: message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Create API Key</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Key name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production Worker"
              data-testid="input-key-name"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Permissions</label>
            <Select value={scope} onValueChange={setScope} >
              <SelectTrigger data-testid="select-key-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">Read only — view jobs & results</SelectItem>
                <SelectItem value="create_jobs">Create jobs — submit & manage jobs</SelectItem>
                <SelectItem value="full_access">Full access — all permissions</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button
              className="flex-1"
              disabled={!name.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              data-testid="button-create-key"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RevealKeyDialog({ apiKey, open, onClose }: {
  apiKey: ApiKeyWithSecret | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [visible, setVisible] = useState(false);
  if (!apiKey) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertCircle className="w-4 h-4" />
            Save your API key
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            This key will only be shown once. Store it in a safe place.
          </p>
          <div className="flex gap-2">
            <div className="flex-1 bg-muted rounded-md px-3 py-2 font-mono text-xs break-all">
              {visible ? apiKey.secret : apiKey.secret.slice(0, 10) + "•".repeat(40)}
            </div>
            <Button size="icon" variant="ghost" onClick={() => setVisible(!visible)} data-testid="button-toggle-key">
              {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(apiKey.secret);
                toast({ title: "API key copied to clipboard" });
              }}
              data-testid="button-copy-key"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <Button className="w-full" onClick={onClose} data-testid="button-done-key">Done, I've saved it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ApiKeysPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealKey, setRevealKey] = useState<ApiKeyWithSecret | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  const { data: keys = [], isLoading } = useQuery<ApiKeyDisplay[]>({
    queryKey: ["/api/keys"],
    enabled: !!user,
  });

  const { data: sub } = useQuery<Subscription>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const currentPlan = (sub?.plan ?? "free") as keyof typeof PLAN_CONFIG;
  const canCreateKeys = currentPlan !== "free";

  const deleteMutation = useMutation({
    mutationFn: (id: number) => {
      setDeletingIds((prev) => new Set(prev).add(id));
      return apiRequest("DELETE", `/api/keys/${id}`);
    },
    onSuccess: (_res, id) => {
      setDeletingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      queryClient.invalidateQueries({ queryKey: ["/api/keys"] });
      toast({ title: "API key revoked" });
    },
    onError: (_err, id) => {
      setDeletingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      toast({ title: "Failed to revoke API key", variant: "destructive" });
    },
  });

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">API Keys</h1>
            <p className="text-muted-foreground mt-1">Authenticate your workers and external integrations</p>
          </div>
          <Button
            className="gap-2 shrink-0"
            onClick={() => canCreateKeys ? setCreateOpen(true) : null}
            disabled={!canCreateKeys}
            data-testid="button-new-key"
          >
            <Plus className="w-4 h-4" />
            New key
          </Button>
        </div>

        {!canCreateKeys && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">API key access requires Pro or Business</p>
              <p className="text-xs text-amber-600/80 dark:text-amber-400/70 mt-0.5">Upgrade your plan to create API keys for your workers and integrations.</p>
            </div>
            <Link href="/subscription">
              <Button size="sm" className="gap-1.5 shrink-0" data-testid="button-upgrade-api-keys">
                <Zap className="w-3.5 h-3.5" /> Upgrade
              </Button>
            </Link>
          </div>
        )}

        <Card className="border-card-border">
          <CardHeader className="pb-3 pt-4 px-5">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" />
              Your API Keys
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : keys.length === 0 ? (
              <div className="text-center py-14 text-muted-foreground">
                <Key className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium text-sm">No API keys yet</p>
                <p className="text-xs mt-1 opacity-70">
                  {canCreateKeys ? "Create a key to authenticate workers and external tools" : "Upgrade your plan to create API keys"}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {keys.map((k) => {
                  const scopeInfo = SCOPE_LABELS[k.scope ?? "full_access"] ?? SCOPE_LABELS.full_access;
                  const isExpired = k.expiresAt && new Date() > new Date(k.expiresAt);
                  return (
                    <div key={k.id} className="flex items-center gap-3 px-5 py-3.5" data-testid={`row-key-${k.id}`}>
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Key className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium" data-testid={`text-key-name-${k.id}`}>{k.name}</p>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${scopeInfo.color}`}>
                            {scopeInfo.label}
                          </span>
                          {isExpired && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0.5">Expired</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5" data-testid={`text-key-preview-${k.id}`}>
                          {k.keyPrefix}••••••••••••••••••••••••••••••••
                        </p>
                        <div className="flex gap-3 mt-0.5">
                          <p className="text-[10px] text-muted-foreground">
                            Created {formatDistanceToNow(new Date(k.createdAt), { addSuffix: true })}
                          </p>
                          {k.lastUsedAt && (
                            <p className="text-[10px] text-muted-foreground">
                              Last used {formatDistanceToNow(new Date(k.lastUsedAt), { addSuffix: true })}
                            </p>
                          )}
                          {k.expiresAt && (
                            <p className="text-[10px] text-muted-foreground">
                              {isExpired ? "Expired" : "Expires"} {formatDistanceToNow(new Date(k.expiresAt), { addSuffix: true })}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        disabled={deletingIds.has(k.id)}
                        onClick={() => deleteMutation.mutate(k.id)}
                        data-testid={`button-delete-key-${k.id}`}
                      >
                        {deletingIds.has(k.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-card-border">
          <CardHeader className="pb-3 pt-4 px-5">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              Usage & Permissions
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4 space-y-4">
            <p className="text-sm text-muted-foreground">Pass your key in the request header:</p>
            <div className="bg-muted rounded-md p-3 font-mono text-xs text-foreground">
              x-api-key: sk_your_key_here
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              {Object.entries(SCOPE_LABELS).map(([scope, info]) => (
                <div key={scope} className="rounded-lg border border-border p-3">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${info.color}`}>
                    {info.label}
                  </span>
                  <p className="text-xs text-muted-foreground mt-2">
                    {scope === "read" && "View jobs, results, and subscription info"}
                    {scope === "create_jobs" && "Submit URLs and manage your jobs"}
                    {scope === "full_access" && "All permissions including API key management"}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <NewKeyDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(key) => {
            setCreateOpen(false);
            setRevealKey(key);
          }}
        />
        <RevealKeyDialog
          apiKey={revealKey}
          open={!!revealKey}
          onClose={() => setRevealKey(null)}
        />
      </div>
    </AppLayout>
  );
}
