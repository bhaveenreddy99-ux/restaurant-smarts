import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Receipt, DollarSign, Search, Menu, ChevronDown, Check,
  LayoutList, Clock, Package as PackageIcon, Eye, ArrowLeft,
} from "lucide-react";

type ViewMode = "all" | "by-list" | "by-date";

export default function PurchaseHistoryPage() {
  const { currentRestaurant } = useRestaurant();
  const [purchases, setPurchases] = useState<any[]>([]);
  const [phItems, setPhItems] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!currentRestaurant) return;
    setLoading(true);
    supabase
      .from("purchase_history")
      .select("*, inventory_lists(name)")
      .eq("restaurant_id", currentRestaurant.id)
      .order("created_at", { ascending: false })
      .then(async ({ data }) => {
        if (data) {
          setPurchases(data);
          // Fetch all items
          const itemMap: Record<string, any[]> = {};
          for (const p of data) {
            const { data: items } = await supabase
              .from("purchase_history_items")
              .select("*")
              .eq("purchase_history_id", p.id);
            if (items) itemMap[p.id] = items;
          }
          setPhItems(itemMap);
        }
        setLoading(false);
      });
  }, [currentRestaurant]);

  const totalCost = (items: any[]) =>
    items.reduce((sum, i) => sum + (Number(i.total_cost) || 0), 0);

  // Filter by search
  const filteredPurchases = purchases.filter(p => {
    if (!search) return true;
    const lower = search.toLowerCase();
    const listName = (p.inventory_lists?.name || "").toLowerCase();
    const vendor = (p.vendor_name || "").toLowerCase();
    const items = phItems[p.id] || [];
    const hasItem = items.some((i: any) => (i.item_name || "").toLowerCase().includes(lower));
    return listName.includes(lower) || vendor.includes(lower) || hasItem;
  });

  // Group by view mode
  const getGrouped = (): Record<string, any[]> => {
    if (viewMode === "by-list") {
      const groups: Record<string, any[]> = {};
      filteredPurchases.forEach(p => {
        const key = p.inventory_lists?.name || "Unknown List";
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
      });
      return Object.keys(groups).length ? groups : { "All": filteredPurchases };
    }
    if (viewMode === "by-date") {
      const groups: Record<string, any[]> = {};
      filteredPurchases.forEach(p => {
        const key = new Date(p.created_at).toLocaleDateString();
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
      });
      return Object.keys(groups).length ? groups : { "All": filteredPurchases };
    }
    return { "All Orders": filteredPurchases };
  };

  const grouped = getGrouped();

  const viewModeLabel: Record<ViewMode, string> = {
    all: "All Orders",
    "by-list": "Group by List",
    "by-date": "Group by Date",
  };

  if (!currentRestaurant) {
    return (
      <div className="empty-state">
        <PackageIcon className="empty-state-icon" />
        <p className="empty-state-title">Select a restaurant to view purchase history</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-10 w-64" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/app/dashboard">Home</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Purchase History</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Purchase History</h1>
          <p className="text-sm text-muted-foreground">Track saved Smart Order runs and procurement costs</p>
        </div>
      </div>

      {/* Toolbar - same style as list detail */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search orders, items, vendors..." className="pl-9 h-9" />
        </div>

        {/* 3-Line View Mode Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 h-9">
              <Menu className="h-3.5 w-3.5" />
              {viewModeLabel[viewMode]}
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={() => setViewMode("all")} className="gap-2">
              <LayoutList className="h-4 w-4" /> All Orders
              {viewMode === "all" && <Check className="h-3.5 w-3.5 ml-auto" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setViewMode("by-list")} className="gap-2">
              <Receipt className="h-4 w-4" /> Group by List
              {viewMode === "by-list" && <Check className="h-3.5 w-3.5 ml-auto" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setViewMode("by-date")} className="gap-2">
              <Clock className="h-4 w-4" /> Group by Date
              {viewMode === "by-date" && <Check className="h-3.5 w-3.5 ml-auto" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {filteredPurchases.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Receipt className="mx-auto h-10 w-10 mb-3 opacity-20" />
            <p className="text-sm font-medium">No purchase history yet</p>
            <p className="text-xs text-muted-foreground mt-1">Save a Smart Order run to automatically generate purchase history.</p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([groupName, groupPurchases]) => (
          <div key={groupName} className="space-y-3">
            {Object.keys(grouped).length > 1 && (
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{groupName}</h3>
                <Badge variant="secondary" className="text-[10px]">{groupPurchases.length}</Badge>
              </div>
            )}
            {groupPurchases.map(p => (
              <Card key={p.id} className="overflow-hidden border shadow-sm">
                <CardContent className="p-0">
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/10 transition-colors"
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">{p.inventory_lists?.name || "Unknown List"}</p>
                        {p.vendor_name && <Badge variant="outline" className="text-[10px]">{p.vendor_name}</Badge>}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {new Date(p.created_at).toLocaleDateString()} • {new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">{phItems[p.id]?.length || 0} items</p>
                        <p className="text-sm font-mono font-semibold">${totalCost(phItems[p.id] || []).toFixed(2)}</p>
                      </div>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {expandedId === p.id && phItems[p.id] && (
                    <div className="border-t">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30">
                            <TableHead className="text-xs font-semibold">Item</TableHead>
                            <TableHead className="text-xs font-semibold">Brand</TableHead>
                            <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                            <TableHead className="text-xs font-semibold">Qty</TableHead>
                            <TableHead className="text-xs font-semibold">Unit Cost</TableHead>
                            <TableHead className="text-xs font-semibold">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {phItems[p.id].map((item: any) => (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium text-sm">{item.item_name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{item.brand_name || "—"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{item.pack_size || "—"}</TableCell>
                              <TableCell className="font-mono text-sm">{item.quantity}</TableCell>
                              <TableCell className="font-mono text-sm">{item.unit_cost ? `$${Number(item.unit_cost).toFixed(2)}` : "—"}</TableCell>
                              <TableCell className="font-mono text-sm">{item.total_cost ? `$${Number(item.total_cost).toFixed(2)}` : "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <div className="flex items-center justify-end gap-2 p-3 border-t bg-muted/10">
                        <DollarSign className="h-4 w-4 text-primary" />
                        <p className="text-sm font-semibold">
                          Total: <span className="text-primary">${totalCost(phItems[p.id]).toFixed(2)}</span>
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
