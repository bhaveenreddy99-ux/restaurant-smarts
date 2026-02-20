import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { ShoppingCart, DollarSign, AlertTriangle, Package, Eye, ArrowLeft, Trash2, ExternalLink } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";

export default function SmartOrderPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [runItems, setRunItems] = useState<any[]>([]);
  const [deleteRunId, setDeleteRunId] = useState<string | null>(null);

  // Filters
  const [dateFilter, setDateFilter] = useState("30");
  const [listFilter, setListFilter] = useState("all");
  const [lists, setLists] = useState<any[]>([]);

  useEffect(() => {
    if (!currentRestaurant) return;
    supabase.from("inventory_lists").select("id, name").eq("restaurant_id", currentRestaurant.id)
      .then(({ data }) => { if (data) setLists(data); });
  }, [currentRestaurant]);

  const fetchRuns = async () => {
    if (!currentRestaurant) return;
    setLoading(true);
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(dateFilter));

    let query = supabase.from("smart_order_runs")
      .select("*, inventory_lists(name), inventory_sessions(name, approved_at), par_guides(name), smart_order_run_items(id)")
      .eq("restaurant_id", currentRestaurant.id)
      .gte("created_at", daysAgo.toISOString())
      .order("created_at", { ascending: false });

    if (listFilter !== "all") {
      query = query.eq("inventory_list_id", listFilter);
    }

    const { data } = await query;
    if (data) setRuns(data);
    setLoading(false);
  };

  useEffect(() => { fetchRuns(); }, [currentRestaurant, dateFilter, listFilter]);

  // Auto-open a run if viewRun param is set
  useEffect(() => {
    const viewRunId = searchParams.get("viewRun");
    if (viewRunId && runs.length > 0) {
      const run = runs.find(r => r.id === viewRunId);
      if (run) {
        openRunDetail(run);
        searchParams.delete("viewRun");
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [runs, searchParams]);

  const openRunDetail = async (run: any) => {
    setSelectedRun(run);
    const { data } = await supabase.from("smart_order_run_items").select("*").eq("run_id", run.id);
    if (data) {
      setRunItems(data.sort((a, b) => b.suggested_order - a.suggested_order));
    }
  };

  const handleDeleteRun = async (idToDelete: string) => {
    if (!idToDelete) return;

    // Close dialog + optimistic UI update immediately
    setDeleteRunId(null);
    setRuns(prev => prev.filter(r => r.id !== idToDelete));
    if (selectedRun?.id === idToDelete) { setSelectedRun(null); setRunItems([]); }

    // Delete child items first (FK safety)
    const [, purchases] = await Promise.all([
      supabase.from("smart_order_run_items").delete().eq("run_id", idToDelete),
      supabase.from("purchase_history").select("id").eq("smart_order_run_id", idToDelete),
    ]);
    if (purchases.data && purchases.data.length > 0) {
      const phIds = purchases.data.map(p => p.id);
      await supabase.from("purchase_history_items").delete().in("purchase_history_id", phIds);
      await supabase.from("purchase_history").delete().in("id", phIds);
    }

    const { error } = await supabase.from("smart_order_runs").delete().eq("id", idToDelete);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      // Roll back — refetch from DB to restore actual state
      fetchRuns();
    } else {
      toast.success("Smart order deleted");
      // Silently confirm from DB (don't show loading)
      fetchRuns();
    }
  };

  const riskBadge = (risk: string) => {
    if (risk === "RED") return <Badge variant="destructive" className="text-[10px] font-medium">RED</Badge>;
    if (risk === "YELLOW") return <Badge className="bg-warning text-warning-foreground text-[10px] font-medium">YELLOW</Badge>;
    return <Badge className="bg-success text-success-foreground text-[10px] font-medium">GREEN</Badge>;
  };

  // Detail view
  if (selectedRun) {
    const totalEstCost = runItems.reduce((sum, i) => sum + (i.unit_cost ? i.suggested_order * Number(i.unit_cost) : 0), 0);
    const redCount = runItems.filter(i => i.risk === "RED").length;
    const orderCount = runItems.filter(i => i.suggested_order > 0).length;

    return (
      <div className="space-y-5 animate-fade-in">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedRun(null); setRunItems([]); }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Smart Order Detail</h1>
              <p className="text-sm text-muted-foreground">
                {selectedRun.inventory_lists?.name} • {selectedRun.par_guides?.name} • {new Date(selectedRun.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
             <ExportButtons
              items={runItems.map(i => ({ ...i, suggestedOrder: i.suggested_order, pack_size: i.pack_size }))}
              filename="smart-order"
              type="smartorder"
            />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
              // Navigate to purchase history
              window.location.href = "/app/purchase-history";
            }}>
              <ExternalLink className="h-3.5 w-3.5" /> Purchase History
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="border-destructive/15">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <div>
                <p className="stat-value text-lg">{redCount}</p>
                <p className="text-[11px] text-muted-foreground">Critical items</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Package className="h-5 w-5 text-primary" />
              <div>
                <p className="stat-value text-lg">{orderCount}</p>
                <p className="text-[11px] text-muted-foreground">Items to order</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-primary/15">
            <CardContent className="flex items-center gap-3 p-4">
              <DollarSign className="h-5 w-5 text-primary" />
              <div>
                <p className="stat-value text-lg">${totalEstCost.toFixed(2)}</p>
                <p className="text-[11px] text-muted-foreground">Est. total cost</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <Table>
             <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs font-semibold">Risk</TableHead>
                <TableHead className="text-xs font-semibold">Item</TableHead>
                <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                <TableHead className="text-xs font-semibold">Current</TableHead>
                <TableHead className="text-xs font-semibold">PAR</TableHead>
                <TableHead className="text-xs font-semibold">Order Qty</TableHead>
                <TableHead className="text-xs font-semibold">Est. Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runItems.map(i => (
                <TableRow key={i.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell>{riskBadge(i.risk)}</TableCell>
                  <TableCell className="font-medium text-sm">{i.item_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{i.pack_size || "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{i.current_stock}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{i.par_level}</TableCell>
                  <TableCell className="font-mono text-sm font-bold">{i.suggested_order}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {i.unit_cost ? `$${(i.suggested_order * Number(i.unit_cost)).toFixed(2)}` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    );
  }

  // ─── LIST VIEW ────────────────────────
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Smart Orders</h1>
          <p className="page-description">View and manage your saved smart order runs</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="h-9 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
        <Select value={listFilter} onValueChange={setListFilter}>
          <SelectTrigger className="h-9 w-48 text-xs"><SelectValue placeholder="All lists" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All lists</SelectItem>
            {lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : runs.length === 0 ? (
        <Card>
          <CardContent className="empty-state">
            <ShoppingCart className="empty-state-icon" />
            <p className="empty-state-title">No smart orders yet</p>
            <p className="empty-state-description">Create a smart order from an approved inventory session in Inventory Management.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs font-semibold">Date</TableHead>
                <TableHead className="text-xs font-semibold">Inventory List</TableHead>
                <TableHead className="text-xs font-semibold">Session</TableHead>
                <TableHead className="text-xs font-semibold">PAR Guide</TableHead>
                <TableHead className="text-xs font-semibold text-right">Items</TableHead>
                <TableHead className="text-xs font-semibold w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map(run => (
                <TableRow key={run.id} className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => openRunDetail(run)}>
                  <TableCell className="text-xs text-muted-foreground">{new Date(run.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-sm font-medium">{run.inventory_lists?.name || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {run.inventory_sessions?.name || "—"}
                    {run.inventory_sessions?.approved_at && (
                      <span className="ml-1 text-[10px]">({new Date(run.inventory_sessions.approved_at).toLocaleDateString()})</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{run.par_guides?.name || "—"}</TableCell>
                  <TableCell className="text-xs font-mono text-right">{run.smart_order_run_items?.length || 0}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => openRunDetail(run)}>
                        <Eye className="h-3 w-3 mr-1" /> View
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteRunId(run.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteRunId} onOpenChange={(o) => !o && setDeleteRunId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete smart order?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this smart order run and its linked purchase history. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteRunId && handleDeleteRun(deleteRunId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
