import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, GripVertical, Upload, Search, Package, FolderOpen } from "lucide-react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import * as XLSX from "xlsx";

interface InventoryItem {
  id: string;
  restaurant_id: string;
  category_id: string;
  item_name: string;
  item_number: string | null;
  pack_size: string;
  unit_price: number;
  sort_order: number;
}

export default function ListManagementPage() {
  const { currentRestaurant } = useRestaurant();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState("");

  // Item form
  const [itemOpen, setItemOpen] = useState(false);
  const [newItem, setNewItem] = useState({ item_name: "", item_number: "", pack_size: "", unit_price: 0 });

  // Import
  const [importOpen, setImportOpen] = useState(false);
  const [importData, setImportData] = useState<any[]>([]);
  const [importMapping, setImportMapping] = useState<Record<string, string>>({});
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importStep, setImportStep] = useState<"upload" | "map" | "preview">("upload");
  const fileRef = useRef<HTMLInputElement>(null);

  const requiredFields = ["item_name", "pack_size", "unit_price"];
  const optionalFields = ["item_number"];

  const restaurantId = currentRestaurant?.id;

  // Ensure a default category exists for the restaurant
  const getOrCreateDefaultCategory = useCallback(async (): Promise<string | null> => {
    if (!restaurantId) return null;
    const { data: existing } = await supabase
      .from("categories")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .limit(1)
      .single();
    if (existing) return existing.id;
    const { data: created, error } = await supabase
      .from("categories")
      .insert({ restaurant_id: restaurantId, name: "General", sort_order: 0 })
      .select("id")
      .single();
    if (error || !created) return null;
    return created.id;
  }, [restaurantId]);

  const fetchItems = useCallback(async () => {
    if (!restaurantId) return;
    const { data } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("sort_order");
    if (data) setItems(data);
  }, [restaurantId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // -------- ITEMS --------
  const handleAddItem = async () => {
    if (!restaurantId || !newItem.item_name.trim() || !newItem.pack_size.trim()) return;
    const categoryId = await getOrCreateDefaultCategory();
    if (!categoryId) { toast.error("Failed to create default category"); return; }
    const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.sort_order)) + 1 : 0;
    const { error } = await supabase.from("inventory_items").insert({
      restaurant_id: restaurantId,
      category_id: categoryId,
      item_name: newItem.item_name.trim(),
      item_number: newItem.item_number.trim() || null,
      pack_size: newItem.pack_size.trim(),
      unit_price: newItem.unit_price,
      sort_order: maxOrder,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Item added");
      setNewItem({ item_name: "", item_number: "", pack_size: "", unit_price: 0 });
      setItemOpen(false);
      fetchItems();
    }
  };

  const handleDeleteItem = async (id: string) => {
    const { error } = await supabase.from("inventory_items").delete().eq("id", id);
    if (error) toast.error(error.message);
    else fetchItems();
  };

  const handleItemDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const reordered = Array.from(filteredItems);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    const updatedItems = items.map(item => {
      const newIdx = reordered.findIndex(r => r.id === item.id);
      if (newIdx >= 0) return { ...item, sort_order: newIdx };
      return item;
    });
    setItems(updatedItems);
    for (let i = 0; i < reordered.length; i++) {
      await supabase.from("inventory_items").update({ sort_order: i }).eq("id", reordered[i].id);
    }
  };

  // -------- IMPORT --------
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target?.result, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws);
      if (json.length === 0) { toast.error("No data found"); return; }
      setImportData(json);
      setImportHeaders(Object.keys(json[0]));
      const autoMap: Record<string, string> = {};
      for (const h of Object.keys(json[0])) {
        const lower = h.toLowerCase().replace(/[^a-z]/g, "");
        for (const f of [...requiredFields, ...optionalFields]) {
          const fLower = f.replace("_", "");
          if (lower.includes(fLower)) autoMap[f] = h;
        }
      }
      setImportMapping(autoMap);
      setImportStep("map");
    };
    reader.readAsBinaryString(file);
  };

  const handleImportPreview = () => {
    if (!importMapping.item_name || !importMapping.pack_size || !importMapping.unit_price) {
      toast.error("Map all required fields");
      return;
    }
    const preview = importData.map(row => ({
      item_name: String(row[importMapping.item_name] || "").trim(),
      pack_size: String(row[importMapping.pack_size] || "").trim(),
      unit_price: parseFloat(row[importMapping.unit_price]) || 0,
      item_number: importMapping.item_number ? String(row[importMapping.item_number] || "").trim() : "",
    })).filter(r => r.item_name);
    setImportPreview(preview);
    setImportStep("preview");
  };

  const handleImportConfirm = async () => {
    if (!restaurantId) return;
    const categoryId = await getOrCreateDefaultCategory();
    if (!categoryId) { toast.error("Failed to create default category"); return; }
    let created = 0;
    for (const row of importPreview) {
      const { error } = await supabase.from("inventory_items").insert({
        restaurant_id: restaurantId,
        category_id: categoryId,
        item_name: row.item_name,
        item_number: row.item_number || null,
        pack_size: row.pack_size,
        unit_price: row.unit_price,
        sort_order: created,
      });
      if (!error) created++;
    }
    toast.success(`Imported ${created} items`);
    setImportOpen(false);
    setImportStep("upload");
    setImportData([]);
    setImportPreview([]);
    fetchItems();
  };

  // -------- FILTER --------
  const filteredItems = search
    ? items.filter(i => i.item_name.toLowerCase().includes(search.toLowerCase()))
    : items;

  if (!currentRestaurant) {
    return (
      <div className="empty-state">
        <Package className="empty-state-icon" />
        <p className="empty-state-title">Select a restaurant to manage inventory</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">List Management</h1>
          <p className="page-description">Manage your inventory items</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) { setImportStep("upload"); setImportData([]); setImportPreview([]); } }}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Upload className="h-3.5 w-3.5" /> Import
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Import Items</DialogTitle></DialogHeader>
              {importStep === "upload" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">Upload a CSV or Excel file with your inventory items.</p>
                  <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="block w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:bg-primary file:text-primary-foreground hover:file:bg-primary/90" />
                </div>
              )}
              {importStep === "map" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">Map your file columns to the required fields:</p>
                  {[...requiredFields, ...optionalFields].map(field => (
                    <div key={field} className="flex items-center gap-3">
                      <Label className="w-28 text-xs capitalize">{field.replace("_", " ")}{requiredFields.includes(field) && " *"}</Label>
                      <Select value={importMapping[field] || ""} onValueChange={v => setImportMapping(prev => ({ ...prev, [field]: v }))}>
                        <SelectTrigger className="flex-1 h-8 text-xs">
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          {importHeaders.map(h => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                  <Button onClick={handleImportPreview} className="w-full bg-gradient-amber">Preview</Button>
                </div>
              )}
              {importStep === "preview" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">{importPreview.length} items ready to import</p>
                  <div className="max-h-60 overflow-auto border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Item</TableHead>
                          <TableHead className="text-xs">Pack Size</TableHead>
                          <TableHead className="text-xs text-right">Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importPreview.slice(0, 20).map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs">{row.item_name}</TableCell>
                            <TableCell className="text-xs">{row.pack_size}</TableCell>
                            <TableCell className="text-xs text-right">${row.unit_price.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {importPreview.length > 20 && <p className="text-xs text-muted-foreground">...and {importPreview.length - 20} more</p>}
                  <Button onClick={handleImportConfirm} className="w-full bg-gradient-amber">Confirm Import</Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search items..."
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Dialog open={itemOpen} onOpenChange={setItemOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-gradient-amber gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Item
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Item</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Item Name *</Label>
                <Input value={newItem.item_name} onChange={e => setNewItem(p => ({ ...p, item_name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Pack Size *</Label>
                  <Input value={newItem.pack_size} onChange={e => setNewItem(p => ({ ...p, pack_size: e.target.value }))} placeholder="e.g. 12 oz" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Unit Price *</Label>
                  <Input type="number" step="0.01" value={newItem.unit_price} onChange={e => setNewItem(p => ({ ...p, unit_price: parseFloat(e.target.value) || 0 }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Item Number (optional)</Label>
                <Input value={newItem.item_number} onChange={e => setNewItem(p => ({ ...p, item_number: e.target.value }))} />
              </div>
              <Button onClick={handleAddItem} className="w-full bg-gradient-amber" disabled={!newItem.item_name || !newItem.pack_size}>Add Item</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Item List */}
      <DragDropContext onDragEnd={handleItemDragEnd}>
        {filteredItems.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <FolderOpen className="mx-auto h-10 w-10 mb-3 opacity-20" />
              <p className="text-sm">No items yet. Add items or import from a file.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Droppable droppableId="items">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps}>
                  {filteredItems.map((item, idx) => (
                    <Draggable key={item.id} draggableId={item.id} index={idx}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`flex items-center gap-3 px-4 py-2.5 border-b last:border-0 ${snapshot.isDragging ? "bg-accent shadow-md rounded-md" : ""}`}
                        >
                          <div {...provided.dragHandleProps} className="text-muted-foreground cursor-grab active:cursor-grabbing">
                            <GripVertical className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.item_name}</p>
                            {item.item_number && <span className="text-[10px] text-muted-foreground">#{item.item_number}</span>}
                          </div>
                          <span className="text-xs text-muted-foreground font-mono shrink-0">{item.pack_size}</span>
                          <span className="text-xs font-medium shrink-0">${Number(item.unit_price).toFixed(2)}</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0" onClick={() => handleDeleteItem(item.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </Card>
        )}
      </DragDropContext>
    </div>
  );
}
