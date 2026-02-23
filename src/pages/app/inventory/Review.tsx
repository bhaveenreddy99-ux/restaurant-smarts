import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  CheckCircle, XCircle, Eye, ClipboardCheck, MoreHorizontal,
  ArrowLeft, Search, ChevronDown, ChevronRight,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  getRisk, formatNum, computeRiskLevel, computeOrderQty, formatCurrency,
} from "@/lib/inventory-utils";
import ItemIdentityBlock from "@/components/ItemIdentityBlock";
import { useLastOrderDates } from "@/hooks/useLastOrderDates";
import { format } from "date-fns";

type FilterTab = "all" | "critical" | "low" | "ok" | "nopar";

export default function ReviewPage() {
  const { currentRestaurant, currentLocation } = useRestaurant();
  const { user } = useAuth();
  const { lastOrderDates } = useLastOrderDates(currentRestaurant?.id, currentLocation?.id);
  const [sessions, setSessions] = useState<any[]>([]);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [viewItems, setViewItems] = useState<any[] | null>(null);
  const [viewSession, setViewSession] = useState<any>(null);
  const [localItems, setLocalItems] = useState<Record<string, number>>({});
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const fetchSessions = async () => {
    if (!currentRestaurant) return;
    const { data } = await supabase
      .from("inventory_sessions")
      .select("*, inventory_lists(name)")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("status", "IN_REVIEW")
      .order("updated_at", { ascending: false });
    if (data) setSessions(data);
  };

  useEffect(() => { fetchSessions(); }, [currentRestaurant]);

  useEffect(() => {
    if (!currentRestaurant) return;
    supabase.from("inventory_catalog_items")
      .select("id, item_name, product_number, vendor_sku")
      .eq("restaurant_id", currentRestaurant.id)
      .then(({ data }) => { if (data) setCatalogItems(data); });
  }, [currentRestaurant]);

  const autoCreateSmartOrder = async (sessionId: string, restaurantId: string, userId: string) => {
    try {
      const { data: session } = await supabase.from("inventory_sessions").select("*").eq("id", sessionId).single();
      if (!session) return;
      const { data: sessionItems } = await supabase.from("inventory_session_items").select("*").eq("session_id", sessionId);
      if (!sessionItems || sessionItems.length === 0) return;

      const { data: latestGuide } = await supabase.from("par_guides").select("id")
        .eq("restaurant_id", restaurantId).eq("inventory_list_id", session.inventory_list_id)
        .order("updated_at", { ascending: false }).limit(1).single();

      const parMap: Record<string, number> = {};
      if (latestGuide) {
        const { data: guideItems } = await supabase.from("par_guide_items").select("item_name, par_level").eq("par_guide_id", latestGuide.id);
        (guideItems || []).forEach(p => { parMap[p.item_name] = Number(p.par_level); });
      }

      const computed = sessionItems.map(i => {
        const parLevel = parMap[i.item_name] ?? Number(i.par_level);
        const currentStock = Number(i.current_stock ?? 0);
        const risk = computeRiskLevel(currentStock, parLevel);
        const suggestedOrder = computeOrderQty(currentStock, parLevel, i.unit, i.pack_size);
        return { ...i, parLevel, currentStock, risk, suggestedOrder };
      });

      const redCount = computed.filter(i => i.risk === "RED").length;
      const yellowCount = computed.filter(i => i.risk === "YELLOW").length;

      const { data: run, error: runError } = await supabase.from("smart_order_runs").insert({
        restaurant_id: restaurantId,
        session_id: sessionId,
        inventory_list_id: session.inventory_list_id,
        par_guide_id: latestGuide?.id || null,
        created_by: userId,
      }).select().single();
      if (runError || !run) return;

      const runItems = computed.map(i => ({
        run_id: run.id,
        item_name: i.item_name,
        suggested_order: i.suggestedOrder,
        risk: i.risk,
        current_stock: i.currentStock,
        par_level: i.parLevel,
        unit_cost: i.unit_cost || null,
        pack_size: i.pack_size || null,
      }));
      await supabase.from("smart_order_run_items").insert(runItems);

      if (redCount > 0 || yellowCount > 0) {
        const { data: prefs } = await supabase.from("notification_preferences")
          .select("*, alert_recipients(user_id)").eq("restaurant_id", restaurantId).eq("channel_in_app", true).limit(1).single();
        if (prefs) {
          const { data: members } = await supabase.from("restaurant_members").select("user_id, role").eq("restaurant_id", restaurantId);
          let targetUserIds: string[] = [];
          if (prefs.recipients_mode === "OWNERS_MANAGERS") targetUserIds = (members || []).filter(m => m.role === "OWNER" || m.role === "MANAGER").map(m => m.user_id);
          else if (prefs.recipients_mode === "ALL") targetUserIds = (members || []).map(m => m.user_id);
          else if (prefs.recipients_mode === "CUSTOM") targetUserIds = (prefs.alert_recipients || []).map((r: any) => r.user_id);
          if (targetUserIds.length > 0) {
            const notifications = targetUserIds.map(uid => ({
              restaurant_id: restaurantId,
              user_id: uid,
              type: "LOW_STOCK",
              severity: (redCount > 0 ? "CRITICAL" : "WARNING") as "CRITICAL" | "WARNING",
              title: `Inventory Approved — ${redCount + yellowCount} item${redCount + yellowCount > 1 ? "s" : ""} need attention`,
              message: `${redCount} high risk, ${yellowCount} medium risk items detected`,
              data: { session_id: sessionId, run_id: run.id, red: redCount, yellow: yellowCount } as any,
            }));
            await supabase.from("notifications").insert(notifications);
          }
        }
      }
    } catch (err) {
      console.error("Auto smart order error:", err);
    }
  };

  const handleApprove = async (sessionId: string) => {
    const { error } = await supabase.from("inventory_sessions").update({
      status: "APPROVED",
      approved_at: new Date().toISOString(),
      approved_by: user?.id,
      updated_at: new Date().toISOString(),
    }).eq("id", sessionId);
    if (error) { toast.error(error.message); return; }

    if (currentRestaurant && user) {
      await autoCreateSmartOrder(sessionId, currentRestaurant.id, user.id);
    }

    toast.success("Session approved!");
    if (viewSession?.id === sessionId) {
      setViewItems(null);
      setViewSession(null);
      setLocalItems({});
    }
    fetchSessions();
  };

  const handleReject = async (sessionId: string) => {
    const { error } = await supabase.from("inventory_sessions").update({
      status: "IN_PROGRESS",
      updated_at: new Date().toISOString(),
    }).eq("id", sessionId);
    if (error) toast.error(error.message);
    else {
      toast.success("Session sent back");
      if (viewSession?.id === sessionId) { setViewItems(null); setViewSession(null); setLocalItems({}); }
      fetchSessions();
    }
  };

  const handleView = async (session: any) => {
    setLocalItems({});
    setActiveFilter("all");
    setSearchQuery("");
    setCollapsedCategories(new Set());
    const { data } = await supabase.from("inventory_session_items").select("*").eq("session_id", session.id);

    if (currentRestaurant) {
      const { data: guides } = await supabase
        .from("par_guides")
        .select("id")
        .eq("restaurant_id", currentRestaurant.id)
        .eq("inventory_list_id", session.inventory_list_id);

      if (guides && guides.length > 0) {
        const guideIds = guides.map(g => g.id);
        const { data: parData } = await supabase
          .from("par_guide_items")
          .select("item_name, par_level")
          .in("par_guide_id", guideIds);

        if (parData) {
          const parMap: Record<string, number> = {};
          parData.forEach(p => { parMap[p.item_name] = Number(p.par_level); });

          const enriched = (data || []).map(item => ({
            ...item,
            approved_par: parMap[item.item_name] ?? null,
          }));
          setViewItems(enriched);
          setViewSession(session);
          return;
        }
      }
    }

    setViewItems((data || []).map(item => ({ ...item, approved_par: null })));
    setViewSession(session);
  };

  const handleStockBlur = async (itemId: string, val: number) => {
    await supabase.from("inventory_session_items")
      .update({ current_stock: val })
      .eq("id", itemId);
  };

  const isManagerOrOwner = currentRestaurant?.role === "OWNER" || currentRestaurant?.role === "MANAGER";

  const riskCounts = useMemo(() => {
    if (!viewItems) return { critical: 0, low: 0, ok: 0, nopar: 0 };
    return viewItems.reduce((acc, item) => {
      const risk = getRisk(Number(item.current_stock), item.approved_par);
      if (risk.level === "RED") acc.critical++;
      else if (risk.level === "YELLOW") acc.low++;
      else if (risk.level === "GREEN") acc.ok++;
      else acc.nopar++;
      return acc;
    }, { critical: 0, low: 0, ok: 0, nopar: 0 });
  }, [viewItems]);

  const filteredItems = useMemo(() => {
    if (!viewItems) return [];
    let items = viewItems;

    if (activeFilter !== "all") {
      items = items.filter(item => {
        const risk = getRisk(Number(item.current_stock), item.approved_par);
        if (activeFilter === "critical") return risk.level === "RED";
        if (activeFilter === "low") return risk.level === "YELLOW";
        if (activeFilter === "ok") return risk.level === "GREEN";
        if (activeFilter === "nopar") return risk.level === "NO_PAR";
        return true;
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(item =>
        item.item_name.toLowerCase().includes(q) ||
        (item.category || "").toLowerCase().includes(q) ||
        (item.pack_size || "").toLowerCase().includes(q)
      );
    }

    return items;
  }, [viewItems, activeFilter, searchQuery]);

  const groupedByCategory = useMemo(() => {
    const groups: Record<string, any[]> = {};
    filteredItems.forEach(item => {
      const cat = item.category || "Uncategorized";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredItems]);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const riskBadge = (risk: ReturnType<typeof getRisk>) => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Badge className={`${risk.bgClass} ${risk.textClass} border-0 text-[10px] font-medium`}>
            {risk.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent><p className="text-xs">{risk.tooltip}</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  if (viewItems && viewSession) {
    return (
      <div className="flex flex-col animate-fade-in">
        <div className="sticky top-0 z-20 bg-background border-b shrink-0">
          <div className="flex items-center justify-between px-4 py-3 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => {
                setViewItems(null);
                setViewSession(null);
                setLocalItems({});
              }}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <h1 className="text-lg font-bold tracking-tight truncate">{viewSession.name}</h1>
                <p className="text-xs text-muted-foreground truncate">
                  {viewSession.inventory_lists?.name} · {new Date(viewSession.updated_at).toLocaleDateString()}
                </p>
              </div>
            </div>
            {isManagerOrOwner && (
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  className="bg-success hover:bg-success/90 text-success-foreground gap-1.5 h-9 text-xs"
                  onClick={() => handleApprove(viewSession.id)}
                >
                  <CheckCircle className="h-3.5 w-3.5" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="gap-1.5 h-9 text-xs"
                  onClick={() => handleReject(viewSession.id)}
                >
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2 px-4 pb-3">
            <div className="rounded-lg bg-destructive/10 p-2.5 text-center">
              <p className="text-lg font-bold text-destructive">{riskCounts.critical}</p>
              <p className="text-[10px] font-medium text-destructive uppercase tracking-wide">Critical</p>
            </div>
            <div className="rounded-lg bg-warning/10 p-2.5 text-center">
              <p className="text-lg font-bold text-warning">{riskCounts.low}</p>
              <p className="text-[10px] font-medium text-warning uppercase tracking-wide">Low</p>
            </div>
            <div className="rounded-lg bg-success/10 p-2.5 text-center">
              <p className="text-lg font-bold text-success">{riskCounts.ok}</p>
              <p className="text-[10px] font-medium text-success uppercase tracking-wide">OK</p>
            </div>
            <div className="rounded-lg bg-muted/60 p-2.5 text-center">
              <p className="text-lg font-bold text-muted-foreground">{riskCounts.nopar}</p>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">No PAR</p>
            </div>
          </div>

          <div className="flex items-center gap-3 px-4 pb-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search items..."
                className="pl-9 h-9"
              />
            </div>
            <Tabs value={activeFilter} onValueChange={v => setActiveFilter(v as FilterTab)}>
              <TabsList className="h-9">
                <TabsTrigger value="all" className="text-xs px-3">All</TabsTrigger>
                <TabsTrigger value="critical" className="text-xs px-3">Critical</TabsTrigger>
                <TabsTrigger value="low" className="text-xs px-3">Low</TabsTrigger>
                <TabsTrigger value="ok" className="text-xs px-3">OK</TabsTrigger>
                <TabsTrigger value="nopar" className="text-xs px-3">No PAR</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        <div>
          {filteredItems.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              No items match the current filter.
            </div>
          ) : (
            groupedByCategory.map(([category, items]) => {
              const isCollapsed = collapsedCategories.has(category);
              return (
                <Collapsible key={category} open={!isCollapsed} onOpenChange={() => toggleCategory(category)}>
                  <CollapsibleTrigger className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b hover:bg-muted/60 transition-colors cursor-pointer">
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category}</span>
                    <Badge variant="secondary" className="text-[10px] ml-1">{items.length}</Badge>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/20">
                          <TableHead className="text-xs font-semibold">Item</TableHead>
                          <TableHead className="text-xs font-semibold">Product #</TableHead>
                          <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                          <TableHead className="text-xs font-semibold">Last Ordered</TableHead>
                          <TableHead className="text-xs font-semibold text-right">On Hand</TableHead>
                          <TableHead className="text-xs font-semibold text-right">PAR</TableHead>
                          <TableHead className="text-xs font-semibold text-right">Need</TableHead>
                          <TableHead className="text-xs font-semibold">Risk</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map(item => {
                          const stock = localItems[item.id] !== undefined ? localItems[item.id] : Number(item.current_stock);
                          const risk = getRisk(stock, item.approved_par);
                          const need = item.approved_par != null && item.approved_par > 0
                            ? computeOrderQty(stock, item.approved_par, item.unit, item.pack_size)
                            : null;
                          return (
                            <TableRow key={item.id} className="min-h-[56px]">
                              <TableCell className="text-sm font-medium py-3">
                                <span>{item.item_name}</span>
                                <ItemIdentityBlock
                                  brandName={item.brand_name}
                                  className="block mt-0.5"
                                />
                              </TableCell>
                              <TableCell className="text-xs font-mono text-muted-foreground/60 py-3">{item.vendor_sku || "—"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground py-3">{item.pack_size || "—"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground py-3">
                                {(() => {
                                  const catalogItem = catalogItems.find(ci => ci.item_name === item.item_name);
                                  const dateStr = catalogItem ? lastOrderDates[catalogItem.id] : null;
                                  return dateStr ? format(new Date(dateStr), "MM/dd/yy") : "—";
                                })()}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm py-3">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step={0.1}
                                  className="w-20 h-8 text-sm font-mono text-right ml-auto [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  value={localItems[item.id] !== undefined ? localItems[item.id] : item.current_stock}
                                  onFocus={(e) => e.target.select()}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value) || 0;
                                    setLocalItems(prev => ({ ...prev, [item.id]: v }));
                                  }}
                                  onBlur={(e) => {
                                    const v = parseFloat(e.target.value) || 0;
                                    handleStockBlur(item.id, v);
                                  }}
                                />
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm text-muted-foreground py-3">
                                {item.approved_par != null ? formatNum(item.approved_par) : "—"}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm font-bold py-3">
                                {need !== null && need > 0 ? formatNum(need) : "—"}
                              </TableCell>
                              <TableCell className="py-3">
                                {riskBadge(risk)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Review Inventory</h1>
          <p className="page-description">Approve or reject submitted inventory counts</p>
        </div>
        {sessions.length > 0 && <Badge variant="secondary" className="text-xs">{sessions.length} pending</Badge>}
      </div>

      {sessions.length === 0 ? (
        <Card>
          <CardContent className="empty-state">
            <ClipboardCheck className="empty-state-icon" />
            <p className="empty-state-title">No sessions pending review</p>
            <p className="empty-state-description">Sessions submitted by staff will appear here for approval.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden divide-y">
          {sessions.map(s => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/20 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{s.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {s.inventory_lists?.name} · {new Date(s.updated_at).toLocaleDateString()}
                </p>
              </div>
              <Badge className="bg-primary/10 text-primary border-0 text-[10px] shrink-0">In Review</Badge>
              <Button size="sm" className="h-8 text-xs gap-1.5 shrink-0" onClick={() => handleView(s)}>
                <Eye className="h-3 w-3" /> Review
              </Button>
              {isManagerOrOwner && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleApprove(s.id)}>
                      <CheckCircle className="h-3.5 w-3.5 mr-2 text-success" /> Approve
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => handleReject(s.id)}>
                      <XCircle className="h-3.5 w-3.5 mr-2" /> Send back
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
