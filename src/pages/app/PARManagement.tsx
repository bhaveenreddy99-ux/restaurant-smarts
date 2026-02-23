import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
import { Plus, BookOpen, Trash2, Save, Check, Search, Upload, MoreVertical, FileSpreadsheet, Copy, Download, MapPin, List } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExportButtons } from "@/components/ExportButtons";
import { useIsCompact } from "@/hooks/use-mobile";
import { useCategoryMapping } from "@/hooks/useCategoryMapping";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PARImportDialog } from "@/components/par/PARImportDialog";
import ItemIdentityBlock from "@/components/ItemIdentityBlock";
import { useLastOrderDates } from "@/hooks/useLastOrderDates";
import { format } from "date-fns";

export default function PARManagementPage() {
  const { currentRestaurant, locations } = useRestaurant();
  const { user } = useAuth();
  const navigate = useNavigate();
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
  const [importOpen, setImportOpen] = useState(false);
  const [importExistingOpen, setImportExistingOpen] = useState(false);
  const [deleteGuide, setDeleteGuide] = useState<any>(null);
  const [guideCoverage, setGuideCoverage] = useState<Record<string, { total: number; covered: number }>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!currentRestaurant) return;
    setSelectedList("");
    setSelectedGuide(null);
    setGuides([]);
    setItems([]);
    setCatalogItems([]);
    setFilterCategory("all");
    setSearch("");
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
      .then(({ data }) => {
        if (data) {
          setGuides(data);
          // Fetch coverage for each guide
          fetchGuideCoverage(data, selectedList);
        }
      });
    supabase.from("inventory_catalog_items").select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("inventory_list_id", selectedList)
      .then(({ data }) => { if (data) setCatalogItems(data); });
  }, [currentRestaurant, selectedList]);

  const fetchGuideCoverage = async (guideList: any[], listId: string) => {
    // Get catalog item count for this list
    const { count: catalogCount } = await supabase
      .from("inventory_catalog_items")
      .select("id", { count: "exact", head: true })
      .eq("inventory_list_id", listId);

    const coverage: Record<string, { total: number; covered: number }> = {};
    for (const g of guideList) {
      const { count: parCount } = await supabase
        .from("par_guide_items")
        .select("id", { count: "exact", head: true })
        .eq("par_guide_id", g.id);
      coverage[g.id] = { total: catalogCount || 0, covered: parCount || 0 };
    }
    setGuideCoverage(coverage);
  };

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
    refreshGuides();
    setSelectedGuide(data);
    fetchItems(data.id);
  };

  const refreshGuides = async () => {
    if (!currentRestaurant || !selectedList) return;
    const { data } = await supabase.from("par_guides").select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("inventory_list_id", selectedList)
      .order("created_at", { ascending: false });
    if (data) {
      setGuides(data);
      fetchGuideCoverage(data, selectedList);
    }
  };

  const handleParLevelChange = (itemId: string, value: string) => {
    if (value === "") {
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, par_level: null } : i));
      return;
    }
    const numVal = parseFloat(value);
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

  const handleDeleteGuide = async (guide: any) => {
    if (!currentRestaurant) return;
    await supabase.from("par_guide_items").delete().eq("par_guide_id", guide.id);
    await supabase.from("par_guides").delete().eq("id", guide.id);
    toast.success("PAR guide deleted");
    setDeleteGuide(null);
    if (selectedGuide?.id === guide.id) { setSelectedGuide(null); setItems([]); }
    refreshGuides();
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
  const { lastOrderDates } = useLastOrderDates(currentRestaurant?.id);

  // Catalog lookup for product number and last order dates
  const catalogLookup = catalogItems.reduce<Record<string, any>>((acc, ci) => {
    acc[ci.item_name] = ci;
    return acc;
  }, {});

  const getItemProductNumber = (itemName: string): string | null => {
    const ci = catalogLookup[itemName];
    return ci?.product_number || ci?.vendor_sku || null;
  };

  const getItemLastOrdered = (itemName: string): string | null => {
    const ci = catalogLookup[itemName];
    return ci ? lastOrderDates[ci.id] || null : null;
  };

  const { categories: mappedCategories, itemCategoryMap, hasMappings } = useCategoryMapping(selectedList);

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

  const sortedCategoryKeys = hasMappings
    ? Object.keys(groupedItems).sort((a, b) => {
        const sortA = mappedCategories.find(c => c.name === a)?.sort_order ?? 999;
        const sortB = mappedCategories.find(c => c.name === b)?.sort_order ?? 999;
        return sortA - sortB;
      })
    : Object.keys(groupedItems);

  const getListName = (listId: string) => lists.find(l => l.id === listId)?.name || "";
  const getLocationName = (locId: string | null) => {
    if (!locId) return null;
    return locations.find(l => l.id === locId)?.name || null;
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-64" />
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
    );
  }

  if (!loading && lists.length === 0) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="page-header">
          <div>
            <h1 className="page-title">PAR Management</h1>
            <p className="page-description">Set target stock levels for each inventory list</p>
          </div>
        </div>
        <Card>
          <CardContent className="empty-state py-16">
            <BookOpen className="empty-state-icon" />
            <p className="empty-state-title">No inventory lists yet</p>
            <p className="empty-state-description">Create an inventory list first to start managing PAR levels.</p>
            <Button className="bg-gradient-amber shadow-amber gap-2 mt-4" onClick={() => navigate("/app/inventory/lists")}>
              Go to List Management
            </Button>
          </CardContent>
        </Card>
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
        {isManagerOrOwner && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
              <Upload className="h-3.5 w-3.5" /> Import PAR Guide
            </Button>
          </div>
        )}
      </div>

      {/* Sticky controls */}
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
                <div className="flex items-end gap-2">
                  <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
                    <DialogTrigger asChild>
                      <Button className="bg-gradient-amber shadow-amber gap-2" size="sm"><Plus className="h-4 w-4" /> Create from Saved List</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Create PAR Guide</DialogTitle></DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Guide Name</Label>
                          <Input value={newGuide} onChange={e => setNewGuide(e.target.value)} placeholder="e.g. Weekday PAR" className="h-10" />
                        </div>
                        <p className="text-xs text-muted-foreground">Items from "{getListName(selectedList)}" will be pre-populated with default PAR levels.</p>
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
                <div className="flex gap-2">
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
                  {isManagerOrOwner && selectedGuide && (
                    <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 text-destructive hover:text-destructive" onClick={() => setDeleteGuide(selectedGuide)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Desktop guide cards — enhanced */}
      {selectedList && !isCompact && (
        <div className="grid gap-3 sm:grid-cols-3">
          {guides.map(g => {
            const cov = guideCoverage[g.id];
            const locName = getLocationName(g.location_id);
            return (
              <Card
                key={g.id}
                className={`cursor-pointer hover:shadow-card transition-all duration-200 ${selectedGuide?.id === g.id ? "ring-2 ring-primary shadow-card" : ""}`}
                onClick={() => { setSelectedGuide(g); fetchItems(g.id); }}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <h4 className="font-semibold text-sm truncate">{g.name}</h4>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <List className="h-3 w-3" />
                          {getListName(g.inventory_list_id)}
                        </div>
                        {locName && (
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {locName}
                          </div>
                        )}
                      </div>
                    </div>
                    {isManagerOrOwner && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={e => e.stopPropagation()}>
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={e => { e.stopPropagation(); setDeleteGuide(g); }}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    {cov && (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${cov.total > 0 ? Math.round((cov.covered / cov.total) * 100) : 0}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground">{cov.covered}/{cov.total} items</span>
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground">{new Date(g.updated_at || g.created_at).toLocaleDateString()}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {guides.length === 0 && (
            <Card className="col-span-3">
              <CardContent className="empty-state py-10">
                <BookOpen className="empty-state-icon" />
                <p className="empty-state-title">No PAR guides for this list</p>
                <p className="empty-state-description">Create a PAR guide from the saved list or import one from a file.</p>
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
              {isManagerOrOwner && (
                <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setImportExistingOpen(true)}>
                  <Upload className="h-3.5 w-3.5" /> Import
                </Button>
              )}
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
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs font-semibold">Item</TableHead>
                    <TableHead className="text-xs font-semibold">Category</TableHead>
                    <TableHead className="text-xs font-semibold">Unit</TableHead>
                    <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                    <TableHead className="text-xs font-semibold">Product #</TableHead>
                    <TableHead className="text-xs font-semibold">Last Ordered</TableHead>
                    <TableHead className="text-xs font-semibold">PAR Level</TableHead>
                    {isManagerOrOwner && <TableHead className="w-10"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((i, idx) => (
                    <TableRow key={i.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell>
                        <span className="font-medium text-sm">{i.item_name}</span>
                        <ItemIdentityBlock
                          brandName={i.brand_name}
                          className="block mt-0.5"
                        />
                      </TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px] font-normal">{getItemCategory(i)}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i.unit}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i.pack_size || "—"}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground/60">{getItemProductNumber(i.item_name) || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {(() => {
                          const d = getItemLastOrdered(i.item_name);
                          return d ? format(new Date(d), "MM/dd/yy") : "—";
                        })()}
                      </TableCell>
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
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8 text-sm">
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

      {/* Standalone Import PAR Guide dialog (creates new guide) */}
      <PARImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImportComplete={() => { refreshGuides(); }}
      />

      {/* Import into existing guide */}
      {selectedGuide && (
        <PARImportDialog
          open={importExistingOpen}
          onOpenChange={setImportExistingOpen}
          existingGuideId={selectedGuide.id}
          existingGuideName={selectedGuide.name}
          preselectedListId={selectedList}
          onImportComplete={() => fetchItems(selectedGuide.id)}
        />
      )}

      <AlertDialog open={!!deleteGuide} onOpenChange={open => { if (!open) setDeleteGuide(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete PAR Guide</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteGuide?.name}" and all its PAR levels. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleDeleteGuide(deleteGuide)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
