import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, CreditCard, Zap } from "lucide-react";
import { PLAN_CONFIG, type PlanType, type Subscription } from "@shared/schema";

const plans: PlanType[] = ["free", "pro", "business"];

function UsageMeter({ used, limit }: { used: number; limit: number }) {
  const pct = limit >= 999999 ? 0 : Math.min((used / limit) * 100, 100);
  const isUnlimited = limit >= 999999;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{used} jobs used this month</span>
        <span>{isUnlimited ? "Unlimited" : `${limit} limit`}</span>
      </div>
      {!isUnlimited && (
        <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct > 85 ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function SubscriptionPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: sub, isLoading } = useQuery<Subscription>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const [pendingPlan, setPendingPlan] = useState<PlanType | null>(null);

  const upgradeMutation = useMutation({
    mutationFn: (plan: PlanType) => {
      setPendingPlan(plan);
      return apiRequest("POST", "/api/subscription/upgrade", { plan });
    },
    onSuccess: async (res) => {
      const updated = await res.json();
      queryClient.setQueryData(["/api/subscription"], updated);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Plan updated successfully" });
    },
    onError: () => toast({ title: "Failed to update plan", variant: "destructive" }),
    onSettled: () => setPendingPlan(null),
  });

  const currentPlan = (sub?.plan ?? "free") as PlanType;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold">Subscription</h1>
          <p className="text-muted-foreground mt-1">Manage your plan and usage</p>
        </div>

        {/* Current usage */}
        {isLoading ? (
          <Card className="border-card-border">
            <CardContent className="p-6 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </CardContent>
          </Card>
        ) : sub ? (
          <Card className="border-card-border">
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary" />
                Current Plan
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-lg">{PLAN_CONFIG[currentPlan].label}</p>
                  <p className="text-sm text-muted-foreground">
                    {PLAN_CONFIG[currentPlan].price === 0 ? "Free forever" : `$${PLAN_CONFIG[currentPlan].price}/month`}
                  </p>
                </div>
                <Badge variant="secondary" data-testid="badge-current-plan">{PLAN_CONFIG[currentPlan].label}</Badge>
              </div>
              <UsageMeter used={sub.jobsUsedThisMonth} limit={PLAN_CONFIG[currentPlan].jobLimit} />
              <p className="text-xs text-muted-foreground">
                Usage resets on {new Date(sub.resetAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {/* Plan cards */}
        <div>
          <h2 className="text-base font-semibold mb-4">Change Plan</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {plans.map((planKey) => {
              const plan = PLAN_CONFIG[planKey];
              const isCurrent = planKey === currentPlan;
              const isPopular = planKey === "pro";
              return (
                <div
                  key={planKey}
                  className={`relative rounded-xl border p-5 flex flex-col ${isCurrent ? "border-primary" : isPopular ? "border-primary/30" : "border-border"} bg-card`}
                  data-testid={`card-plan-${planKey}`}
                >
                  {isCurrent && (
                    <div className="absolute -top-3 left-4">
                      <Badge className="bg-primary text-primary-foreground text-xs">Current</Badge>
                    </div>
                  )}
                  <div className="mb-4">
                    <h3 className="font-bold mb-1">{plan.label}</h3>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold">${plan.price}</span>
                      {plan.price > 0 && <span className="text-muted-foreground text-xs">/mo</span>}
                      {plan.price === 0 && <span className="text-muted-foreground text-xs">free</span>}
                    </div>
                  </div>
                  <ul className="space-y-2 flex-1 mb-4">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    size="sm"
                    variant={isCurrent ? "secondary" : "default"}
                    disabled={isCurrent || upgradeMutation.isPending}
                    onClick={() => upgradeMutation.mutate(planKey)}
                    data-testid={`button-select-plan-${planKey}`}
                  >
                    {pendingPlan === planKey ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : isCurrent ? (
                      "Current plan"
                    ) : planKey === "free" ? (
                      "Downgrade"
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        Upgrade
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
