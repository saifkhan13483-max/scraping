import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Zap, LayoutDashboard, CreditCard, Key, LogOut, ChevronRight, Menu, X } from "lucide-react";
import { useState } from "react";
import type { PlanType } from "@shared/schema";
import { PLAN_CONFIG } from "@shared/schema";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/subscription", label: "Subscription", icon: CreditCard },
  { href: "/api-keys", label: "API Keys", icon: Key },
];

function PlanBadge({ plan }: { plan: PlanType }) {
  const cfg = PLAN_CONFIG[plan];
  const colorMap: Record<PlanType, string> = {
    free: "bg-muted text-muted-foreground",
    pro: "bg-primary/10 text-primary",
    business: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorMap[plan]}`}>
      {cfg.label}
    </span>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const plan = (user?.subscription?.plan ?? "free") as PlanType;

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-56 bg-sidebar border-r border-sidebar-border flex flex-col
        transition-transform duration-200
        ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0 lg:static lg:flex
      `}>
        {/* Logo */}
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-border shrink-0">
          <div className="p-1.5 rounded-lg bg-sidebar-primary/10">
            <Zap className="w-4 h-4 text-sidebar-primary" />
          </div>
          <span className="font-semibold text-sm text-sidebar-foreground">ScraperCloud</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = location === href;
            return (
              <Link key={href} href={href}>
                <span
                  onClick={() => setMobileOpen(false)}
                  data-testid={`nav-${label.toLowerCase().replace(" ", "-")}`}
                  className={`
                    flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full cursor-pointer
                    ${active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    }
                  `}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                  {active && <ChevronRight className="w-3 h-3 ml-auto opacity-50" />}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-sidebar-border shrink-0">
          {user && (
            <div className="px-3 py-2 rounded-lg bg-sidebar-accent/30 mb-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-sidebar-foreground truncate">{user.name}</p>
                <PlanBadge plan={plan} />
              </div>
              <p className="text-xs text-sidebar-foreground/50 truncate">{user.email}</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
            onClick={() => logout()}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="h-14 border-b border-border flex items-center px-4 gap-3 lg:hidden bg-card/50 backdrop-blur-sm sticky top-0 z-20">
          <Button size="icon" variant="ghost" onClick={() => setMobileOpen(!mobileOpen)} data-testid="button-mobile-menu">
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">ScraperCloud</span>
          </div>
        </header>

        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
