import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { CheckCircle, XCircle, Eye, ClipboardCheck, MoreHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

function getRisk(currentStock: number, parLevel: number | null | undefined): { label: string; bgClass: string; textClass: string; color: string } {
  if (parLevel === null || parLevel === undefined || parLevel <= 0) {
    return { label: "No PAR", color: "gray", bgClass: "bg-muted/60", textClass: "text-muted-foreground" };
  }
  const ratio = currentStock / parLevel;
  if (ratio >= 1.0) return { label: "Low", color: "green", bgClass: "bg-success/10", textClass: "text-success" };
  if (ratio > 0.5) return { label: "Medium", color: "yellow", bgClass: "bg-warning/10", textClass: "text-warning" };
  return { label: "High", color: "red", bgClass: "bg-destructive/10", textClass: "text-destructive" };
}

export default function ReviewPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<any[]>([]);
  const [viewItems, setViewItems] = useState<any[] | null>(null);
  const [viewSession, setViewSession] = useState<any>(null);
  const [localItems, setLocalItems] = useState<Record<string, number>>({});
  const [showExceptionsOnly, setShowExceptionsOnly] = useState(true);

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
        const ratio = parLevel > 0 ? currentStock / parLevel : null;
        const risk = ratio === null ? "GREEN" : ratio < 0.5 ? "RED" : ratio < 1.0 ? "YELLOW" : "GREEN";
        const suggestedOrder = parLevel > 0 ? Math.max(0, parLevel - currentStock) : 0;
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
          // Default to exceptions-only if there are exceptions
          const hasExceptions = enriched.some(item => {
            const r = getRisk(Number(item.current_stock), parMap[item.item_name] ?? null);
            return r.label === "High" || r.label === "Medium";
          });
          setShowExceptionsOnly(hasExceptions);
          return;
        }
      }
    }
    
    setViewItems((data || []).map(item => ({ ...item, approved_par: null })));
    setViewSession(session);
    setShowExceptionsOnly(false);
  };

  const getLocalStock = (item: any) =>
    localItems[item.id] !== undefined ? localItems[item.id] : Number(item.current_stock);

  const handleStockBlur = async (itemId: string, val: number) => {
    await supabase.from("inventory_session_items")
      .update({ current_stock: val })
      .eq("id", itemId);
  };

  const isManagerOrOwner = currentRestaurant?.role === "OWNER" || currentRestaurant?.role === "MANAGER";

  // Risk summary for viewed items
  const viewRiskSummary = viewItems
    ? viewItems.reduce((acc, item) => {
        const risk = getRisk(Number(item.current_stock), item.approved_par);
        acc[risk.color] = (acc[risk.color] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    : null;

  // Total suggested order (sum of all "need" values)
  const totalSuggestedOrder = viewItems
    ? viewItems.reduce((sum, item) => {
        const stock = getLocalStock(item);
        const par = item.approved_par;
        if (par && par > 0) return sum + Math.max(0, par - stock);
        return sum;
      }, 0)
    : 0;

  // Filtered items for display
  const displayedItems = (() => {
    if (!viewItems) return null;
    if (!showExceptionsOnly) return viewItems;
    const exceptions = viewItems.filter(item => {
      const risk = getRisk(Number(item.current_stock), item.approved_par);
      return risk.label === "High" || risk.label === "Medium";
    });
    // Fallback: if no exceptions, show all
    return exceptions.length > 0 ? exceptions : viewItems;
  })();

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

      {/* Review Dialog — Exception-first */}
      <Dialog open={!!viewItems} onOpenChange={() => { setViewItems(null); setViewSession(null); setLocalItems({}); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          {/* Dialog header with Approve button */}
          <DialogHeader className="shrink-0">
            <div className="flex items-start justify-between gap-3">
              <DialogTitle className="text-base">{viewSession?.name} — Review</DialogTitle>
              {isManagerOrOwner && viewSession && (
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    className="bg-success hover:bg-success/90 text-success-foreground gap-1.5 h-8 text-xs"
                    onClick={() => handleApprove(viewSession.id)}
                  >
                    <CheckCircle className="h-3.5 w-3.5" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="gap-1.5 h-8 text-xs"
                    onClick={() => handleReject(viewSession.id)}
                  >
                    <XCircle className="h-3.5 w-3.5" /> Send back
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>

          {/* Risk summary cards */}
          {viewRiskSummary && (
            <div className="grid grid-cols-4 gap-2 shrink-0">
              <div className="rounded-lg bg-destructive/10 p-2.5 text-center">
                <p className="text-base font-bold text-destructive">{viewRiskSummary.red || 0}</p>
                <p className="text-[10px] font-medium text-destructive uppercase tracking-wide">High</p>
              </div>
              <div className="rounded-lg bg-warning/10 p-2.5 text-center">
                <p className="text-base font-bold text-warning">{viewRiskSummary.yellow || 0}</p>
                <p className="text-[10px] font-medium text-warning uppercase tracking-wide">Medium</p>
              </div>
              <div className="rounded-lg bg-success/10 p-2.5 text-center">
                <p className="text-base font-bold text-success">{viewRiskSummary.green || 0}</p>
                <p className="text-[10px] font-medium text-success uppercase tracking-wide">Low</p>
              </div>
              <div className="rounded-lg bg-muted/60 p-2.5 text-center">
                <p className="text-base font-bold text-muted-foreground">{viewRiskSummary.gray || 0}</p>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">No PAR</p>
              </div>
            </div>
          )}

          {/* Totals + filter toggles */}
          <div className="flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${showExceptionsOnly ? "bg-destructive/10 text-destructive border border-destructive/20" : "bg-muted/60 text-muted-foreground hover:bg-muted"}`}
                onClick={() => setShowExceptionsOnly(true)}
              >Exceptions only</button>
              <button
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${!showExceptionsOnly ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"}`}
                onClick={() => setShowExceptionsOnly(false)}
              >Show all</button>
            </div>
            {totalSuggestedOrder > 0 && (
              <p className="text-xs text-muted-foreground">
                Total need: <span className="font-semibold text-foreground">{totalSuggestedOrder % 1 === 0 ? totalSuggestedOrder : totalSuggestedOrder.toFixed(1)} units</span>
              </p>
            )}
          </div>

          {/* Scrollable table */}
          <div className="rounded-lg border overflow-hidden overflow-y-auto flex-1">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 sticky top-0">
                  <TableHead className="text-xs font-semibold">Item</TableHead>
                  <TableHead className="text-xs font-semibold">Category</TableHead>
                  <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                  <TableHead className="text-xs font-semibold">Stock</TableHead>
                  <TableHead className="text-xs font-semibold">PAR</TableHead>
                  <TableHead className="text-xs font-semibold">Risk</TableHead>
                  <TableHead className="text-xs font-semibold">Suggested Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedItems?.map(item => {
                  const stock = getLocalStock(item);
                  const risk = getRisk(stock, item.approved_par);
                  const suggestedOrder = item.approved_par != null && item.approved_par > 0
                    ? Math.max(0, item.approved_par - stock)
                    : null;
                  return (
                    <TableRow key={item.id} className={risk.bgClass}>
                      <TableCell className="text-sm font-medium">{item.item_name}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px] font-normal">{item.category}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.pack_size || "—"}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={0.1}
                          className="w-20 h-7 text-sm font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {item.approved_par !== null && item.approved_par !== undefined ? item.approved_par : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${risk.bgClass} ${risk.textClass} border-0 text-[10px]`}>
                          {risk.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {suggestedOrder !== null ? suggestedOrder.toFixed(1) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
