import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, ListChecks, Trash2, GripVertical, Tag, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";

export default function ListManagementPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const [lists, setLists] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [newList, setNewList] = useState("");
  const [newItem, setNewItem] = useState({ item_name: "", quantity: 0, unit: "", category: "" });
  const [newCategory, setNewCategory] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");

  const categories: string[] = selected?.categories
    ? (Array.isArray(selected.categories) ? selected.categories : JSON.parse(selected.categories as string))
    : [];

  const fetchLists = useCallback(async () => {
    if (!currentRestaurant) return;
    const { data } = await supabase
      .from("custom_lists")
      .select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .order("created_at", { ascending: false });
    if (data) setLists(data);
  }, [currentRestaurant]);

  const fetchItems = useCallback(async (id: string) => {
    const { data } = await supabase
      .from("custom_list_items")
      .select("*")
      .eq("list_id", id)
      .order("sort_order", { ascending: true });
    if (data) setItems(data);
  }, []);

  useEffect(() => { fetchLists(); }, [fetchLists]);

  // Re-select list data when lists update
  useEffect(() => {
    if (selected) {
      const updated = lists.find(l => l.id === selected.id);
      if (updated) setSelected(updated);
    }
  }, [lists]);

  const handleDeleteList = async (listId: string) => {
    await supabase.from("custom_list_items").delete().eq("list_id", listId);
    const { error } = await supabase.from("custom_lists").delete().eq("id", listId);
    if (error) toast.error(error.message);
    else {
      toast.success("List deleted");
      if (selected?.id === listId) { setSelected(null); setItems([]); }
      fetchLists();
    }
  };

  const handleCreate = async () => {
    if (!currentRestaurant || !user || !newList.trim()) return;
    const { error } = await supabase.from("custom_lists").insert({
      restaurant_id: currentRestaurant.id,
      name: newList,
      created_by: user.id,
      categories: [],
    });
    if (error) toast.error(error.message);
    else { toast.success("List created"); setNewList(""); setListOpen(false); fetchLists(); }
  };

  const handleAddCategory = async () => {
    if (!selected || !newCategory.trim()) return;
    if (categories.includes(newCategory.trim())) {
      toast.error("Category already exists");
      return;
    }
    const updated = [...categories, newCategory.trim()];
    const { error } = await supabase
      .from("custom_lists")
      .update({ categories: updated })
      .eq("id", selected.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Category added");
      setNewCategory("");
      setCatOpen(false);
      fetchLists();
    }
  };

  const handleRemoveCategory = async (cat: string) => {
    if (!selected) return;
    const updated = categories.filter(c => c !== cat);
    const { error } = await supabase
      .from("custom_lists")
      .update({ categories: updated })
      .eq("id", selected.id);
    if (error) toast.error(error.message);
    else fetchLists();
  };

  const handleAddItem = async () => {
    if (!selected || !newItem.item_name.trim()) return;
    const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.sort_order || 0)) : -1;
    const { error } = await supabase.from("custom_list_items").insert({
      list_id: selected.id,
      item_name: newItem.item_name,
      quantity: newItem.quantity,
      unit: newItem.unit,
      category: newItem.category || null,
      sort_order: maxOrder + 1,
    });
    if (error) toast.error(error.message);
    else {
      setNewItem({ item_name: "", quantity: 0, unit: "", category: "" });
      setItemOpen(false);
      fetchItems(selected.id);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    const { error } = await supabase.from("custom_list_items").delete().eq("id", itemId);
    if (error) toast.error(error.message);
    else fetchItems(selected.id);
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || !selected) return;
    const reordered = Array.from(filteredItems);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);

    // Update sort_order for all reordered items
    const updates = reordered.map((item, idx) => ({ ...item, sort_order: idx }));
    setItems(prev => {
      const otherItems = prev.filter(i => !reordered.some(r => r.id === i.id));
      return [...otherItems, ...updates].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    });

    // Persist to DB
    for (const item of updates) {
      await supabase.from("custom_list_items").update({ sort_order: item.sort_order }).eq("id", item.id);
    }
  };

  const filteredItems = filterCategory === "all"
    ? items
    : filterCategory === "uncategorized"
      ? items.filter(i => !i.category)
      : items.filter(i => i.category === filterCategory);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">List Management</h1>
        <Dialog open={listOpen} onOpenChange={setListOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-amber gap-2" size="sm">
              <Plus className="h-4 w-4" /> New List
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create List</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>List Name</Label>
                <Input value={newList} onChange={e => setNewList(e.target.value)} placeholder="e.g. Weekly Order" />
              </div>
              <Button onClick={handleCreate} className="w-full bg-gradient-amber">Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Lists Grid */}
      <div className="grid gap-4 sm:grid-cols-3">
        {lists.map(l => (
          <Card
            key={l.id}
            className={`cursor-pointer hover:shadow-md transition-shadow ${selected?.id === l.id ? "ring-2 ring-primary" : ""}`}
            onClick={() => { setSelected(l); fetchItems(l.id); setFilterCategory("all"); }}
          >
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">{l.name}</CardTitle>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={e => e.stopPropagation()}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent onClick={e => e.stopPropagation()}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete "{l.name}"?</AlertDialogTitle>
                    <AlertDialogDescription>This will permanently delete the list and all its items.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleDeleteList(l.id)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleDateString()}</p>
              {l.categories && (Array.isArray(l.categories) ? l.categories : []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {(Array.isArray(l.categories) ? l.categories : []).slice(0, 3).map((c: string) => (
                    <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                  ))}
                  {(Array.isArray(l.categories) ? l.categories : []).length > 3 && (
                    <Badge variant="outline" className="text-[10px]">+{(l.categories as string[]).length - 3}</Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {lists.length === 0 && (
          <Card className="col-span-3">
            <CardContent className="py-8 text-center text-muted-foreground">
              <ListChecks className="mx-auto h-10 w-10 mb-3 opacity-30" />
              No custom lists yet.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Selected List Detail */}
      {selected && (
        <>
          {/* Categories Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Tag className="h-4 w-4" /> Categories
              </h2>
              <Dialog open={catOpen} onOpenChange={setCatOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1">
                    <Plus className="h-3.5 w-3.5" /> Add Category
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Category</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Category Name</Label>
                      <Input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="e.g. Produce, Dairy, Dry Goods" />
                    </div>
                    <Button onClick={handleAddCategory} className="w-full bg-gradient-amber">Add</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.length === 0 && (
                <p className="text-sm text-muted-foreground">No categories yet. Add one to organize items.</p>
              )}
              {categories.map(cat => (
                <Badge key={cat} variant="secondary" className="gap-1 pr-1">
                  {cat}
                  <button
                    onClick={() => handleRemoveCategory(cat)}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>

          {/* Items Section */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{selected.name} — Items</h2>
            <div className="flex items-center gap-2">
              {categories.length > 0 && (
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="w-[160px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    <SelectItem value="uncategorized">Uncategorized</SelectItem>
                    {categories.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Dialog open={itemOpen} onOpenChange={setItemOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1">
                    <Plus className="h-3.5 w-3.5" /> Add Item
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Item</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label>Item Name</Label>
                      <Input value={newItem.item_name} onChange={e => setNewItem({ ...newItem, item_name: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Quantity</Label>
                        <Input type="number" value={newItem.quantity} onChange={e => setNewItem({ ...newItem, quantity: +e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label>Unit</Label>
                        <Input value={newItem.unit} onChange={e => setNewItem({ ...newItem, unit: e.target.value })} />
                      </div>
                    </div>
                    {categories.length > 0 && (
                      <div className="space-y-1">
                        <Label>Category</Label>
                        <Select value={newItem.category} onValueChange={v => setNewItem({ ...newItem, category: v })}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map(c => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <Button onClick={handleAddItem} className="w-full bg-gradient-amber">Add</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <Card>
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="items-list">
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="divide-y">
                    {filteredItems.length === 0 && (
                      <div className="py-8 text-center text-muted-foreground text-sm">No items yet.</div>
                    )}
                    {filteredItems.map((item, index) => (
                      <Draggable key={item.id} draggableId={item.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`flex items-center gap-3 px-4 py-3 ${snapshot.isDragging ? "bg-accent shadow-md rounded-md" : ""}`}
                          >
                            <div {...provided.dragHandleProps} className="text-muted-foreground cursor-grab active:cursor-grabbing">
                              <GripVertical className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{item.item_name}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                {item.category && (
                                  <Badge variant="outline" className="text-[10px] h-4">{item.category}</Badge>
                                )}
                                <span className="text-xs text-muted-foreground font-mono">
                                  {item.quantity} {item.unit}
                                </span>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() => handleDeleteItem(item.id)}
                            >
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
            </DragDropContext>
          </Card>
        </>
      )}
    </div>
  );
}
