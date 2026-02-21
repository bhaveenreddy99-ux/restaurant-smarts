import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Package, AlertTriangle, TrendingUp, TrendingDown, ShoppingCart, ArrowUpRight,
  Building2, Bell, DollarSign, BarChart3, Sparkles, ChevronDown,
  ClipboardCheck, Clock, CheckCircle2, AlertCircle, Zap, ArrowRight,
  Shield, Users, CalendarDays, FileText, Activity
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ParAlertsBanner from "@/components/ParAlertsBanner";

// ─── Command Bar ───
function CommandBar({
  timeFilter,
  setTimeFilter,
  onStartInventory,
}: {
  timeFilter: string;
  setTimeFilter: (v: string) => void;
  onStartInventory: () => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl bg-card border border-border/60 shadow-sm">
      <div className="flex items-center gap-3">
        <Select value={timeFilter} onValueChange={setTimeFilter}>
          <SelectTrigger className="w-[160px] h-9 text-xs font-medium bg-background">
            <CalendarDays className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="this_week">This Week</SelectItem>
            <SelectItem value="last_week">Last Week</SelectItem>
            <SelectItem value="30_days">Last 30 Days</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        onClick={onStartInventory}
        className="bg-gradient-orange text-white shadow-orange hover:opacity-90 transition-opacity h-9 px-5 text-xs font-semibold"
      >
        <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" />
        Start Inventory
      </Button>
    </div>
  );
}

