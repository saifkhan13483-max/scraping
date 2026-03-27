import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Key, Plus, Trash2, Copy, Loader2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ApiKey } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function NewKeyDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (key: ApiKey & { key: string }) => void }) {
  const [name, setName] = useState("");
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/keys", { name }),
    onSuccess: async (res) => {
      const key = await res.json();
      onCreated(key);
      setName("");
      queryClient.invalidateQueries({ queryKey: ["/api/keys"] });
    },
    onError: () => toast({ title: "Failed to create API key", variant: "destructive" }),
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

function RevealKeyDialog({ apiKey, open, onClose }: { apiKey: (ApiKey & { key: string }) | null; open: boolean; onClose: () => void }) {
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
              {visible ? apiKey.key : "sk_" + "•".repeat(40)}
            </div>
            <Button size="icon" variant="ghost" onClick={() => setVisible(!visible)} data-testid="button-toggle-key">
              {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(apiKey.key);
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
  const [revealKey, setRevealKey] = useState<(ApiKey & { key: string }) | null>(null);

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ["/api/keys"],
    enabled: !!user,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/keys/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/keys"] });
      toast({ title: "API key deleted" });
    },
    onError: () => toast({ title: "Failed to delete API key", variant: "destructive" }),
  });

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">API Keys</h1>
            <p className="text-muted-foreground mt-1">Authenticate your workers and external integrations</p>
          </div>
          <Button className="gap-2 shrink-0" onClick={() => setCreateOpen(true)} data-testid="button-new-key">
            <Plus className="w-4 h-4" />
            New key
          </Button>
        </div>

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
                <p className="text-xs mt-1 opacity-70">Create a key to authenticate workers and external tools</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {keys.map((k) => (
                  <div key={k.id} className="flex items-center gap-3 px-5 py-3.5" data-testid={`row-key-${k.id}`}>
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Key className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" data-testid={`text-key-name-${k.id}`}>{k.name}</p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5" data-testid={`text-key-preview-${k.id}`}>{k.key}</p>
                    </div>
                    <span className="text-xs text-muted-foreground hidden sm:block">
                      {formatDistanceToNow(new Date(k.createdAt), { addSuffix: true })}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(k.id)}
                      data-testid={`button-delete-key-${k.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-card-border">
          <CardHeader className="pb-3 pt-4 px-5">
            <CardTitle className="text-sm font-semibold">Usage</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <p className="text-sm text-muted-foreground mb-3">Authenticate API requests by passing your key in the request header:</p>
            <div className="bg-muted rounded-md p-3 font-mono text-xs text-foreground">
              x-api-key: sk_your_key_here
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
