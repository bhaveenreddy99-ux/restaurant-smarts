import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CheckCircle, ShoppingCart, ChevronDown, ChevronRight } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import { useNavigate } from "react-router-dom";

function getRisk(currentStock: number, parLevel: number | null | undefined): { label: string; bgClass: string; textClass: string } {
  if (parLevel === null || parLevel === undefined || parLevel <= 0) {
    return { label: "No PAR", bgClass: "bg-muted/60", textClass: "text-muted-foreground" };
  }
  const stock = currentStock ?? 0;
  if (stock <= 0) return { label: "Critical", bgClass: "bg-destructive/10", textClass: "text-destructive" };
  const ratio = stock / parLevel;
  if (ratio < 0.5) return { label: "Critical", bgClass: "bg-destructive/10", textClass: "text-destructive" };
  if (ratio < 1.0) return { label: "Low", bgClass: "bg-warning/10", textClass: "text-warning" };
  return { label: "OK", bgClass: "bg-success/10", textClass: "text-success" };
}

function formatDateTime(isoString: string) {
  const d = new Date(isoString);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return { date, time };
}

export default function ApprovedPage() {
  const { currentRestaurant } = useRestaurant();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<any[]>([]);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [sessionItems, setSessionItems] = useState<Record<string, any[]>>({});
  const [loadingSession, setLoadingSession] = useState<string | null>(null);

  useEffect(() => {
    if (!currentRestaurant) return;
    supabase
      .from("inventory_sessions")
      .select("*, inventory_lists(name)")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("status", "APPROVED")
      .order("approved_at", { ascending: false })
      .then(({ data }) => { if (data) setSessions(data); });
  }, [currentRestaurant]);

  const loadSessionItems = async (session: any) => {
    // Toggle collapse if already loaded
    if (sessionItems[session.id]) {
      setExpandedSession(prev => prev === session.id ? null : session.id);
      return;
    }

    setLoadingSession(session.id);

    const [{ data: items }, { data: guides }] = await Promise.all([
      supabase.from("inventory_session_items").select("*").eq("session_id", session.id),
      currentRestaurant
        ? supabase.from("par_guides").select("id").eq("restaurant_id", currentRestaurant.id)
            .eq("inventory_list_id", session.inventory_list_id).order("updated_at", { ascending: false }).limit(1)
        : Promise.resolve({ data: null }),
    ]);

    const parMap: Record<string, number> = {};
    if (guides && guides.length > 0) {
      const { data: parItems } = await supabase
        .from("par_guide_items")
        .select("item_name, par_level")
        .eq("par_guide_id", guides[0].id);
      (parItems || []).forEach(p => { parMap[p.item_name] = Number(p.par_level); });
    }

    const enriched = (items || []).map(item => ({
      ...item,
      approved_par: parMap[item.item_name] !== undefined ? parMap[item.item_name] : (Number(item.par_level) || null),
    }));

    setSessionItems(prev => ({ ...prev, [session.id]: enriched }));
    setExpandedSession(session.id);
    setLoadingSession(null);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Approved Inventory</h1>
          <p className="page-description">Finalized inventory sessions ready for ordering</p>
        </div>
        {sessions.length > 0 && (
          <Button size="sm" className="bg-gradient-amber shadow-amber gap-1.5" onClick={() => navigate("/app/smart-order")}>
            <ShoppingCart className="h-3.5 w-3.5" /> Create Smart Order
          </Button>
        )}
      </div>

      {sessions.length === 0 ? (
        <Card>
          <CardContent className="empty-state">
            <CheckCircle className="empty-state-icon" />
            <p className="empty-state-title">No approved sessions yet</p>
            <p className="empty-state-description">Approved inventory sessions will appear here and power Smart Order.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableBody>
              {sessions.map(s => {
                const { date, time } = formatDateTime(s.approved_at || s.updated_at);
                const isExpanded = expandedSession === s.id;
                const items = sessionItems[s.id];
                const isLoading = loadingSession === s.id;

                return (
                  <>
                    {/* Session header row */}
                    <TableRow
                      key={`header-${s.id}`}
                      className="bg-muted/20 hover:bg-muted/40 cursor-pointer transition-colors"
                      onClick={() => loadSessionItems(s)}
                    >
                      <TableCell colSpan={9} className="py-3 px-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm">{s.name}</span>
                                <Badge className="bg-success/10 text-success text-[10px] font-medium border-0">Approved</Badge>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {s.inventory_lists?.name} · {date} at {time}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                            {items && items.length > 0 && (
                              <ExportButtons
                                items={items}
                                filename={`inventory-${s.name || "export"}`}
                                type="inventory"
                                meta={{
                                  listName: s.inventory_lists?.name,
                                  sessionName: s.name,
                                  date: s.approved_at ? new Date(s.approved_at).toLocaleDateString() : undefined,
                                }}
                              />
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* Column header row when expanded */}
                    {isExpanded && (
                      <TableRow key={`cols-${s.id}`} className="bg-muted/10">
                        <TableHead className="text-xs font-semibold pl-12">Item</TableHead>
                        <TableHead className="text-xs font-semibold">Category</TableHead>
                        <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                        <TableHead className="text-xs font-semibold">Stock</TableHead>
                        <TableHead className="text-xs font-semibold">PAR</TableHead>
                        <TableHead className="text-xs font-semibold">Risk</TableHead>
                        <TableHead className="text-xs font-semibold">Suggested Order</TableHead>
                        <TableHead className="text-xs font-semibold">Unit Cost</TableHead>
                        <TableHead />
                      </TableRow>
                    )}

                    {/* Loading state */}
                    {isExpanded && isLoading && (
                      <TableRow key={`loading-${s.id}`}>
                        <TableCell colSpan={9} className="text-center py-4 text-xs text-muted-foreground pl-12">
                          Loading items…
                        </TableCell>
                      </TableRow>
                    )}

                    {/* Item rows */}
                    {isExpanded && items && items.map(item => {
                      const risk = getRisk(Number(item.current_stock), item.approved_par);
                      const suggestedOrder = item.approved_par != null && item.approved_par > 0
                        ? Math.max(0, item.approved_par - Number(item.current_stock))
                        : null;
                      return (
                        <TableRow key={item.id} className={`${risk.bgClass} border-b border-border/30`}>
                          <TableCell className="text-sm font-medium pl-12">{item.item_name}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-[10px] font-normal">{item.category || "—"}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{item.pack_size || "—"}</TableCell>
                          <TableCell className="font-mono text-sm">{Number(item.current_stock) % 1 === 0 ? Number(item.current_stock) : parseFloat(Number(item.current_stock).toFixed(2))}</TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">
                            {item.approved_par !== null && item.approved_par !== undefined ? item.approved_par : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge className={`${risk.bgClass} ${risk.textClass} border-0 text-[10px]`}>
                              {risk.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {suggestedOrder !== null ? (suggestedOrder % 1 === 0 ? suggestedOrder : parseFloat(suggestedOrder.toFixed(2))) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {item.unit_cost ? `$${Number(item.unit_cost).toFixed(2)}` : "—"}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      );
                    })}

                    {/* Empty state for session with no items */}
                    {isExpanded && items && items.length === 0 && (
                      <TableRow key={`empty-${s.id}`}>
                        <TableCell colSpan={9} className="text-center py-4 text-xs text-muted-foreground pl-12">
                          No items in this session.
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
