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
import { Plus, Trash2, GripVertical, Tag, Pencil, Upload, Search, Check, Package, FolderOpen } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import * as XLSX from "xlsx";

interface Category {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
}

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

type Step = 1 | 2 | 3;

export default function ListManagementPage() {
  const { currentRestaurant } = useRestaurant();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [step, setStep] = useState<Step>(1);
  const [filterCategory, setFilterCategory] = useState("all");
  const [search, setSearch] = useState("");

  // Category form
  const [newCatName, setNewCatName] = useState("");
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState("");

  // Item form
  const [itemOpen, setItemOpen] = useState(false);
  const [newItem, setNewItem] = useState({ item_name: "", item_number: "", pack_size: "", unit_price: 0, category_id: "" });

  // Import
  const [importOpen, setImportOpen] = useState(false);
  const [importData, setImportData] = useState<any[]>([]);
  const [importMapping, setImportMapping] = useState<Record<string, string>>({});
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importStep, setImportStep] = useState<"upload" | "map" | "preview">("upload");
  const fileRef = useRef<HTMLInputElement>(null);

  const requiredFields = ["item_name", "pack_size", "unit_price", "category"];
  const optionalFields = ["item_number"];

  const restaurantId = currentRestaurant?.id;

  const fetchCategories = useCallback(async () => {
    if (!restaurantId) return;
    const { data } = await supabase
      .from("categories")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("sort_order");
    if (data) setCategories(data);
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
    fetchCategories();
    fetchItems();
  }, [fetchCategories, fetchItems]);

  // Auto-set step based on data
  useEffect(() => {
    if (categories.length === 0) setStep(1);
    else if (items.length === 0) setStep(2);
    else setStep(3);
  }, [categories.length, items.length]);

  // -------- CATEGORIES --------
  const handleAddCategory = async () => {
    if (!restaurantId || !newCatName.trim()) return;
    const maxOrder = categories.length > 0 ? Math.max(...categories.map(c => c.sort_order)) + 1 : 0;
    const { error } = await supabase.from("categories").insert({
      restaurant_id: restaurantId,
      name: newCatName.trim(),
      sort_order: maxOrder,
    });
    if (error) {
      if (error.message.includes("duplicate")) toast.error("Category already exists");
      else toast.error(error.message);
    } else {
      toast.success("Category added");
      setNewCatName("");
      fetchCategories();
    }
  };

  const handleRenameCategory = async (id: string) => {
    if (!editCatName.trim()) return;
    const { error } = await supabase.from("categories").update({ name: editCatName.trim() }).eq("id", id);
    if (error) toast.error(error.message);
    else { setEditingCat(null); fetchCategories(); }
  };

  const handleDeleteCategory = async (id: string) => {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Category deleted"); fetchCategories(); fetchItems(); }
  };

  const handleCategoryDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const reordered = Array.from(categories);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setCategories(reordered);
    for (let i = 0; i < reordered.length; i++) {
      await supabase.from("categories").update({ sort_order: i }).eq("id", reordered[i].id);
    }
  };

  // -------- ITEMS --------
  const handleAddItem = async () => {
    if (!restaurantId || !newItem.item_name.trim() || !newItem.pack_size.trim() || !newItem.category_id) return;
    const categoryItems = items.filter(i => i.category_id === newItem.category_id);
    const maxOrder = categoryItems.length > 0 ? Math.max(...categoryItems.map(i => i.sort_order)) + 1 : 0;
    const { error } = await supabase.from("inventory_items").insert({
      restaurant_id: restaurantId,
      category_id: newItem.category_id,
      item_name: newItem.item_name.trim(),
      item_number: newItem.item_number.trim() || null,
      pack_size: newItem.pack_size.trim(),
      unit_price: newItem.unit_price,
      sort_order: maxOrder,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Item added");
      setNewItem({ item_name: "", item_number: "", pack_size: "", unit_price: 0, category_id: "" });
      setItemOpen(false);
      fetchItems();
    }
  };

  const handleDeleteItem = async (id: string) => {
    const { error } = await supabase.from("inventory_items").delete().eq("id", id);
    if (error) toast.error(error.message);
    else fetchItems();
  };

  const handleItemCategoryChange = async (itemId: string, newCategoryId: string) => {
    const { error } = await supabase.from("inventory_items").update({ category_id: newCategoryId }).eq("id", itemId);
    if (error) toast.error(error.message);
    else { toast.success("Item moved"); fetchItems(); }
  };

  const handleItemDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const sourceCatId = result.source.droppableId;
    const destCatId = result.destination.droppableId;

    if (sourceCatId === destCatId) {
      // Reorder within same category
      const catItems = items.filter(i => i.category_id === sourceCatId).sort((a, b) => a.sort_order - b.sort_order);
      const [moved] = catItems.splice(result.source.index, 1);
      catItems.splice(result.destination.index, 0, moved);
      const updated = items.map(i => {
        const idx = catItems.findIndex(ci => ci.id === i.id);
        if (idx >= 0) return { ...i, sort_order: idx };
        return i;
      });
      setItems(updated);
      for (let i = 0; i < catItems.length; i++) {
        await supabase.from("inventory_items").update({ sort_order: i }).eq("id", catItems[i].id);
      }
    } else {
      // Move to different category
      const sourceCatItems = items.filter(i => i.category_id === sourceCatId).sort((a, b) => a.sort_order - b.sort_order);
      const destCatItems = items.filter(i => i.category_id === destCatId).sort((a, b) => a.sort_order - b.sort_order);
      const [moved] = sourceCatItems.splice(result.source.index, 1);
      moved.category_id = destCatId;
      destCatItems.splice(result.destination.index, 0, moved);

      const updated = items.map(i => {
        if (i.id === moved.id) return { ...i, category_id: destCatId, sort_order: result.destination!.index };
        const sIdx = sourceCatItems.findIndex(ci => ci.id === i.id);
        if (sIdx >= 0) return { ...i, sort_order: sIdx };
        const dIdx = destCatItems.findIndex(ci => ci.id === i.id);
        if (dIdx >= 0) return { ...i, sort_order: dIdx };
        return i;
      });
      setItems(updated);

      await supabase.from("inventory_items").update({ category_id: destCatId, sort_order: result.destination.index }).eq("id", moved.id);
      for (let i = 0; i < sourceCatItems.length; i++) {
        await supabase.from("inventory_items").update({ sort_order: i }).eq("id", sourceCatItems[i].id);
      }
      for (let i = 0; i < destCatItems.length; i++) {
        await supabase.from("inventory_items").update({ sort_order: i }).eq("id", destCatItems[i].id);
      }
      toast.success("Item moved to " + categories.find(c => c.id === destCatId)?.name);
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
      // Auto-map by matching names
      const autoMap: Record<string, string> = {};
      const allFields = [...requiredFields, ...optionalFields];
      for (const h of Object.keys(json[0])) {
        const lower = h.toLowerCase().replace(/[^a-z]/g, "");
        for (const f of allFields) {
          const fLower = f.replace("_", "");
          if (lower.includes(fLower) || lower.includes(f.replace("_", " ").replace(/ /g, ""))) {
            autoMap[f] = h;
          }
        }
      }
      setImportMapping(autoMap);
      setImportStep("map");
    };
    reader.readAsBinaryString(file);
  };

  const handleImportPreview = () => {
    if (!importMapping.item_name || !importMapping.pack_size || !importMapping.unit_price || !importMapping.category) {
      toast.error("Map all required fields");
      return;
    }
    const preview = importData.map(row => ({
      item_name: String(row[importMapping.item_name] || "").trim(),
      pack_size: String(row[importMapping.pack_size] || "").trim(),
      unit_price: parseFloat(row[importMapping.unit_price]) || 0,
      category: String(row[importMapping.category] || "").trim(),
      item_number: importMapping.item_number ? String(row[importMapping.item_number] || "").trim() : "",
    })).filter(r => r.item_name && r.category);
    setImportPreview(preview);
    setImportStep("preview");
  };

  const handleImportConfirm = async () => {
    if (!restaurantId) return;
    // Collect unique category names
    const uniqueCats = [...new Set(importPreview.map(r => r.category))];
    const existingCatNames = categories.map(c => c.name);
    const newCats = uniqueCats.filter(c => !existingCatNames.includes(c));

    // Create missing categories
    if (newCats.length > 0) {
      const maxOrder = categories.length > 0 ? Math.max(...categories.map(c => c.sort_order)) + 1 : 0;
      for (let i = 0; i < newCats.length; i++) {
        await supabase.from("categories").insert({
          restaurant_id: restaurantId,
          name: newCats[i],
          sort_order: maxOrder + i,
        });
      }
    }

    // Refetch categories to get IDs
    const { data: freshCats } = await supabase.from("categories").select("*").eq("restaurant_id", restaurantId);
    if (!freshCats) { toast.error("Failed to load categories"); return; }

    const catMap = new Map(freshCats.map(c => [c.name, c.id]));
    let created = 0;

    for (const row of importPreview) {
      const catId = catMap.get(row.category);
      if (!catId) continue;
      const { error } = await supabase.from("inventory_items").insert({
        restaurant_id: restaurantId,
        category_id: catId,
        item_name: row.item_name,
        item_number: row.item_number || null,
        pack_size: row.pack_size,
        unit_price: row.unit_price,
        sort_order: created,
      });
      if (!error) created++;
    }

    toast.success(`Imported ${created} items (${newCats.length} new categories)`);
    setImportOpen(false);
    setImportStep("upload");
    setImportData([]);
    setImportPreview([]);
    fetchCategories();
    fetchItems();
  };

  // -------- FILTER & SEARCH --------
  const filteredCategories = filterCategory === "all" ? categories : categories.filter(c => c.id === filterCategory);
  const getItemsForCategory = (catId: string) => {
    let catItems = items.filter(i => i.category_id === catId).sort((a, b) => a.sort_order - b.sort_order);
    if (search) catItems = catItems.filter(i => i.item_name.toLowerCase().includes(search.toLowerCase()));
    return catItems;
  };

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
          <p className="page-description">Organize inventory by categories, then add items</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) { setImportStep("upload"); setImportData([]); setImportPreview([]); } }}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5" disabled={categories.length === 0}>
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
                          <TableHead className="text-xs">Category</TableHead>
                          <TableHead className="text-xs">Pack Size</TableHead>
                          <TableHead className="text-xs text-right">Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importPreview.slice(0, 20).map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs">{row.item_name}</TableCell>
                            <TableCell className="text-xs">{row.category}</TableCell>
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

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {[
          { n: 1 as Step, label: "Create Categories" },
          { n: 2 as Step, label: "Add Items" },
          { n: 3 as Step, label: "Review & Arrange" },
        ].map(({ n, label }) => (
          <button
            key={n}
            onClick={() => { if (n === 1 || (n === 2 && categories.length > 0) || (n === 3 && items.length > 0)) setStep(n); }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              step === n ? "bg-primary text-primary-foreground" :
              (n < step || (n === 2 && categories.length > 0) || (n === 3 && items.length > 0))
                ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground cursor-not-allowed"
            }`}
          >
            {(n < step || (n === 2 && categories.length > 0 && step > 1) || (n === 3 && items.length > 0 && step > 2))
              ? <Check className="h-3 w-3" /> : <span className="w-4 text-center">{n}</span>}
            {label}
          </button>
        ))}
      </div>

      {/* Step 1: Categories */}
      {step === 1 && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold">Categories</h2>
            </div>
            <div className="flex gap-2">
              <Input
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                placeholder="e.g. Produce, Dairy, Dry Goods"
                className="flex-1"
                onKeyDown={e => e.key === "Enter" && handleAddCategory()}
              />
              <Button onClick={handleAddCategory} className="bg-gradient-amber gap-1.5" size="sm">
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>

            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No categories yet. Create one to get started.</p>
            ) : (
              <DragDropContext onDragEnd={handleCategoryDragEnd}>
                <Droppable droppableId="categories">
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1">
                      {categories.map((cat, idx) => (
                        <Draggable key={cat.id} draggableId={cat.id} index={idx}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`flex items-center gap-3 px-3 py-2 rounded-md border ${snapshot.isDragging ? "bg-accent shadow-md" : "bg-card"}`}
                            >
                              <div {...provided.dragHandleProps} className="text-muted-foreground cursor-grab active:cursor-grabbing">
                                <GripVertical className="h-4 w-4" />
                              </div>
                              {editingCat === cat.id ? (
                                <div className="flex-1 flex gap-2">
                                  <Input value={editCatName} onChange={e => setEditCatName(e.target.value)} className="h-7 text-sm flex-1" autoFocus onKeyDown={e => e.key === "Enter" && handleRenameCategory(cat.id)} />
                                  <Button size="sm" variant="ghost" className="h-7" onClick={() => handleRenameCategory(cat.id)}>
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  <span className="flex-1 text-sm font-medium">{cat.name}</span>
                                  <Badge variant="secondary" className="text-[10px]">
                                    {items.filter(i => i.category_id === cat.id).length} items
                                  </Badge>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingCat(cat.id); setEditCatName(cat.name); }}>
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Delete "{cat.name}"?</AlertDialogTitle>
                                        <AlertDialogDescription>This will delete the category and all items in it.</AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleDeleteCategory(cat.id)}>Delete</AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </>
                              )}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            )}

            {categories.length > 0 && (
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setStep(2)}>Next: Add Items →</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2 & 3: Items View */}
      {(step === 2 || step === 3) && (
        <>
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
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                    <Label className="text-xs">Category *</Label>
                    <Select value={newItem.category_id} onValueChange={v => setNewItem(p => ({ ...p, category_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>
                        {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
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
                  <Button onClick={handleAddItem} className="w-full bg-gradient-amber" disabled={!newItem.item_name || !newItem.pack_size || !newItem.category_id}>Add Item</Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button size="sm" variant="outline" onClick={() => setStep(1)}>
              <Tag className="h-3.5 w-3.5 mr-1.5" /> Categories
            </Button>
          </div>

          {/* Grouped Item List with Drag & Drop */}
          <DragDropContext onDragEnd={handleItemDragEnd}>
            {filteredCategories.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <FolderOpen className="mx-auto h-10 w-10 mb-3 opacity-20" />
                  <p className="text-sm">No categories found.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredCategories.map(cat => {
                  const catItems = getItemsForCategory(cat.id);
                  return (
                    <Card key={cat.id}>
                      <div className="px-4 py-2.5 border-b bg-muted/30 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Tag className="h-3.5 w-3.5 text-primary" />
                          <span className="text-sm font-semibold">{cat.name}</span>
                          <Badge variant="secondary" className="text-[10px]">{catItems.length}</Badge>
                        </div>
                      </div>
                      <Droppable droppableId={cat.id}>
                        {(provided) => (
                          <div ref={provided.innerRef} {...provided.droppableProps} className="min-h-[40px]">
                            {catItems.length === 0 && (
                              <div className="py-4 text-center text-xs text-muted-foreground">
                                No items. Drag items here or add one.
                              </div>
                            )}
                            {catItems.map((item, idx) => (
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
                                    <Select value={item.category_id} onValueChange={v => handleItemCategoryChange(item.id, v)}>
                                      <SelectTrigger className="w-[120px] h-7 text-[10px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                      </SelectContent>
                                    </Select>
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
                  );
                })}
              </div>
            )}
          </DragDropContext>
        </>
      )}
    </div>
  );
}
