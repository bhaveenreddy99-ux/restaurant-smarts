import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, BookOpen, Trash2, Save, Check, Search } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import { useIsCompact } from "@/hooks/use-mobile";
import { useCategoryMapping } from "@/hooks/useCategoryMapping";

export default function PARManagementPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const isCompact = useIsCompact();
  const [lists, setLists] = useState<any[]>([]);
  const [selectedList, setSelectedList] = useState("");
  const [guides, setGuides] = useState<any[]>([]);
  const [selectedGuide, setSelectedGuide] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [newGuide, setNewGuide] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!currentRestaurant) return;
    setLoading(true);
    supabase.from("inventory_lists").select("*").eq("restaurant_id", currentRestaurant.id)
      .then(({ data }) => { if (data) setLists(data); setLoading(false); });
  }, [currentRestaurant]);

  useEffect(() => {
    if (!currentRestaurant || !selectedList) { setGuides([]); setSelectedGuide(null); return; }
    supabase.from("par_guides").select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("inventory_list_id", selectedList)
      .order("created_at", { ascending: false })
      .then(({ data }) => { if (data) setGuides(data); });
    supabase.from("inventory_catalog_items").select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("inventory_list_id", selectedList)
      .then(({ data }) => { if (data) setCatalogItems(data); });
  }, [currentRestaurant, selectedList]);

  const fetchItems = async (guideId: string) => {
    const { data } = await supabase.from("par_guide_items").select("*").eq("par_guide_id", guideId);
    if (data) setItems(data);
  };

  const handleCreateGuide = async () => {
    if (!currentRestaurant || !user || !selectedList || !newGuide.trim()) return;
    const { data, error } = await supabase.from("par_guides").insert({
      restaurant_id: currentRestaurant.id,
      inventory_list_id: selectedList,
      name: newGuide.trim(),
      created_by: user.id,
    }).select().single();
    if (error) { toast.error(error.message); return; }

    if (catalogItems.length > 0) {
      const parItems = catalogItems.map(ci => ({
        par_guide_id: data.id,
        item_name: ci.item_name,
        category: ci.category,
        unit: ci.unit,
        par_level: ci.default_par_level || 0,
      }));
      await supabase.from("par_guide_items").insert(parItems);
    }

    toast.success("PAR guide created");
    setNewGuide("");
    setGuideOpen(false);
    const { data: refreshed } = await supabase.from("par_guides").select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("inventory_list_id", selectedList)
      .order("created_at", { ascending: false });
    if (refreshed) setGuides(refreshed);
    setSelectedGuide(data);
    fetchItems(data.id);
  };

  const handleParLevelChange = (itemId: string, value: string) => {
    const numVal = value === "" ? 0 : parseFloat(value);
    if (!isNaN(numVal) && numVal >= 0) {
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, par_level: numVal } : i));
    }
  };

  const handleSaveParLevel = useCallback(async (itemId: string, level: number) => {
    setSavingId(itemId);
    const { error } = await supabase.from("par_guide_items").update({ par_level: level }).eq("id", itemId);
    setSavingId(null);
    if (error) {
      toast.error("Could not save");
    } else {
      setSavedId(itemId);
      setTimeout(() => setSavedId(prev => prev === itemId ? null : prev), 1500);
    }
  }, []);

  const handleSaveParLevels = async () => {
    for (const item of items) {
      await supabase.from("par_guide_items").update({ par_level: item.par_level }).eq("id", item.id);
    }
    toast.success("PAR levels saved");
  };

  const handleDeleteItem = async (id: string) => {
    await supabase.from("par_guide_items").delete().eq("id", id);
    if (selectedGuide) fetchItems(selectedGuide.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const currentItem = filteredItems[currentIndex];
      if (currentItem) handleSaveParLevel(currentItem.id, Number(currentItem.par_level));
      const nextItem = filteredItems[currentIndex + 1];
      if (nextItem && inputRefs.current[nextItem.id]) {
        inputRefs.current[nextItem.id]?.focus();
        inputRefs.current[nextItem.id]?.select();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const currentItem = filteredItems[currentIndex];
      if (currentItem) handleSaveParLevel(currentItem.id, Number(currentItem.par_level));
      const prevItem = filteredItems[currentIndex - 1];
      if (prevItem && inputRefs.current[prevItem.id]) {
        inputRefs.current[prevItem.id]?.focus();
        inputRefs.current[prevItem.id]?.select();
      }
    }
  };

  const isManagerOrOwner = currentRestaurant?.role === "OWNER" || currentRestaurant?.role === "MANAGER";

  const { categories: mappedCategories, itemCategoryMap, hasMappings } = useCategoryMapping(selectedList);

  // Derive category for each item: use mapping if available, else raw item.category
  const getItemCategory = (item: any): string => {
    if (hasMappings && itemCategoryMap[item.item_name]) {
      return itemCategoryMap[item.item_name].category_name;
    }
    return item.category || "Uncategorized";
  };

  const getItemSortOrder = (item: any): number => {
    if (hasMappings && itemCategoryMap[item.item_name]) {
      return itemCategoryMap[item.item_name].item_sort_order;
    }
    return 0;
  };

  const categories = hasMappings
    ? mappedCategories.map(c => c.name)
    : [...new Set(items.map(i => i.category).filter(Boolean))];

  const filteredItems = items.filter(i => {
    const cat = getItemCategory(i);
    if (filterCategory !== "all" && cat !== filterCategory) return false;
    if (search && !i.item_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Sort filtered items by mapped sort order when mappings exist
  if (hasMappings) {
    filteredItems.sort((a, b) => {
      const catA = getItemCategory(a);
      const catB = getItemCategory(b);
      const catSortA = mappedCategories.find(c => c.name === catA)?.sort_order ?? 999;
      const catSortB = mappedCategories.find(c => c.name === catB)?.sort_order ?? 999;
      if (catSortA !== catSortB) return catSortA - catSortB;
      return getItemSortOrder(a) - getItemSortOrder(b);
    });
  }

  const groupedItems = filteredItems.reduce<Record<string, any[]>>((acc, item) => {
    const cat = getItemCategory(item);
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  // Sort grouped category keys by mapped sort_order
  const sortedCategoryKeys = hasMappings
    ? Object.keys(groupedItems).sort((a, b) => {
        const sortA = mappedCategories.find(c => c.name === a)?.sort_order ?? 999;
        const sortB = mappedCategories.find(c => c.name === b)?.sort_order ?? 999;
        return sortA - sortB;
      })
    : Object.keys(groupedItems);

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-64" />
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">PAR Management</h1>
          <p className="page-description">Set target stock levels for each inventory list</p>
        </div>
      </div>

      {/* Sticky controls on compact */}
      <div className={`space-y-3 ${isCompact ? "sticky top-0 z-20 bg-background/95 backdrop-blur-sm -mx-4 px-4 py-3 border-b" : ""}`}>
        <Card className={isCompact ? "border-0 shadow-none" : ""}>
          <CardContent className={`space-y-4 ${isCompact ? "p-0" : "p-5"}`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm">View by Inventory List</Label>
                <Select value={selectedList} onValueChange={v => { setSelectedList(v); setSelectedGuide(null); setItems([]); }}>
                  <SelectTrigger className="h-10"><SelectValue placeholder="Select list" /></SelectTrigger>
                  <SelectContent>{lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {selectedList && isManagerOrOwner && (
                <div className="flex items-end">
                  <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
                    <DialogTrigger asChild>
                      <Button className="bg-gradient-amber shadow-amber gap-2" size="sm"><Plus className="h-4 w-4" /> New PAR Guide</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Create PAR Guide</DialogTitle></DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Guide Name</Label>
                          <Input value={newGuide} onChange={e => setNewGuide(e.target.value)} placeholder="e.g. Weekday PAR" className="h-10" />
                        </div>
                        <p className="text-xs text-muted-foreground">Items from the catalog will be pre-populated with default PAR levels.</p>
                        <Button onClick={handleCreateGuide} className="w-full bg-gradient-amber">Create</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </div>

            {/* PAR guide selector as dropdown on compact */}
            {selectedList && guides.length > 0 && isCompact && (
              <div className="space-y-2">
                <Label className="text-sm">PAR Guide</Label>
                <Select
                  value={selectedGuide?.id || ""}
                  onValueChange={v => {
                    const g = guides.find(g => g.id === v);
                    if (g) { setSelectedGuide(g); fetchItems(g.id); }
                  }}
                >
                  <SelectTrigger className="h-10"><SelectValue placeholder="Select guide" /></SelectTrigger>
                  <SelectContent>{guides.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Desktop guide cards */}
      {selectedList && !isCompact && (
        <div className="grid gap-3 sm:grid-cols-3">
          {guides.map(g => (
            <Card
              key={g.id}
              className={`cursor-pointer hover:shadow-card transition-all duration-200 ${selectedGuide?.id === g.id ? "ring-2 ring-primary shadow-card" : ""}`}
              onClick={() => { setSelectedGuide(g); fetchItems(g.id); }}
            >
              <CardContent className="p-4">
                <h4 className="font-semibold text-sm">{g.name}</h4>
                <p className="text-[11px] text-muted-foreground mt-1">{new Date(g.created_at).toLocaleDateString()}</p>
              </CardContent>
            </Card>
          ))}
          {guides.length === 0 && (
            <Card className="col-span-3">
              <CardContent className="empty-state py-10">
                <BookOpen className="empty-state-icon" />
                <p className="empty-state-title">No PAR guides for this list</p>
                <p className="empty-state-description">Create a PAR guide to set target stock levels.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Empty state for compact when no guides */}
      {selectedList && isCompact && guides.length === 0 && (
        <Card>
          <CardContent className="empty-state py-10">
            <BookOpen className="empty-state-icon" />
            <p className="empty-state-title">No PAR guides for this list</p>
            <p className="empty-state-description">Create a PAR guide to set target stock levels.</p>
          </CardContent>
        </Card>
      )}

      {selectedGuide && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold">{selectedGuide.name} — Items</h2>
            <div className="flex gap-2">
              <ExportButtons
                items={items.map(i => ({ item_name: i.item_name, category: i.category, unit: i.unit, par_level: i.par_level }))}
                filename={`par-${selectedGuide.name}`}
                type="inventory"
                meta={{ listName: selectedGuide.name }}
              />
              {isManagerOrOwner && items.length > 0 && !isCompact && (
                <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={handleSaveParLevels}>
                  <Save className="h-3.5 w-3.5" /> Save Levels
                </Button>
              )}
            </div>
          </div>

          {/* Search + category chips */}
          <div className="space-y-2">
            <div className="relative max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items..." className="pl-8 h-9 text-sm" />
            </div>
            {categories.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                <button
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterCategory === "all" ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"}`}
                  onClick={() => setFilterCategory("all")}
                >All</button>
                {categories.map(c => (
                  <button
                    key={c}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterCategory === c ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"}`}
                    onClick={() => setFilterCategory(c)}
                  >{c}</button>
                ))}
              </div>
            )}
          </div>

          {isCompact ? (
            /* ─── CARD LAYOUT (tablet/mobile) ─── */
            <div className="space-y-5">
              {sortedCategoryKeys.map((category) => {
                const catItems = groupedItems[category];
                return (
                <div key={category}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2 px-1">{category}</p>
                  <div className="space-y-2">
                    {catItems.map((item, idx) => {
                      const globalIdx = filteredItems.indexOf(item);
                      return (
                        <Card key={item.id} className="border shadow-sm">
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-sm truncate">{item.item_name}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {[item.unit, item.pack_size].filter(Boolean).join(" · ") || "—"}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {savingId === item.id && <span className="text-[10px] text-muted-foreground animate-pulse">Saving…</span>}
                                {savedId === item.id && <Check className="h-3.5 w-3.5 text-success" />}
                                {isManagerOrOwner && (
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDeleteItem(item.id)}>
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                )}
                              </div>
                            </div>
                            {isManagerOrOwner ? (
                              <div>
                                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">PAR Level</label>
                                <Input
                                  ref={el => { inputRefs.current[item.id] = el; }}
                                  inputMode="decimal"
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  value={item.par_level ?? ""}
                                  onChange={e => handleParLevelChange(item.id, e.target.value)}
                                  onBlur={() => handleSaveParLevel(item.id, Number(item.par_level))}
                                  onKeyDown={e => handleKeyDown(e, globalIdx)}
                                  className="h-12 text-lg font-mono text-center mt-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                              </div>
                            ) : (
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">PAR Level</span>
                                <span className="font-mono text-lg">{item.par_level}</span>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
                );
              })}
              {filteredItems.length === 0 && (
                <Card>
                  <CardContent className="text-center text-muted-foreground py-8 text-sm">
                    No items in this PAR guide.
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            /* ─── TABLE LAYOUT (desktop) ─── */
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs font-semibold">Item</TableHead>
                    <TableHead className="text-xs font-semibold">Category</TableHead>
                    <TableHead className="text-xs font-semibold">Unit</TableHead>
                    <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                    <TableHead className="text-xs font-semibold">PAR Level</TableHead>
                    {isManagerOrOwner && <TableHead className="w-10"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((i, idx) => (
                    <TableRow key={i.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-medium text-sm">{i.item_name}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px] font-normal">{getItemCategory(i)}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i.unit}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i.pack_size || "—"}</TableCell>
                      <TableCell>
                        {isManagerOrOwner ? (
                          <Input
                            ref={el => { inputRefs.current[i.id] = el; }}
                            inputMode="decimal"
                            type="number"
                            step="0.1"
                            min="0"
                            value={i.par_level ?? ""}
                            onChange={e => handleParLevelChange(i.id, e.target.value)}
                            onBlur={() => handleSaveParLevel(i.id, Number(i.par_level))}
                            onKeyDown={e => handleKeyDown(e, idx)}
                            className="w-20 h-8 text-sm font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        ) : (
                          <span className="font-mono text-sm">{i.par_level}</span>
                        )}
                      </TableCell>
                      {isManagerOrOwner && (
                        <TableCell>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDeleteItem(i.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {filteredItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8 text-sm">
                        No items in this PAR guide.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
