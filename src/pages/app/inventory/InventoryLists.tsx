import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { toast } from "sonner";
import {
  Plus, Upload, ClipboardList, MoreVertical, Pencil, Trash2,
  Download, Search, ArrowLeft, AlertTriangle, ShoppingCart, FileSpreadsheet, ChevronRight, X,
} from "lucide-react";
import { exportToCSV, exportToExcel, exportToPDF } from "@/lib/export-utils";

interface ActionItem {
  id: string;
  item_name: string;
  category: string | null;
  unit: string | null;
  default_unit_cost: number | null;
  vendor_sku: string | null;
  vendor_name: string | null;
  inventory_list_id: string | null;
  listName?: string;
  reasons: string[];
}

export default function InventoryListsPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [lists, setLists] = useState<any[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [importFiles, setImportFiles] = useState<Record<string, any[]>>({});
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionNeededCount, setActionNeededCount] = useState(0);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [actionDrawerOpen, setActionDrawerOpen] = useState(false);

  // List detail state
  const [selectedList, setSelectedList] = useState<any>(null);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [detailSearch, setDetailSearch] = useState("");
  const [detailCategory, setDetailCategory] = useState("all");
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<any>({});
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [newItem, setNewItem] = useState({ item_name: "", category: "", unit: "", vendor_sku: "", vendor_name: "", default_unit_cost: 0 });

  // Rename / delete state
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameListId, setRenameListId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteListId, setDeleteListId] = useState<string | null>(null);

  const fetchLists = async () => {
    if (!currentRestaurant) return;
    setLoading(true);
    const { data } = await supabase
      .from("inventory_lists")
      .select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .order("created_at", { ascending: false });
    if (data) {
      setLists(data);
      const listMap: Record<string, string> = {};
      data.forEach(l => { listMap[l.id] = l.name; });

      const { data: catalogAll } = await supabase
        .from("inventory_catalog_items")
        .select("id, inventory_list_id, category, unit, default_unit_cost, item_name, vendor_sku, vendor_name")
        .eq("restaurant_id", currentRestaurant.id);
      if (catalogAll) {
        const counts: Record<string, number> = {};
        catalogAll.forEach(i => {
          if (i.inventory_list_id) counts[i.inventory_list_id] = (counts[i.inventory_list_id] || 0) + 1;
        });
        setItemCounts(counts);

        // Action needed: compute per-item reasons
        const nameMap: Record<string, number> = {};
        catalogAll.forEach(i => {
          const norm = i.item_name.trim().toLowerCase();
          nameMap[norm] = (nameMap[norm] || 0) + 1;
        });
        const issues: ActionItem[] = [];
        catalogAll.forEach(i => {
          const reasons: string[] = [];
          if (!i.category) reasons.push("Missing Category");
          if (!i.unit) reasons.push("Missing Unit");
          if (!i.vendor_sku) reasons.push("Missing Product Number");
          if (!i.vendor_name) reasons.push("Missing Vendor Name");
          if (i.default_unit_cost == null) reasons.push("Missing Unit Cost");
          const norm = i.item_name.trim().toLowerCase();
          if (nameMap[norm] > 1) reasons.push("Possible Duplicate");
          if (reasons.length > 0) {
            issues.push({
              ...i,
              listName: i.inventory_list_id ? listMap[i.inventory_list_id] : undefined,
              reasons,
            });
          }
        });
        setActionItems(issues);
        setActionNeededCount(issues.length);
      }
      const { data: imports } = await supabase
        .from("inventory_import_files")
        .select("*")
        .eq("restaurant_id", currentRestaurant.id)
        .order("uploaded_at", { ascending: false });
      if (imports) {
        const grouped: Record<string, any[]> = {};
        imports.forEach(f => {
          if (!grouped[f.inventory_list_id]) grouped[f.inventory_list_id] = [];
          grouped[f.inventory_list_id].push(f);
        });
        setImportFiles(grouped);
      }
    }
    setLoading(false);
  };

  useEffect(() => { fetchLists(); }, [currentRestaurant]);

  const handleCreate = async () => {
    if (!currentRestaurant || !user || !newName.trim()) return;
    const { error } = await supabase.from("inventory_lists").insert({
      restaurant_id: currentRestaurant.id,
      name: newName.trim(),
      created_by: user.id,
    });
    if (error) toast.error(error.message);
    else { toast.success("List created"); setNewName(""); setOpen(false); fetchLists(); }
  };

  const handleRename = async () => {
    if (!renameListId || !renameValue.trim()) return;
    const { error } = await supabase.from("inventory_lists").update({ name: renameValue.trim() }).eq("id", renameListId);
    if (error) toast.error(error.message);
    else { toast.success("List renamed"); setRenameOpen(false); fetchLists(); }
  };

  const handleDelete = async () => {
    if (!deleteListId) return;
    // Full cascade delete: all related records then the list itself
    // 1) Catalog items, import files, import runs, import templates
    const cascadeTables = ["inventory_catalog_items", "inventory_import_files", "import_runs", "import_templates"] as const;
    for (const table of cascadeTables) {
      const { error } = await supabase.from(table).delete().eq("inventory_list_id", deleteListId);
      if (error) { toast.error(`Failed to clean up ${table}: ${error.message}`); return; }
    }
    // 2) Sessions and their items + smart order runs/items + purchase history
    const { data: sessions } = await supabase.from("inventory_sessions").select("id").eq("inventory_list_id", deleteListId);
    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map(s => s.id);
      await supabase.from("inventory_session_items").delete().in("session_id", sessionIds);
      const { data: runs } = await supabase.from("smart_order_runs").select("id").in("session_id", sessionIds);
      if (runs && runs.length > 0) {
        const runIds = runs.map(r => r.id);
        await supabase.from("smart_order_run_items").delete().in("run_id", runIds);
        const { data: purchases } = await supabase.from("purchase_history").select("id").in("smart_order_run_id", runIds);
        if (purchases && purchases.length > 0) {
          await supabase.from("purchase_history_items").delete().in("purchase_history_id", purchases.map(p => p.id));
          await supabase.from("purchase_history").delete().in("id", purchases.map(p => p.id));
        }
        await supabase.from("smart_order_runs").delete().in("id", runIds);
      }
      await supabase.from("inventory_sessions").delete().eq("inventory_list_id", deleteListId);
    }
    // Also delete smart order runs linked by inventory_list_id (not via session)
    const { data: listRuns } = await supabase.from("smart_order_runs").select("id").eq("inventory_list_id", deleteListId);
    if (listRuns && listRuns.length > 0) {
      const runIds = listRuns.map(r => r.id);
      await supabase.from("smart_order_run_items").delete().in("run_id", runIds);
      const { data: purchases } = await supabase.from("purchase_history").select("id").in("smart_order_run_id", runIds);
      if (purchases && purchases.length > 0) {
        await supabase.from("purchase_history_items").delete().in("purchase_history_id", purchases.map(p => p.id));
        await supabase.from("purchase_history").delete().in("id", purchases.map(p => p.id));
      }
      await supabase.from("smart_order_runs").delete().in("id", runIds);
    }
    // Also delete purchase history linked by inventory_list_id
    const { data: listPurchases } = await supabase.from("purchase_history").select("id").eq("inventory_list_id", deleteListId);
    if (listPurchases && listPurchases.length > 0) {
      await supabase.from("purchase_history_items").delete().in("purchase_history_id", listPurchases.map(p => p.id));
      await supabase.from("purchase_history").delete().in("id", listPurchases.map(p => p.id));
    }
    // 3) PAR guides and their items
    const { data: parGuides } = await supabase.from("par_guides").select("id").eq("inventory_list_id", deleteListId);
    if (parGuides && parGuides.length > 0) {
      await supabase.from("par_guide_items").delete().in("par_guide_id", parGuides.map(g => g.id));
      await supabase.from("par_guides").delete().eq("inventory_list_id", deleteListId);
    }
    // 4) Finally delete the list itself
    const { error } = await supabase.from("inventory_lists").delete().eq("id", deleteListId);
    if (error) toast.error(error.message);
    else { toast.success("List and all related data deleted"); setDeleteListId(null); if (selectedList?.id === deleteListId) setSelectedList(null); fetchLists(); }
  };

  // List detail
  const openListDetail = async (list: any) => {
    setSelectedList(list);
    setDetailSearch("");
    setDetailCategory("all");
    const { data } = await supabase
      .from("inventory_catalog_items")
      .select("*")
      .eq("inventory_list_id", list.id)
      .order("item_name");
    if (data) setCatalogItems(data);
  };

  const handleSaveEdit = async (itemId: string) => {
    const { error } = await supabase.from("inventory_catalog_items").update(editValues).eq("id", itemId);
    if (error) toast.error(error.message);
    else { setEditingItem(null); openListDetail(selectedList); fetchLists(); }
  };

  const handleDeleteItem = async (itemId: string) => {
    const { error } = await supabase.from("inventory_catalog_items").delete().eq("id", itemId);
    if (error) toast.error(error.message);
    else openListDetail(selectedList);
  };

  const handleAddItemToList = async () => {
    if (!selectedList || !currentRestaurant || !newItem.item_name.trim()) return;
    const { error } = await supabase.from("inventory_catalog_items").insert({
      restaurant_id: currentRestaurant.id,
      inventory_list_id: selectedList.id,
      item_name: newItem.item_name.trim(),
      category: newItem.category || null,
      unit: newItem.unit || null,
      vendor_sku: newItem.vendor_sku || null,
      default_unit_cost: newItem.default_unit_cost || null,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Item added");
      setNewItem({ item_name: "", category: "", unit: "", vendor_sku: "", vendor_name: "", default_unit_cost: 0 });
      setAddItemOpen(false);
      openListDetail(selectedList);
    }
  };

  const handleExportList = async (list: any, format: "csv" | "xlsx" | "pdf") => {
    const { data } = await supabase.from("inventory_catalog_items").select("*").eq("inventory_list_id", list.id);
    if (!data || data.length === 0) { toast.error("No items to export"); return; }
    const fn = `inventory-${list.name}`;
    const meta = { listName: list.name };
    if (format === "csv") exportToCSV(data, fn, "inventory");
    else if (format === "xlsx") exportToExcel(data, fn, "inventory", meta);
    else exportToPDF(data, fn, "inventory", meta);
  };

  // Action needed: edit inline from action drawer
  const handleEditActionItem = (item: ActionItem) => {
    setActionDrawerOpen(false);
    const list = lists.find(l => l.id === item.inventory_list_id);
    if (list) {
      openListDetail(list).then(() => {
        setEditingItem(item.id);
        setEditValues({
          item_name: item.item_name,
          category: item.category,
          unit: item.unit,
          default_unit_cost: item.default_unit_cost,
        });
      });
    }
  };

  const filteredCatalog = catalogItems.filter(i => {
    if (detailCategory !== "all" && i.category !== detailCategory) return false;
    if (detailSearch && !i.item_name.toLowerCase().includes(detailSearch.toLowerCase())) return false;
    return true;
  });
  const categories = [...new Set(catalogItems.map(i => i.category).filter(Boolean))];
  const listImportFiles = selectedList ? (importFiles[selectedList.id] || []) : [];

  // Action items by reason
  const actionByCategory = actionItems.filter(i => i.reasons.includes("Missing Category"));
  const actionByUnit = actionItems.filter(i => i.reasons.includes("Missing Unit"));
  const actionByProductNum = actionItems.filter(i => i.reasons.includes("Missing Product Number"));
  const actionByVendor = actionItems.filter(i => i.reasons.includes("Missing Vendor Name"));
  const actionByCost = actionItems.filter(i => i.reasons.includes("Missing Unit Cost"));
  const actionByDuplicate = actionItems.filter(i => i.reasons.includes("Possible Duplicate"));

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    );
  }

  // ─── ACTION NEEDED DRAWER ─────────────────────────
  const renderActionDrawer = () => (
    <Dialog open={actionDrawerOpen} onOpenChange={setActionDrawerOpen}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Action Needed — {actionNeededCount} items
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="category" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="category" className="text-xs">Missing Category ({actionByCategory.length})</TabsTrigger>
            <TabsTrigger value="unit" className="text-xs">Missing Unit ({actionByUnit.length})</TabsTrigger>
            <TabsTrigger value="productnum" className="text-xs">Missing Product # ({actionByProductNum.length})</TabsTrigger>
            <TabsTrigger value="vendor" className="text-xs">Missing Vendor ({actionByVendor.length})</TabsTrigger>
            <TabsTrigger value="cost" className="text-xs">Missing Cost ({actionByCost.length})</TabsTrigger>
            <TabsTrigger value="duplicate" className="text-xs">Duplicates ({actionByDuplicate.length})</TabsTrigger>
          </TabsList>
          {[
            { key: "category", items: actionByCategory },
            { key: "unit", items: actionByUnit },
            { key: "productnum", items: actionByProductNum },
            { key: "vendor", items: actionByVendor },
            { key: "cost", items: actionByCost },
            { key: "duplicate", items: actionByDuplicate },
          ].map(({ key, items: tabItems }) => (
            <TabsContent key={key} value={key} className="flex-1 overflow-auto">
              {tabItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No items in this category.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-xs font-semibold">Item Name</TableHead>
                      <TableHead className="text-xs font-semibold">List</TableHead>
                      <TableHead className="text-xs font-semibold">Issues</TableHead>
                      <TableHead className="text-xs font-semibold w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tabItems.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="text-sm font-medium">{item.item_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item.listName || "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {item.reasons.map(r => (
                              <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => handleEditActionItem(item)}>
                            <Pencil className="h-3 w-3 mr-1" /> Fix
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );

  // ─── LIST DETAIL VIEW ─────────────────────────
  if (selectedList) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink href="/app/dashboard">Home</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink className="cursor-pointer" onClick={() => setSelectedList(null)}>List management</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{selectedList.name}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedList(null)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-bold tracking-tight">{selectedList.name}</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/app/inventory/import/${selectedList.id}`)}>
              <Upload className="h-3.5 w-3.5" /> Import
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5"><Download className="h-3.5 w-3.5" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleExportList(selectedList, "csv")}>CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportList(selectedList, "xlsx")}>Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportList(selectedList, "pdf")}>PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setRenameListId(selectedList.id); setRenameValue(selectedList.name); setRenameOpen(true); }}>
              <Pencil className="h-3.5 w-3.5" /> Rename
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={detailSearch} onChange={e => setDetailSearch(e.target.value)} placeholder="Search items..." className="pl-9 h-9" />
          </div>
          <Select value={detailCategory} onValueChange={setDetailCategory}>
            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Card className="overflow-hidden border shadow-sm">
          <Table>
             <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs font-semibold">Item Name</TableHead>
                <TableHead className="text-xs font-semibold">Category</TableHead>
                <TableHead className="text-xs font-semibold">Unit</TableHead>
                <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                <TableHead className="text-xs font-semibold">Product #</TableHead>
                <TableHead className="text-xs font-semibold">Unit Cost</TableHead>
                <TableHead className="text-xs font-semibold w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCatalog.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No items found.</TableCell>
                </TableRow>
              ) : filteredCatalog.map(item => (
                <TableRow key={item.id} className="hover:bg-muted/20 transition-colors">
                 {editingItem === item.id ? (
                    <>
                      <TableCell><Input className="h-8 text-sm" value={editValues.item_name} onChange={e => setEditValues({ ...editValues, item_name: e.target.value })} /></TableCell>
                      <TableCell><Input className="h-8 text-sm" value={editValues.category || ""} onChange={e => setEditValues({ ...editValues, category: e.target.value })} /></TableCell>
                      <TableCell><Input className="h-8 text-sm" value={editValues.unit || ""} onChange={e => setEditValues({ ...editValues, unit: e.target.value })} /></TableCell>
                      <TableCell><Input className="h-8 text-sm" value={editValues.pack_size || ""} onChange={e => setEditValues({ ...editValues, pack_size: e.target.value })} /></TableCell>
                      <TableCell><Input className="h-8 text-sm" value={editValues.vendor_sku || ""} onChange={e => setEditValues({ ...editValues, vendor_sku: e.target.value })} /></TableCell>
                      <TableCell><Input className="h-8 text-sm w-20" type="number" value={editValues.default_unit_cost || 0} onChange={e => setEditValues({ ...editValues, default_unit_cost: +e.target.value })} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => handleSaveEdit(item.id)}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setEditingItem(null)}>✕</Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-medium text-sm">{item.item_name}</TableCell>
                      <TableCell>{item.category ? <Badge variant="secondary" className="text-[10px] font-normal">{item.category}</Badge> : <span className="text-xs text-muted-foreground/50">—</span>}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.unit || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.pack_size || "—"}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{item.vendor_sku || "—"}</TableCell>
                      <TableCell className="text-sm font-mono">{item.default_unit_cost != null ? `$${item.default_unit_cost}` : "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingItem(item.id); setEditValues({ item_name: item.item_name, category: item.category, unit: item.unit, pack_size: item.pack_size, vendor_sku: item.vendor_sku, default_unit_cost: item.default_unit_cost }); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteItem(item.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-1.5"><Plus className="h-4 w-4" /> Add item</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Item</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>Item Name</Label><Input value={newItem.item_name} onChange={e => setNewItem({ ...newItem, item_name: e.target.value })} className="h-10" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Category</Label><Input value={newItem.category} onChange={e => setNewItem({ ...newItem, category: e.target.value })} className="h-10" /></div>
                <div className="space-y-1"><Label>Unit</Label><Input value={newItem.unit} onChange={e => setNewItem({ ...newItem, unit: e.target.value })} className="h-10" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Product Number</Label><Input value={newItem.vendor_sku} onChange={e => setNewItem({ ...newItem, vendor_sku: e.target.value })} className="h-10" placeholder="Vendor item number used for ordering" /></div>
                <div className="space-y-1"><Label>Unit Cost</Label><Input type="number" value={newItem.default_unit_cost} onChange={e => setNewItem({ ...newItem, default_unit_cost: +e.target.value })} className="h-10" /></div>
              </div>
              <Button onClick={handleAddItemToList} className="w-full bg-gradient-amber">Add Item</Button>
            </div>
          </DialogContent>
        </Dialog>

        {listImportFiles.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Import History</h3>
            <Card className="overflow-hidden border shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs font-semibold">File Name</TableHead>
                    <TableHead className="text-xs font-semibold">Upload Date</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Rows</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Created</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Skipped</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listImportFiles.map(f => (
                    <TableRow key={f.id}>
                      <TableCell className="text-sm">{f.file_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(f.uploaded_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-xs font-mono text-right">{f.row_count ?? "—"}</TableCell>
                      <TableCell className="text-xs font-mono text-right">{f.created_count ?? "—"}</TableCell>
                      <TableCell className="text-xs font-mono text-right">{f.skipped_count ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}

        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Rename List</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>New Name</Label><Input value={renameValue} onChange={e => setRenameValue(e.target.value)} className="h-10" /></div>
              <Button onClick={handleRename} className="w-full bg-gradient-amber">Rename</Button>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteListId} onOpenChange={(o) => !o && setDeleteListId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete list?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the list and all related inventory sessions, PAR guides, smart orders, and purchase history. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {renderActionDrawer()}
      </div>
    );
  }

  // ─── MAIN LIST VIEW ───────────────────────────
  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/app/dashboard">Home</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>List management</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">List management</h1>
        <div className="flex gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-amber gap-2 shadow-amber" size="sm"><Plus className="h-4 w-4" /> Create new list</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Inventory List</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>List Name</Label>
                  <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Main Kitchen" className="h-10" />
                </div>
                <Button onClick={handleCreate} className="w-full bg-gradient-amber">Create</Button>
              </div>
            </DialogContent>
          </Dialog>
          {lists.length > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => lists[0] && navigate(`/app/inventory/import/${lists[0].id}`)}>
              <Upload className="h-4 w-4" /> Import list
            </Button>
          )}
        </div>
      </div>

      {/* Action Needed Banner — clickable to open drill-down */}
      {actionNeededCount > 0 && (
        <Card className="border shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActionDrawerOpen(true)}>
          <div className="flex items-center">
            <div className="w-1 self-stretch bg-gradient-amber" />
            <CardContent className="flex items-center justify-between flex-1 py-3 px-4">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <span className="text-sm font-medium">Action needed</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{actionNeededCount} items</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardContent>
          </div>
        </Card>
      )}

      {/* My Lists */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">My lists</h2>
          <p className="text-sm text-muted-foreground">View and modify your lists or create new ones.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <Card className="border-dashed border-2 hover:border-primary/30 hover:bg-muted/30 transition-all cursor-pointer" onClick={() => setOpen(true)}>
            <CardContent className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Plus className="h-8 w-8 mb-2 opacity-40" />
              <span className="text-sm font-medium">Create new list</span>
            </CardContent>
          </Card>

          {lists.map(list => (
            <Card key={list.id} className="hover:shadow-md transition-all cursor-pointer border shadow-sm group" onClick={() => openListDetail(list)}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-sm">{list.name}</h3>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => { setRenameListId(list.id); setRenameValue(list.name); setRenameOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5 mr-2" /> Rename list
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger><Download className="h-3.5 w-3.5 mr-2" /> Export list</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem onClick={() => handleExportList(list, "csv")}>CSV</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExportList(list, "xlsx")}>Excel (.xlsx)</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExportList(list, "pdf")}>PDF</DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleteListId(list.id)}>
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete list
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] font-mono">{itemCounts[list.id] || 0} items</Badge>
                  <span className="text-[11px] text-muted-foreground">{new Date(list.created_at).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Purchase History */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Purchase history</h2>
          <p className="text-sm text-muted-foreground">View products purchased from previous orders.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <Card className="hover:shadow-md transition-all cursor-pointer border shadow-sm" onClick={() => navigate("/app/purchase-history")}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <ShoppingCart className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">Purchase History</p>
                <p className="text-[11px] text-muted-foreground">View all past purchases</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Managed Lists section REMOVED */}

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename List</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>New Name</Label><Input value={renameValue} onChange={e => setRenameValue(e.target.value)} className="h-10" /></div>
            <Button onClick={handleRename} className="w-full bg-gradient-amber">Rename</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteListId} onOpenChange={(o) => !o && setDeleteListId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete list?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the list and all related inventory sessions, PAR guides, smart orders, and purchase history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {renderActionDrawer()}
    </div>
  );
}
