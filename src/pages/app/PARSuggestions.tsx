import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, Minus, BellRing, BarChart3, RefreshCw } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PARSuggestion {
  item_name: string;
  category: string | null;
  unit: string | null;
  current_par: number;
  suggested_par: number;
  change_amount: number;
  change_pct: number;
  avg_daily_usage: number;
  reason: string;
  confidence: "high" | "medium" | "low";
  data_source: "usage_events" | "inventory_sessions" | "orders";
}

// ─── Computation helpers ──────────────────────────────────────────────────────
function roundToStep(val: number, step = 0.1): number {
  return Math.round(val / step) * step;
}

function confidenceLevel(usageDays: number, dataSource: string): "high" | "medium" | "low" {
  if (dataSource === "usage_events" && usageDays >= 14) return "high";
  if (dataSource === "usage_events" && usageDays >= 7) return "medium";
  if (dataSource === "inventory_sessions") return "medium";
  return "low";
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PARSuggestionsPage() {
  const { currentRestaurant, locations, currentLocation } = useRestaurant();
  const { user } = useAuth();

  const [lists, setLists] = useState<any[]>([]);
  const [parGuides, setParGuides] = useState<any[]>([]);
  const [parSettings, setParSettings] = useState<any>(null);

  const [selectedList, setSelectedList] = useState("all");
  const [selectedGuide, setSelectedGuide] = useState("all");
  const [lookback, setLookback] = useState("30");
  const [coverageDays, setCoverageDays] = useState("7");
  const [leadTimeDays, setLeadTimeDays] = useState("2");

  const [suggestions, setSuggestions] = useState<PARSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [notifying, setNotifying] = useState(false);

  const isManagerPlus = currentRestaurant?.role === "OWNER" || currentRestaurant?.role === "MANAGER";

  // Load lists + PAR settings
  useEffect(() => {
    if (!currentRestaurant) return;
    supabase.from("inventory_lists").select("id, name").eq("restaurant_id", currentRestaurant.id)
      .then(({ data }) => { if (data) setLists(data); });
    supabase.from("par_settings").select("*").eq("restaurant_id", currentRestaurant.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setParSettings(data);
          setLeadTimeDays(String(data.default_lead_time_days ?? 2));
        }
      });
  }, [currentRestaurant]);

  // Load PAR guides when list changes
  useEffect(() => {
    if (!currentRestaurant || selectedList === "all") { setParGuides([]); setSelectedGuide("all"); return; }
    supabase.from("par_guides").select("id, name").eq("restaurant_id", currentRestaurant.id).eq("inventory_list_id", selectedList)
      .then(({ data }) => { if (data) setParGuides(data); setSelectedGuide("all"); });
  }, [selectedList, currentRestaurant]);

  // ─── Computation ─────────────────────────────────────────────────────────
  const generateSuggestions = useCallback(async () => {
    if (!currentRestaurant) return;
    setLoading(true);
    setGenerated(false);
    setSelectedItems(new Set());

    const coverageNum = parseFloat(coverageDays) || 7;
    const leadTimeNum = parseFloat(leadTimeDays) || 2;
    const lookbackDays = parseInt(lookback);
    const since = new Date();
    since.setDate(since.getDate() - lookbackDays);

    // 1. Load current PAR items from selected guide(s)
    let parQuery = supabase.from("par_guide_items")
      .select("item_name, par_level, category, unit, par_guides!inner(inventory_list_id, restaurant_id)");

    if (selectedGuide !== "all") {
      parQuery = parQuery.eq("par_guide_id", selectedGuide);
    } else if (selectedList !== "all") {
      parQuery = parQuery.eq("par_guides.inventory_list_id", selectedList);
    } else {
      parQuery = parQuery.eq("par_guides.restaurant_id", currentRestaurant.id);
    }

    const { data: parItems } = await parQuery;

    if (!parItems || parItems.length === 0) {
      toast.error("No PAR guide items found for the selected filters.");
      setLoading(false);
      return;
    }

    // Deduplicate by item_name (take latest/max par)
    const parMap: Record<string, { par_level: number; category: string | null; unit: string | null }> = {};
    for (const p of parItems) {
      const key = p.item_name.trim().toLowerCase();
      if (!parMap[key] || p.par_level > parMap[key].par_level) {
        parMap[key] = { par_level: Number(p.par_level), category: p.category, unit: p.unit };
      }
    }

    // 2. Try usage_events first
    const { data: usageEvents } = await supabase
      .from("usage_events")
      .select("item_name, quantity_used, created_at")
      .eq("restaurant_id", currentRestaurant.id)
      .gte("created_at", since.toISOString());

    // Build usage map from events
    const usageByItem: Record<string, { total: number; dataSource: "usage_events" | "inventory_sessions" | "orders" }> = {};

    if (usageEvents && usageEvents.length > 0) {
      for (const e of usageEvents) {
        const key = e.item_name.trim().toLowerCase();
        if (!usageByItem[key]) usageByItem[key] = { total: 0, dataSource: "usage_events" };
        usageByItem[key].total += Number(e.quantity_used);
      }
    }

    // 3. Fallback: infer from approved sessions
    const itemsWithNoUsage = Object.keys(parMap).filter(k => !usageByItem[k]);
    if (itemsWithNoUsage.length > 0) {
      // Get approved sessions within lookback
      const { data: sessions } = await supabase
        .from("inventory_sessions")
        .select("id, approved_at")
        .eq("restaurant_id", currentRestaurant.id)
        .eq("status", "APPROVED")
        .gte("approved_at", since.toISOString())
        .order("approved_at", { ascending: true });

      if (sessions && sessions.length >= 2) {
        // Pair consecutive sessions: usage = stock difference between sessions
        for (let i = 1; i < sessions.length; i++) {
          const [s1, s2] = [sessions[i - 1], sessions[i]];
          const [{ data: i1 }, { data: i2 }] = await Promise.all([
            supabase.from("inventory_session_items").select("item_name, current_stock").eq("session_id", s1.id),
            supabase.from("inventory_session_items").select("item_name, current_stock").eq("session_id", s2.id),
          ]);
          const map1 = Object.fromEntries((i1 || []).map(x => [x.item_name.trim().toLowerCase(), Number(x.current_stock)]));
          for (const item of i2 || []) {
            const key = item.item_name.trim().toLowerCase();
            const prev = map1[key];
            if (prev !== undefined) {
              const used = prev - Number(item.current_stock);
              if (used > 0) {
                if (!usageByItem[key]) usageByItem[key] = { total: 0, dataSource: "inventory_sessions" };
                usageByItem[key].total += used;
                if (usageByItem[key].dataSource === "orders") usageByItem[key].dataSource = "inventory_sessions";
              }
            }
          }
        }
      }
    }

    // 4. Build suggestions
    const result: PARSuggestion[] = [];

    for (const [itemKey, parData] of Object.entries(parMap)) {
      const usage = usageByItem[itemKey];
      if (!usage || usage.total <= 0) continue;

      const avgDaily = usage.total / lookbackDays;
      const suggested = roundToStep(avgDaily * (coverageNum + leadTimeNum));
      const currentPar = parData.par_level;
      const changeAmt = suggested - currentPar;
      const changePct = currentPar > 0 ? (changeAmt / currentPar) * 100 : 100;

      // Only include if meaningful change
      if (Math.abs(changeAmt) < 0.5 && Math.abs(changePct) < 10) continue;

      // Find display name (first item in parItems that matches)
      const displayItem = parItems.find(p => p.item_name.trim().toLowerCase() === itemKey);

      result.push({
        item_name: displayItem?.item_name || itemKey,
        category: parData.category,
        unit: parData.unit,
        current_par: currentPar,
        suggested_par: suggested,
        change_amount: changeAmt,
        change_pct: changePct,
        avg_daily_usage: avgDaily,
        reason: `Avg ${avgDaily.toFixed(2)}/day × (${coverageNum}d coverage + ${leadTimeNum}d lead time)`,
        confidence: confidenceLevel(lookbackDays, usage.dataSource),
        data_source: usage.dataSource,
      });
    }

    // Sort by abs % change descending
    result.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
    setSuggestions(result);
    setGenerated(true);
    setLoading(false);

    if (result.length === 0) {
      toast.info("No significant PAR changes suggested based on the current data.");
    }
  }, [currentRestaurant, selectedList, selectedGuide, lookback, coverageDays, leadTimeDays]);

  // ─── Notify ──────────────────────────────────────────────────────────────
  const handleNotify = async () => {
    if (!currentRestaurant || !user) return;
    setNotifying(true);

    const selected = suggestions.filter(s => selectedItems.has(s.item_name));
    const allSuggestions = selectedItems.size === 0 ? suggestions : selected;
    const majorCount = allSuggestions.filter(s => Math.abs(s.change_pct) >= 20).length;
    const severity: "WARNING" | "INFO" = majorCount > 0 ? "WARNING" : "INFO";

    // Find recipients: get notification preferences
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("*, restaurant_id")
      .eq("restaurant_id", currentRestaurant.id);

    // Get members based on recipients_mode
    const { data: members } = await supabase
      .from("restaurant_members")
      .select("user_id, role")
      .eq("restaurant_id", currentRestaurant.id);

    const recipientUserIds: string[] = [];
    const pref = prefs?.[0];
    const mode = pref?.recipients_mode ?? "OWNERS_MANAGERS";
    const inAppEnabled = pref?.channel_in_app ?? true;

    if (!inAppEnabled) {
      toast.info("In-app notifications are disabled in Alert Settings.");
      setNotifying(false);
      return;
    }

    if (mode === "ALL") {
      (members || []).forEach(m => recipientUserIds.push(m.user_id));
    } else {
      // OWNERS_MANAGERS (default) or CUSTOM (fall back to owners/managers)
      (members || []).forEach(m => {
        if (m.role === "OWNER" || m.role === "MANAGER") recipientUserIds.push(m.user_id);
      });
    }

    const topItems = allSuggestions.slice(0, 5).map(s => s.item_name);
    const notifData = {
      restaurant_id: currentRestaurant.id,
      count_changed: allSuggestions.length,
      count_major: majorCount,
      top_items: topItems,
      list_id: selectedList !== "all" ? selectedList : null,
    };

    const notifications = recipientUserIds.map(uid => ({
      restaurant_id: currentRestaurant.id,
      user_id: uid,
      type: "PAR_SUGGESTIONS",
      title: "PAR update suggestions ready",
      message: `${allSuggestions.length} item${allSuggestions.length !== 1 ? "s" : ""} suggested${majorCount > 0 ? ` (${majorCount} major)` : ""}. Review in Reports → PAR Suggestions.`,
      severity,
      data: notifData,
    }));

    const { error } = await supabase.from("notifications").insert(notifications);
    if (error) {
      toast.error(`Failed to send notifications: ${error.message}`);
    } else {
      toast.success(`Notified ${recipientUserIds.length} team member${recipientUserIds.length !== 1 ? "s" : ""}`);
    }
    setNotifying(false);
  };

  // ─── Selection helpers ────────────────────────────────────────────────────
  const toggleItem = (name: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedItems.size === suggestions.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(suggestions.map(s => s.item_name)));
    }
  };

  // ─── Badges ──────────────────────────────────────────────────────────────
  const confidenceBadge = (c: string) => {
    if (c === "high") return <Badge className="bg-success/15 text-success border-success/30 border text-[10px]">High</Badge>;
    if (c === "medium") return <Badge className="bg-warning/15 text-warning border-warning/30 border text-[10px]">Medium</Badge>;
    return <Badge className="bg-muted text-muted-foreground text-[10px]">Low</Badge>;
  };

  const changeIcon = (amt: number) => {
    if (amt > 0.5) return <TrendingUp className="h-3.5 w-3.5 text-success" />;
    if (amt < -0.5) return <TrendingDown className="h-3.5 w-3.5 text-destructive" />;
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  // ─── Summary metrics ──────────────────────────────────────────────────────
  const majorChanges = suggestions.filter(s => Math.abs(s.change_pct) >= 20);
  const increases = suggestions.filter(s => s.change_amount > 0);
  const decreases = suggestions.filter(s => s.change_amount < 0);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">PAR Suggestions</h1>
          <p className="page-description">AI-powered PAR level recommendations based on actual usage data</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <div className="space-y-1.5">
              <Label className="text-xs">Inventory List</Label>
              <Select value={selectedList} onValueChange={setSelectedList}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Lists</SelectItem>
                  {lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">PAR Guide</Label>
              <Select value={selectedGuide} onValueChange={setSelectedGuide} disabled={selectedList === "all"}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Guides</SelectItem>
                  {parGuides.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Lookback Window</Label>
              <Select value={lookback} onValueChange={setLookback}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="14">Last 14 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="60">Last 60 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Coverage Days</Label>
              <Select value={coverageDays} onValueChange={setCoverageDays}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 days</SelectItem>
                  <SelectItem value="5">5 days</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Lead Time (days)</Label>
              <Select value={leadTimeDays} onValueChange={setLeadTimeDays}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0 days</SelectItem>
                  <SelectItem value="1">1 day</SelectItem>
                  <SelectItem value="2">2 days</SelectItem>
                  <SelectItem value="3">3 days</SelectItem>
                  <SelectItem value="5">5 days</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              onClick={generateSuggestions}
              disabled={loading}
              className="bg-gradient-amber shadow-amber gap-2"
              size="sm"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Generating…" : "Generate Suggestions"}
            </Button>
            {generated && suggestions.length > 0 && isManagerPlus && (
              <Button
                onClick={handleNotify}
                disabled={notifying}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <BellRing className="h-3.5 w-3.5" />
                {notifying ? "Notifying…" : `Notify (${selectedItems.size > 0 ? selectedItems.size : suggestions.length})`}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      )}

      {/* Summary KPIs */}
      {generated && suggestions.length > 0 && !loading && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <BarChart3 className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-lg font-bold leading-tight">{suggestions.length}</p>
                  <p className="text-[11px] text-muted-foreground">Suggested Changes</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-destructive/15">
              <CardContent className="flex items-center gap-3 p-4">
                <TrendingUp className="h-5 w-5 text-destructive" />
                <div>
                  <p className="text-lg font-bold leading-tight text-destructive">{majorChanges.length}</p>
                  <p className="text-[11px] text-muted-foreground">Major Changes (≥20%)</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-success/15">
              <CardContent className="flex items-center gap-3 p-4">
                <TrendingUp className="h-5 w-5 text-success" />
                <div>
                  <p className="text-lg font-bold leading-tight text-success">{increases.length}</p>
                  <p className="text-[11px] text-muted-foreground">PAR Increases</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <TrendingDown className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-lg font-bold leading-tight">{decreases.length}</p>
                  <p className="text-[11px] text-muted-foreground">PAR Decreases</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Suggestions table */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Suggested PAR Changes
              </CardTitle>
              {isManagerPlus && (
                <span className="text-[11px] text-muted-foreground">
                  {selectedItems.size > 0 ? `${selectedItems.size} selected` : "Select items to notify selectively"}
                </span>
              )}
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  {isManagerPlus && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedItems.size === suggestions.length && suggestions.length > 0}
                        onCheckedChange={toggleAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                  )}
                  <TableHead className="text-xs font-semibold">Item</TableHead>
                  <TableHead className="text-xs font-semibold">Category</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Current PAR</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Suggested PAR</TableHead>
                  <TableHead className="text-xs font-semibold text-center">Change</TableHead>
                  <TableHead className="text-xs font-semibold text-center">Confidence</TableHead>
                  <TableHead className="text-xs font-semibold hidden md:table-cell">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suggestions.map((s) => (
                  <TableRow key={s.item_name} className={`hover:bg-muted/20 transition-colors ${Math.abs(s.change_pct) >= 20 ? "bg-warning/5" : ""}`}>
                    {isManagerPlus && (
                      <TableCell>
                        <Checkbox
                          checked={selectedItems.has(s.item_name)}
                          onCheckedChange={() => toggleItem(s.item_name)}
                          aria-label={`Select ${s.item_name}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium text-sm">{s.item_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.category || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">{s.current_par}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">{s.suggested_par.toFixed(1)}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        {changeIcon(s.change_amount)}
                        <span className={`text-xs font-medium ${s.change_amount > 0 ? "text-success" : s.change_amount < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {s.change_amount > 0 ? "+" : ""}{s.change_amount.toFixed(1)} ({s.change_pct.toFixed(0)}%)
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">{confidenceBadge(s.confidence)}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground hidden md:table-cell max-w-xs truncate">{s.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {/* Empty state after generation */}
      {generated && suggestions.length === 0 && !loading && (
        <Card>
          <CardContent className="empty-state py-16">
            <BarChart3 className="empty-state-icon" />
            <p className="empty-state-title">No significant PAR changes suggested</p>
            <p className="empty-state-description">
              Current PAR levels appear to be aligned with usage data. Try adjusting the lookback window or coverage days.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Initial state */}
      {!generated && !loading && (
        <Card>
          <CardContent className="empty-state py-16">
            <TrendingUp className="empty-state-icon" />
            <p className="empty-state-title">Generate PAR Suggestions</p>
            <p className="empty-state-description">
              Select your filters and click "Generate Suggestions" to analyze usage data and recommend PAR level changes.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
