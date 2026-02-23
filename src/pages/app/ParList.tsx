import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Tag, Package, Search, GripVertical } from "lucide-react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";

interface Category {
  id: string;
  name: string;
  sort_order: number;
}

interface InventoryItem {
  id: string;
  category_id: string;
  item_name: string;
  item_number: string | null;
  pack_size: string;
  unit_price: number;
  sort_order: number;
}

interface ParItem {
  id: string;
  inventory_item_id: string;
  category_id: string;
  par_level: number;
}

export default function ParListPage() {
  const { currentRestaurant } = useRestaurant();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [parItems, setParItems] = useState<ParItem[]>([]);
  const [filterCategory, setFilterCategory] = useState("all");
  const [search, setSearch] = useState("");

  const restaurantId = currentRestaurant?.id;

  const fetchAll = useCallback(async () => {
    if (!restaurantId) return;
    const [{ data: cats }, { data: invItems }, { data: pars }] = await Promise.all([
      supabase.from("categories").select("*").eq("restaurant_id", restaurantId).order("sort_order"),
      supabase.from("inventory_items").select("*").eq("restaurant_id", restaurantId).order("sort_order"),
      supabase.from("par_items").select("*").eq("restaurant_id", restaurantId),
    ]);
    if (cats) setCategories(cats);
    if (invItems) setItems(invItems);
    if (pars) setParItems(pars);

    // Auto-create par_items for items that don't have one
    if (invItems && pars) {
      const existingItemIds = new Set(pars.map(p => p.inventory_item_id));
      const missing = invItems.filter(i => !existingItemIds.has(i.id));
      if (missing.length > 0) {
        const inserts = missing.map(i => ({
          restaurant_id: restaurantId,
          inventory_item_id: i.id,
          category_id: i.category_id,
          par_level: 0,
        }));
        const { data: newPars } = await supabase.from("par_items").insert(inserts).select();
        if (newPars) setParItems(prev => [...prev, ...newPars]);
      }
    }
  }, [restaurantId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const getParForItem = (itemId: string) => parItems.find(p => p.inventory_item_id === itemId);

  const handleParChange = async (itemId: string, value: string) => {
    const numVal = parseFloat(value) || 0;
    const par = getParForItem(itemId);
    if (!par) return;

    // Optimistic
    setParItems(prev => prev.map(p => p.id === par.id ? { ...p, par_level: numVal } : p));

    const { error } = await supabase.from("par_items").update({ par_level: numVal }).eq("id", par.id);
    if (error) { toast.error("Failed to save"); fetchAll(); }
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const catId = result.source.droppableId;
    if (catId !== result.destination.droppableId) return; // No cross-category in par list

    const catItems = items.filter(i => i.category_id === catId).sort((a, b) => a.sort_order - b.sort_order);
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
  };

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
        <p className="empty-state-title">Select a restaurant to view PAR levels</p>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="empty-state">
        <Tag className="empty-state-icon" />
        <p className="empty-state-title">No categories yet</p>
        <p className="empty-state-description">Create categories and items in List Management first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Par List</h1>
          <p className="page-description">Set target stock levels for each item</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items..." className="pl-8 h-8 text-xs" />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Grouped Par List */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="space-y-4">
          {filteredCategories.map(cat => {
            const catItems = getItemsForCategory(cat.id);
            return (
              <Card key={cat.id}>
                <div className="px-4 py-2.5 border-b bg-muted/30 flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5 text-primary" />
                  <span className="text-sm font-semibold">{cat.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{catItems.length}</Badge>
                </div>
                <Droppable droppableId={cat.id}>
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps}>
                      {catItems.length === 0 && (
                        <div className="py-4 text-center text-xs text-muted-foreground">No items in this category.</div>
                      )}
                      {catItems.map((item, idx) => {
                        const par = getParForItem(item.id);
                        return (
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
                                  <span className="text-[10px] text-muted-foreground">{item.pack_size}</span>
                                </div>
                                <span className="text-xs text-muted-foreground font-mono shrink-0">${Number(item.unit_price).toFixed(2)}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-[10px] text-muted-foreground">PAR:</span>
                                  <Input
                                    type="number"
                                    value={par?.par_level ?? 0}
                                    onChange={e => handleParChange(item.id, e.target.value)}
                                    className="w-20 h-7 text-xs text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </Card>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}