// ─── KPI Card ───
function KpiCard({
  icon: Icon,
  label,
  value,
  change,
  changeLabel,
  accent,
}: {
  icon: any;
  label: string;
  value: string;
  change?: number;
  changeLabel?: string;
  accent: "destructive" | "warning" | "success" | "primary";
}) {
  const accentMap = {
    destructive: {
      bg: "bg-destructive/8",
      text: "text-destructive",
      border: "border-destructive/10",
    },
    warning: {
      bg: "bg-warning/8",
      text: "text-warning",
      border: "border-warning/10",
    },
    success: {
      bg: "bg-success/8",
      text: "text-success",
      border: "border-success/10",
    },
    primary: {
      bg: "bg-primary/8",
      text: "text-primary",
      border: "border-primary/10",
    },
  };
  const a = accentMap[accent];

  return (
    <Card className={`${a.border} hover:shadow-md transition-all duration-200`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${a.bg}`}>
            <Icon className={`h-5 w-5 ${a.text}`} />
          </div>
          {change !== undefined && (
            <div className={`flex items-center gap-0.5 text-[11px] font-semibold ${change >= 0 ? "text-success" : "text-destructive"}`}>
              {change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(change)}%
            </div>
          )}
        </div>
        <div className="mt-3">
          <p className="text-2xl font-bold tracking-tight font-display">{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        </div>
        {changeLabel && (
          <p className="text-[11px] text-muted-foreground/70 mt-1">{changeLabel}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Action Center ───
function ActionCenter({
  criticalCount,
  pendingApprovals,
  missingInventory,
  parChanges,
  navigate,
}: {
  criticalCount: number;
  pendingApprovals: number;
  missingInventory: number;
  parChanges: number;
  navigate: (path: string) => void;
}) {
  const items = [
    {
      icon: AlertTriangle,
      label: `${criticalCount} Critical Items Below PAR`,
      color: "text-destructive",
      bg: "bg-destructive/6",
      path: "/app/smart-order",
      show: criticalCount > 0,
    },
    {
      icon: ClipboardCheck,
      label: `${missingInventory} Location${missingInventory !== 1 ? "s" : ""} Missing Weekly Inventory`,
      color: "text-warning",
      bg: "bg-warning/6",
      path: "/app/inventory/enter",
      show: missingInventory > 0,
    },
    {
      icon: Clock,
      label: `${pendingApprovals} Pending Order Approval${pendingApprovals !== 1 ? "s" : ""}`,
      color: "text-primary",
      bg: "bg-primary/6",
      path: "/app/orders",
      show: pendingApprovals > 0,
    },
    {
      icon: Activity,
      label: `${parChanges} PAR Levels Changed Significantly`,
      color: "text-warning",
      bg: "bg-warning/6",
      path: "/app/par",
      show: parChanges > 0,
    },
  ].filter((i) => i.show);

  return (
    <Card className="hover:shadow-md transition-all duration-200">
      <div className="flex items-center gap-2 p-5 pb-3">
        <Bell className="h-4 w-4 text-warning" />
        <h3 className="text-sm font-bold tracking-tight">Needs Attention</h3>
        {items.length > 0 && (
          <Badge variant="secondary" className="text-[10px] ml-1 h-5">{items.length}</Badge>
        )}
      </div>
      <CardContent className="pt-0 pb-4 px-5">
        {items.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-success/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">All clear</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">No actions needed right now</p>
          </div>
        ) : (
          <div className="space-y-1">
            {items.map((item, i) => (
              <button
                key={i}
                onClick={() => navigate(item.path)}
                className="w-full flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/40 transition-colors text-left group"
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.bg}`}>
                  <item.icon className={`h-4 w-4 ${item.color}`} />
                </div>
                <span className="text-sm font-medium flex-1">{item.label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Smart Order Preview ───
function SmartOrderPreview({
  topReorder,
  navigate,
}: {
  topReorder: any[];
  navigate: (path: string) => void;
}) {
  const riskBadge = (ratio: number) => {
    if (ratio < 0.5) return <Badge variant="destructive" className="text-[10px] font-medium w-12 justify-center">LOW</Badge>;
    if (ratio < 1) return <Badge className="bg-warning text-warning-foreground text-[10px] font-medium w-12 justify-center">MED</Badge>;
    return <Badge className="bg-success text-success-foreground text-[10px] font-medium w-12 justify-center">OK</Badge>;
  };

  return (
    <Card className="hover:shadow-md transition-all duration-200">
      <div className="flex items-center justify-between p-5 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold tracking-tight">AI Smart Order Suggestions</h3>
        </div>
        {topReorder.length > 0 && (
          <Button
            onClick={() => navigate("/app/smart-order")}
            className="bg-gradient-orange text-white shadow-orange hover:opacity-90 h-8 px-4 text-xs font-semibold"
          >
            Generate Smart Order
          </Button>
        )}
      </div>
      <CardContent className="pt-0 pb-4 px-5">
        {topReorder.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/6 mb-4">
              <Sparkles className="h-7 w-7 text-primary/40" />
            </div>
            <p className="text-sm font-semibold text-muted-foreground">No smart orders yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1 max-w-[280px]">
              Complete and approve an inventory count to unlock AI-powered reorder suggestions based on your PAR levels and usage trends.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 text-xs h-8"
              onClick={() => navigate("/app/inventory/enter")}
            >
              Start Your First Count
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Item</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">On Hand</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">PAR</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Order Qty</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-center">Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topReorder.slice(0, 5).map((item, i) => (
                  <TableRow key={i} className="hover:bg-muted/20">
                    <TableCell className="text-sm font-medium">{item.item_name}</TableCell>
                    <TableCell className="text-sm text-right font-mono">{item.current_stock}</TableCell>
                    <TableCell className="text-sm text-right font-mono text-muted-foreground">{item.par_level}</TableCell>
                    <TableCell className="text-sm text-right font-mono font-semibold">{item.suggestedOrder}</TableCell>
                    <TableCell className="text-center">{riskBadge(item.ratio)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Usage & Trend Analytics ───
function AnalyticsSection({ highUsage }: { highUsage: any[] }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* High Usage Items */}
      <Card className="hover:shadow-md transition-all duration-200">
        <div className="flex items-center gap-2 p-5 pb-3">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold tracking-tight">High Usage Items</h3>
        </div>
        <CardContent className="pt-0 pb-4 px-5">
          {highUsage.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground/15 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No usage data yet</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Create orders to start tracking usage.</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {highUsage.map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-mono text-muted-foreground/50 w-4">{i + 1}</span>
                    <span className="text-sm font-medium">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-semibold">{item.total}</span>
                    <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                      {item.count}×
                    </span>
                    <TrendingUp className="h-3 w-3 text-success/60" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Inventory Value Trend */}
      <Card className="hover:shadow-md transition-all duration-200">
        <div className="flex items-center gap-2 p-5 pb-3">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold tracking-tight">Inventory Value Trend</h3>
        </div>
        <CardContent className="pt-0 pb-4 px-5">
          <div className="flex flex-col items-center py-8 text-center">
            <div className="w-full h-32 flex items-end justify-between gap-1.5 px-2">
              {[65, 72, 58, 80, 74, 90, 85, 88].map((h, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-md bg-primary/15 hover:bg-primary/25 transition-colors"
                    style={{ height: `${h}%` }}
                  />
                  <span className="text-[9px] text-muted-foreground/50 font-mono">
                    W{i + 1}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground/50 mt-3">Weekly inventory value (last 8 weeks)</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── AI Insights Panel ───
function AiInsights() {
  const insights = [
    { text: "Mozzarella usage increased 18% this week.", icon: TrendingUp, color: "text-success" },
    { text: "Location #3 may be over-ordering cooking oil.", icon: AlertCircle, color: "text-warning" },
    { text: "PAR for French Fries may be too high based on recent trends.", icon: Activity, color: "text-primary" },
  ];

  return (
    <Card className="border-primary/10 hover:shadow-md transition-all duration-200">
      <div className="flex items-center gap-2 p-5 pb-3">
        <Zap className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold tracking-tight">AI Insights</h3>
        <Badge className="bg-primary/10 text-primary text-[10px] ml-1 h-5 border-0">Beta</Badge>
      </div>
      <CardContent className="pt-0 pb-4 px-5">
        <div className="space-y-1">
          {insights.map((insight, i) => (
            <div key={i} className="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors">
              <insight.icon className={`h-4 w-4 mt-0.5 shrink-0 ${insight.color}`} />
              <p className="text-sm leading-relaxed">{insight.text}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Multi-Location Section ───
function MultiLocationView({ restaurants, navigate, setCurrentRestaurant }: { restaurants: any[]; navigate: any; setCurrentRestaurant: any }) {
  const sorted = useMemo(() => {
    return [...restaurants].sort((a, b) => b.red - a.red);
  }, [restaurants]);

  const maxValue = Math.max(...restaurants.map((r) => r.red + r.yellow + r.green), 1);

  return (
    <div className="space-y-5">
      {/* Location Performance */}
      <Card className="hover:shadow-md transition-all duration-200">
        <div className="flex items-center gap-2 p-5 pb-3">
          <Building2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold tracking-tight">Location Performance</h3>
        </div>
        <CardContent className="pt-0 pb-5 px-5">
          {restaurants.length === 0 ? (
            <div className="empty-state py-8">
              <Building2 className="empty-state-icon h-8 w-8" />
              <p className="empty-state-title">No restaurants found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sorted.map((r) => {
                const total = r.red + r.yellow + r.green;
                const redPct = (r.red / Math.max(total, 1)) * 100;
                const yellowPct = (r.yellow / Math.max(total, 1)) * 100;
                const greenPct = (r.green / Math.max(total, 1)) * 100;
                const barWidth = (total / maxValue) * 100;

                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      setCurrentRestaurant({ id: r.id, name: r.name, role: r.role });
                      navigate("/app/dashboard");
                    }}
                    className="w-full flex items-center gap-4 py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors text-left group"
                  >
                    <span className="text-sm font-medium w-36 truncate">{r.name}</span>
                    <div className="flex-1 h-5 rounded-full bg-muted/30 overflow-hidden">
                      <div className="h-full flex" style={{ width: `${barWidth}%` }}>
                        {redPct > 0 && <div className="h-full bg-destructive/80" style={{ width: `${redPct}%` }} />}
                        {yellowPct > 0 && <div className="h-full bg-warning/80" style={{ width: `${yellowPct}%` }} />}
                        {greenPct > 0 && <div className="h-full bg-success/80" style={{ width: `${greenPct}%` }} />}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono shrink-0">
                      <span className="text-destructive">{r.red}</span>
                      <span className="text-warning">{r.yellow}</span>
                      <span className="text-success">{r.green}</span>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-foreground transition-colors shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Store Ranking */}
      <Card className="hover:shadow-md transition-all duration-200">
        <div className="flex items-center gap-2 p-5 pb-3">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold tracking-tight">Store Ranking</h3>
        </div>
        <CardContent className="pt-0 pb-4 px-5">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20 hover:bg-muted/20">
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Restaurant</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-center">Critical</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-center">Low</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-center">Orders</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Last Approved</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow
                  key={r.id}
                  className="hover:bg-muted/20 cursor-pointer transition-colors"
                  onClick={() => {
                    setCurrentRestaurant({ id: r.id, name: r.name, role: r.role });
                    navigate("/app/dashboard");
                  }}
                >
                  <TableCell className="font-medium text-sm">{r.name}</TableCell>
                  <TableCell className="text-center">
                    {r.red > 0 ? <Badge variant="destructive" className="text-[10px]">{r.red}</Badge> : <span className="text-muted-foreground text-xs">0</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    {r.yellow > 0 ? <Badge className="bg-warning text-warning-foreground text-[10px]">{r.yellow}</Badge> : <span className="text-muted-foreground text-xs">0</span>}
                  </TableCell>
                  <TableCell className="text-center text-sm font-mono">{r.recentOrders}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.lastApproved ? new Date(r.lastApproved).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    {r.red === 0 && r.yellow === 0 ? (
                      <Badge className="bg-success/10 text-success text-[10px] border-0">Best</Badge>
                    ) : r.red > 2 ? (
                      <Badge className="bg-destructive/10 text-destructive text-[10px] border-0">Needs Attention</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">OK</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Portfolio Dashboard (All Restaurants) ───
function PortfolioDashboard({ setCurrentRestaurant }: { setCurrentRestaurant: (r: any) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState("this_week");
  const navigate = useNavigate();

  useEffect(() => {
    const fetchPortfolio = async () => {
      setLoading(true);
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) { setLoading(false); return; }
      try {
        const res = await supabase.functions.invoke("portfolio-dashboard");
        if (res.data) setData(res.data);
      } catch (e) {
        console.error("Portfolio fetch error:", e);
      }
      setLoading(false);
    };
    fetchPortfolio();
  }, []);

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <Skeleton className="h-14 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
        <div className="grid gap-5 lg:grid-cols-2">{[1, 2].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
      </div>
    );
  }

  const totals = data?.totals || { red: 0, yellow: 0, green: 0 };
  const restaurants = data?.restaurants || [];
  const totalItems = totals.red + totals.yellow + totals.green;
  const totalOrders = restaurants.reduce((s: number, r: any) => s + (r.recentOrders || 0), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight font-display">Portfolio Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{restaurants.length} location{restaurants.length !== 1 ? "s" : ""} · Overview</p>
        </div>
      </div>

      <CommandBar
        timeFilter={timeFilter}
        setTimeFilter={setTimeFilter}
        onStartInventory={() => navigate("/app/inventory/enter")}
      />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Package} label="Total Items Tracked" value={totalItems.toLocaleString()} accent="primary" />
        <KpiCard icon={AlertTriangle} label="At Risk Items" value={totals.red + totals.yellow} change={-5} changeLabel="vs last period" accent="destructive" />
        <KpiCard icon={DollarSign} label="Waste Exposure" value="$—" changeLabel="Based on overstock" accent="warning" />
        <KpiCard icon={ShoppingCart} label="Smart Order Ready" value={`${totalOrders} orders`} accent="success" />
      </div>

      {/* Action Center + AI Insights */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ActionCenter
          criticalCount={totals.red}
          pendingApprovals={0}
          missingInventory={0}
          parChanges={0}
          navigate={navigate}
        />
        <AiInsights />
      </div>

      {/* Multi-Location Section */}
      <MultiLocationView restaurants={restaurants} navigate={navigate} setCurrentRestaurant={setCurrentRestaurant} />
    </div>
  );
}

// ─── Single Restaurant Dashboard ───
function SingleDashboard() {
  const { currentRestaurant, currentLocation } = useRestaurant();
  const navigate = useNavigate();
  const [stockStatus, setStockStatus] = useState({ red: 0, yellow: 0, green: 0 });
  const [topReorder, setTopReorder] = useState<any[]>([]);
  const [highUsage, setHighUsage] = useState<any[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState("this_week");

  useEffect(() => {
    if (!currentRestaurant) return;
    const fetchData = async () => {
      setLoading(true);
      const rid = currentRestaurant.id;

      let sessionQuery = supabase
        .from("inventory_sessions")
        .select("id")
        .eq("restaurant_id", rid)
        .eq("status", "APPROVED")
        .order("approved_at", { ascending: false })
        .limit(1);

      if (currentLocation) {
        sessionQuery = sessionQuery.eq("location_id", currentLocation.id);
      }

      const { data: sessions } = await sessionQuery;

      if (sessions && sessions.length > 0) {
        const { data: items } = await supabase
          .from("inventory_session_items")
          .select("*")
          .eq("session_id", sessions[0].id);

        if (items) {
          let r = 0, y = 0, g = 0;
          const reorderList = items.map(i => {
            const ratio = i.current_stock / Math.max(i.par_level, 1);
            if (ratio < 0.5) r++;
            else if (ratio < 1) y++;
            else g++;
            return { ...i, suggestedOrder: Math.max(i.par_level - i.current_stock, 0), ratio };
          });
          setStockStatus({ red: r, yellow: y, green: g });
          setTopReorder(reorderList.sort((a, b) => b.suggestedOrder - a.suggestedOrder).slice(0, 8));
        }
      } else {
        setStockStatus({ red: 0, yellow: 0, green: 0 });
        setTopReorder([]);
      }

      const { data: usage } = await supabase
        .from("usage_events")
        .select("item_name, quantity_used")
        .eq("restaurant_id", rid);

      if (usage) {
        const grouped: Record<string, { total: number; count: number }> = {};
        usage.forEach(u => {
          if (!grouped[u.item_name]) grouped[u.item_name] = { total: 0, count: 0 };
          grouped[u.item_name].total += Number(u.quantity_used);
          grouped[u.item_name].count++;
        });
        setHighUsage(Object.entries(grouped).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total).slice(0, 8));
      }

      let ordersQuery = supabase.from("orders").select("*").eq("restaurant_id", rid).order("created_at", { ascending: false }).limit(8);
      if (currentLocation) ordersQuery = ordersQuery.eq("location_id", currentLocation.id);
      const { data: orders } = await ordersQuery;
      if (orders) setRecentOrders(orders);
      setLoading(false);
    };
    fetchData();
  }, [currentRestaurant, currentLocation]);

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <Skeleton className="h-14 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
        <div className="grid gap-5 lg:grid-cols-2">{[1, 2].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
      </div>
    );
  }

  const totalItems = stockStatus.red + stockStatus.yellow + stockStatus.green;
  const pendingOrders = recentOrders.filter(o => o.status === "PENDING").length;

  // Estimate reorder value
  const reorderValue = topReorder.reduce((sum, item) => {
    const cost = item.unit_cost || 0;
    return sum + item.suggestedOrder * cost;
  }, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <ParAlertsBanner />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight font-display">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {currentRestaurant?.name}
            {currentLocation ? ` · ${currentLocation.name}` : ""}
          </p>
        </div>
      </div>

      <CommandBar
        timeFilter={timeFilter}
        setTimeFilter={setTimeFilter}
        onStartInventory={() => navigate("/app/inventory/enter")}
      />

      {/* Executive KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={DollarSign}
          label="Inventory Value"
          value={totalItems > 0 ? `${totalItems} items` : "$0"}
          change={3}
          changeLabel="vs last period"
          accent="primary"
        />
        <KpiCard
          icon={AlertTriangle}
          label="At Risk Items"
          value={`${stockStatus.red + stockStatus.yellow}`}
          accent="destructive"
          changeLabel={`${stockStatus.red} critical · ${stockStatus.yellow} low`}
        />
        <KpiCard
          icon={Package}
          label="Waste Exposure"
          value="$—"
          accent="warning"
          changeLabel="Estimated overstock value"
        />
        <KpiCard
          icon={ShoppingCart}
          label="Smart Order Ready"
          value={reorderValue > 0 ? `$${reorderValue.toFixed(0)}` : "$0"}
          accent="success"
          changeLabel="Suggested reorder value"
        />
      </div>

      {/* Action Center + Smart Order */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ActionCenter
          criticalCount={stockStatus.red}
          pendingApprovals={pendingOrders}
          missingInventory={0}
          parChanges={0}
          navigate={navigate}
        />
        <SmartOrderPreview topReorder={topReorder} navigate={navigate} />
      </div>

      {/* Usage & Trends */}
      <AnalyticsSection highUsage={highUsage} />

      {/* AI Insights */}
      <AiInsights />
    </div>
  );
}

// ─── Main Dashboard Page ───
export default function DashboardPage() {
  const { isPortfolioMode, setCurrentRestaurant } = useRestaurant();

  if (isPortfolioMode) {
    return <PortfolioDashboard setCurrentRestaurant={setCurrentRestaurant} />;
  }

  return <SingleDashboard />;
}
