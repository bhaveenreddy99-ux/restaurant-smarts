import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { CheckCircle, XCircle, Eye, ClipboardCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

  const handleApprove = async (sessionId: string) => {
    const { error } = await supabase.from("inventory_sessions").update({
      status: "APPROVED",
      approved_at: new Date().toISOString(),
      approved_by: user?.id,
      updated_at: new Date().toISOString(),
    }).eq("id", sessionId);
    if (error) toast.error(error.message);
    else { toast.success("Session approved!"); fetchSessions(); }
  };

  const handleReject = async (sessionId: string) => {
    const { error } = await supabase.from("inventory_sessions").update({
      status: "IN_PROGRESS",
      updated_at: new Date().toISOString(),
    }).eq("id", sessionId);
    if (error) toast.error(error.message);
    else { toast.success("Session sent back"); fetchSessions(); }
  };

  const handleView = async (session: any) => {
    const { data } = await supabase.from("inventory_session_items").select("*").eq("session_id", session.id);
    
    // Load PAR guide values for risk preview
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

  const isManagerOrOwner = currentRestaurant?.role === "OWNER" || currentRestaurant?.role === "MANAGER";

  // Risk summary for viewed items
  const viewRiskSummary = viewItems
    ? viewItems.reduce((acc, item) => {
        const risk = getRisk(Number(item.current_stock), item.approved_par);
        acc[risk.color] = (acc[risk.color] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    : null;

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
        <div className="space-y-3">
          {sessions.map(s => (
            <Card key={s.id} className="hover:shadow-card transition-all duration-200">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold text-sm">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{s.inventory_lists?.name} • {new Date(s.updated_at).toLocaleDateString()}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleView(s)} className="gap-1.5 h-8 text-xs">
                    <Eye className="h-3.5 w-3.5" /> View
                  </Button>
                  {isManagerOrOwner && (
                    <>
                      <Button size="sm" onClick={() => handleApprove(s.id)} className="bg-success hover:bg-success/90 gap-1.5 h-8 text-xs">
                        <CheckCircle className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleReject(s.id)} className="gap-1.5 h-8 text-xs">
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!viewItems} onOpenChange={() => { setViewItems(null); setViewSession(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{viewSession?.name} — Items</DialogTitle></DialogHeader>
          
          {/* Risk summary preview */}
          {viewRiskSummary && (
            <div className="grid grid-cols-4 gap-2 mb-2">
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

          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-semibold">Item</TableHead>
                  <TableHead className="text-xs font-semibold">Category</TableHead>
                  <TableHead className="text-xs font-semibold">Stock</TableHead>
                  <TableHead className="text-xs font-semibold">PAR</TableHead>
                  <TableHead className="text-xs font-semibold">Risk</TableHead>
                  <TableHead className="text-xs font-semibold">Suggested Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewItems?.map(item => {
                  const risk = getRisk(Number(item.current_stock), item.approved_par);
                  const suggestedOrder = item.approved_par != null && item.approved_par > 0
                    ? Math.max(0, item.approved_par - Number(item.current_stock))
                    : null;
                  return (
                    <TableRow key={item.id} className={risk.bgClass}>
                      <TableCell className="text-sm font-medium">{item.item_name}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px] font-normal">{item.category}</Badge></TableCell>
                      <TableCell className="font-mono text-sm">{item.current_stock}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {item.approved_par !== null ? item.approved_par : "—"}
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
