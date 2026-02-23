import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Plus, Upload, Download, MoreVertical, Pencil, Trash2,
  Search, ArrowLeft, AlertTriangle, ShoppingCart, ChevronRight,
  GripVertical, Copy, LayoutList, FolderPlus, Check, X,
  Package, FolderOpen, ClipboardList, Menu, Sparkles, User, Clock,
  ChevronDown, MoveRight, Settings,
} from "lucide-react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { exportToCSV, exportToExcel, exportToPDF, parseFile } from "@/lib/export-utils";
import * as XLSX from "xlsx";
import ItemIdentityBlock from "@/components/ItemIdentityBlock";
import { useLastOrderDates } from "@/hooks/useLastOrderDates";

// ─── TYPES ──────────────────────────────────────
interface CatalogItem {
  id: string;
  restaurant_id: string;
  inventory_list_id: string | null;
  item_name: string;
  category: string | null;
  unit: string | null;
  pack_size: string | null;
  vendor_sku: string | null;
  product_number: string | null;
  default_unit_cost: number | null;
  default_par_level: number | null;
  vendor_name: string | null;
  metadata: any;
  sort_order: number;
  created_at: string;
  updated_at: string;
  list_category_id: string | null;
  brand_name: string | null;
}

interface IssueItem {
  id: string;
  item_name: string;
  category: string | null;
  unit: string | null;
  pack_size: string | null;
  vendor_sku: string | null;
  vendor_name: string | null;
  default_unit_cost: number | null;
  reasons: string[];
}

type ViewMode = "list-order" | "custom-categories" | "my-categories" | "recently-purchased";

interface ListCategory {
  id: string;
  list_id: string;
  name: string;
  sort_order: number;
  category_set_id: string | null;
}

interface CategorySet {
  id: string;
  list_id: string;
  set_type: "custom_ai" | "user_manual";
}

interface ItemCategoryMap {
  id: string;
  list_id: string;
  category_set_id: string;
  catalog_item_id: string;
  category_id: string | null;
  item_sort_order: number;
}

const AI_CATEGORY_MAP: Record<string, string[]> = {
  "Proteins": ["chicken", "beef", "pork", "fish", "salmon", "shrimp", "turkey", "lamb", "steak", "sausage", "bacon", "meat"],
  "Produce": ["lettuce", "tomato", "onion", "pepper", "carrot", "potato", "lime", "lemon", "garlic", "celery", "cucumber", "avocado", "mushroom", "herb", "basil", "cilantro", "parsley"],
  "Dairy": ["milk", "cream", "cheese", "butter", "yogurt", "egg", "sour cream"],
  "Frozen": ["frozen", "ice cream", "fries", "ice"],
  "Beverages": ["juice", "soda", "water", "vodka", "rum", "gin", "tequila", "wine", "beer", "whiskey", "bourbon", "cocktail", "coffee", "tea"],
  "Dry Goods": ["oil", "flour", "sugar", "rice", "pasta", "bread", "buns", "salt", "spice", "seasoning", "sauce", "vinegar", "mustard", "ketchup"],
  "Cleaning": ["soap", "sanitizer", "bleach", "cleaner", "detergent", "wipe", "sponge", "trash", "glove"],
  "Paper/Disposable": ["napkin", "paper", "cup", "plate", "foil", "wrap", "bag", "container", "lid", "straw", "towel"],
};

function getAICategory(itemName: string): string {
  const lower = itemName.toLowerCase();
  for (const [cat, keywords] of Object.entries(AI_CATEGORY_MAP)) {
    if (keywords.some(k => lower.includes(k))) return cat;
  }
  return "Other";
}

// ─── ISSUE ROW WITH INLINE QUICK FIX ────────────
function IssueRow({ item, onFix, onQuickSave }: {
  item: IssueItem;
  onFix: (item: IssueItem) => void;
  onQuickSave: (id: string, updates: Record<string, any>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [vendorSku, setVendorSku] = useState(item.vendor_sku || "");
  const [vendorName, setVendorName] = useState(item.vendor_name || "");
  const [unitCost, setUnitCost] = useState(item.default_unit_cost != null ? String(item.default_unit_cost) : "");

  if (editing) {
    return (
      <TableRow>
        <TableCell className="font-medium text-sm">{item.item_name}</TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {item.reasons.map(r => (
              <Badge key={r} variant={r.includes("Duplicate") ? "destructive" : "secondary"} className="text-[10px]">{r}</Badge>
            ))}
          </div>
        </TableCell>
        <TableCell><Input className="h-7 text-xs w-24" value={vendorSku} onChange={e => setVendorSku(e.target.value)} placeholder="Product #" /></TableCell>
        <TableCell><Input className="h-7 text-xs w-24" value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Vendor" /></TableCell>
        <TableCell className="text-xs">{item.unit || <span className="text-destructive">Missing</span>}</TableCell>
        <TableCell className="text-xs">{item.pack_size || <span className="text-destructive">Missing</span>}</TableCell>
        <TableCell>
          <div className="flex gap-1">
            <Button size="sm" variant="default" className="h-7 text-xs px-2 bg-gradient-amber" onClick={async () => {
              const updates: Record<string, any> = {};
              if (vendorSku) updates.vendor_sku = vendorSku;
              if (vendorName) updates.vendor_name = vendorName;
              if (unitCost) updates.default_unit_cost = parseFloat(unitCost) || null;
              if (Object.keys(updates).length > 0) await onQuickSave(item.id, updates);
              setEditing(false);
            }}>
              <Check className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="font-medium text-sm">{item.item_name}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {item.reasons.map(r => (
            <Badge key={r} variant={r.includes("Duplicate") ? "destructive" : "secondary"} className="text-[10px]">{r}</Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-xs">{item.vendor_sku || <span className="text-destructive">Missing</span>}</TableCell>
      <TableCell className="text-xs">{item.vendor_name || <span className="text-destructive">Missing</span>}</TableCell>
      <TableCell className="text-xs">{item.unit || <span className="text-destructive">Missing</span>}</TableCell>
      <TableCell className="text-xs">{item.pack_size || <span className="text-destructive">Missing</span>}</TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3 mr-1" /> Quick Fix
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => onFix(item)}>
            Full Edit
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── COMPONENT ──────────────────────────────────
export default function ListManagementPage() {
  const { currentRestaurant, currentLocation } = useRestaurant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const restaurantId = currentRestaurant?.id;
  const { lastOrderDates } = useLastOrderDates(restaurantId, currentLocation?.id);

  // ── Grid state
  const [lists, setLists] = useState<any[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [gridSearch, setGridSearch] = useState("");
  const [gridSort, setGridSort] = useState<"date" | "name">("date");
  const [createOpen, setCreateOpen] = useState(false);
  const [newListName, setNewListName] = useState("");

  // ── Detail state
  const [selectedList, setSelectedList] = useState<any>(null);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [detailSearch, setDetailSearch] = useState("");
  const [activeTab, setActiveTab] = useState("items");
  const [reorderMode, setReorderMode] = useState(false);

  // ── View mode
  const [viewMode, setViewMode] = useState<ViewMode>("list-order");

  // ── List categories (per-list, per-set)
  const [listCategories, setListCategories] = useState<ListCategory[]>([]);
  const [newListCategoryName, setNewListCategoryName] = useState("");

  // ── Category sets & mappings
  const [categorySets, setCategorySets] = useState<CategorySet[]>([]);
  const [itemCategoryMaps, setItemCategoryMaps] = useState<ItemCategoryMap[]>([]);

  // ── Bulk select
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMoveTarget, setBulkMoveTarget] = useState("");

  // ── Inline edit
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<any>({});

  // ── Add item
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [newItem, setNewItem] = useState({ item_name: "", category: "", unit: "", pack_size: "", vendor_sku: "", vendor_name: "", default_unit_cost: 0 });

  // ── Rename/Delete
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameListId, setRenameListId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteListId, setDeleteListId] = useState<string | null>(null);

  // ── Import
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "map" | "preview">("upload");
  const [importData, setImportData] = useState<any[]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importMapping, setImportMapping] = useState<Record<string, string>>({});
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importTargetList, setImportTargetList] = useState<string>("new");
  const [importNewListName, setImportNewListName] = useState("");
  const [importSummary, setImportSummary] = useState<{ created: number; duplicates: number; missing: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Category manager
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);

  // ── Issues
  const [issues, setIssues] = useState<IssueItem[]>([]);

  // ── Purchase History
  const [purchaseHistory, setPurchaseHistory] = useState<any[]>([]);
  const [phItems, setPhItems] = useState<Record<string, any[]>>({});

  // ── Recently purchased items (for view mode)
  const [recentPurchasedItems, setRecentPurchasedItems] = useState<any[]>([]);

  // ── Auto-save
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Collapsible categories
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const toggleCategoryCollapse = (catName: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catName)) next.delete(catName); else next.add(catName);
      return next;
    });
  };

  const requiredMapFields = ["item_name", "unit", "pack_size"];
  const optionalMapFields = ["vendor_sku", "default_unit_cost", "brand_name"];

  // ─── HELPER: Get or create category set ───────
  const getOrCreateCategorySet = async (listId: string, setType: "custom_ai" | "user_manual"): Promise<CategorySet> => {
    const existing = categorySets.find(s => s.list_id === listId && s.set_type === setType);
    if (existing) return existing;
    const { data, error } = await supabase.from("list_category_sets").insert({
      list_id: listId, set_type: setType,
    }).select().single();
    if (error) throw error;
    const newSet = data as CategorySet;
    setCategorySets(prev => [...prev, newSet]);
    return newSet;
  };

  // ─── HELPER: Get categories for current mode ──
  const getCurrentSetId = (): string | null => {
    if (!selectedList) return null;
    const setType = viewMode === "custom-categories" ? "custom_ai" : viewMode === "my-categories" ? "user_manual" : null;
    if (!setType) return null;
    const set = categorySets.find(s => s.list_id === selectedList.id && s.set_type === setType);
    return set?.id || null;
  };

  const getCurrentCategories = (): ListCategory[] => {
    const setId = getCurrentSetId();
    if (!setId) return [];
    return listCategories.filter(c => c.category_set_id === setId);
  };

  const getCurrentMappings = (): ItemCategoryMap[] => {
    const setId = getCurrentSetId();
    if (!setId) return [];
    return itemCategoryMaps.filter(m => m.category_set_id === setId);
  };

  // ─── FETCH LISTS ──────────────────────────────
  const fetchLists = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    const { data } = await supabase
      .from("inventory_lists")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });
    if (data) {
      setLists(data);
      const { data: catalog } = await supabase
        .from("inventory_catalog_items")
        .select("id, inventory_list_id")
        .eq("restaurant_id", restaurantId);
      if (catalog) {
        const counts: Record<string, number> = {};
        catalog.forEach(i => {
          if (i.inventory_list_id) counts[i.inventory_list_id] = (counts[i.inventory_list_id] || 0) + 1;
        });
        setItemCounts(counts);
      }
    }
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => { fetchLists(); }, [fetchLists]);

  // ─── LIST CRUD ────────────────────────────────
  const handleCreateList = async () => {
    if (!restaurantId || !user || !newListName.trim()) return;
    const { error } = await supabase.from("inventory_lists").insert({
      restaurant_id: restaurantId, name: newListName.trim(), created_by: user.id,
    });
    if (error) toast.error(error.message);
    else { toast.success("List created"); setNewListName(""); setCreateOpen(false); fetchLists(); }
  };

  const handleRename = async () => {
    if (!renameListId || !renameValue.trim()) return;
    const { error } = await supabase.from("inventory_lists").update({ name: renameValue.trim() }).eq("id", renameListId);
    if (error) toast.error(error.message);
    else {
      toast.success("List renamed");
      setRenameOpen(false);
      if (selectedList?.id === renameListId) setSelectedList({ ...selectedList, name: renameValue.trim() });
      fetchLists();
    }
  };

  const handleDuplicate = async (list: any) => {
    if (!restaurantId || !user) return;
    const { data: newList, error } = await supabase.from("inventory_lists").insert({
      restaurant_id: restaurantId, name: `${list.name} (Copy)`, created_by: user.id,
    }).select().single();
    if (error || !newList) { toast.error("Failed to duplicate"); return; }
    const { data: items } = await supabase.from("inventory_catalog_items").select("*").eq("inventory_list_id", list.id);
    if (items && items.length > 0) {
      const copies = items.map(({ id, created_at, updated_at, ...rest }) => ({
        ...rest, inventory_list_id: newList.id,
      }));
      await supabase.from("inventory_catalog_items").insert(copies);
    }
    toast.success("List duplicated");
    fetchLists();
  };

  const handleDelete = async () => {
    if (!deleteListId) return;
    // Delete category sets & mappings (cascade handles most)
    await supabase.from("list_item_category_map").delete().eq("list_id", deleteListId);
    await supabase.from("list_categories").delete().eq("list_id", deleteListId);
    await supabase.from("list_category_sets").delete().eq("list_id", deleteListId);
    
    const cascadeTables = ["inventory_catalog_items", "inventory_import_files", "import_runs", "import_templates"] as const;
    for (const table of cascadeTables) {
      await supabase.from(table).delete().eq("inventory_list_id", deleteListId);
    }
    const { data: sessions } = await supabase.from("inventory_sessions").select("id").eq("inventory_list_id", deleteListId);
    if (sessions?.length) {
      const sIds = sessions.map(s => s.id);
      await supabase.from("inventory_session_items").delete().in("session_id", sIds);
      const { data: runs } = await supabase.from("smart_order_runs").select("id").in("session_id", sIds);
      if (runs?.length) {
        const rIds = runs.map(r => r.id);
        await supabase.from("smart_order_run_items").delete().in("run_id", rIds);
        const { data: purchases } = await supabase.from("purchase_history").select("id").in("smart_order_run_id", rIds);
        if (purchases?.length) {
          await supabase.from("purchase_history_items").delete().in("purchase_history_id", purchases.map(p => p.id));
          await supabase.from("purchase_history").delete().in("id", purchases.map(p => p.id));
        }
        await supabase.from("smart_order_runs").delete().in("id", rIds);
      }
      await supabase.from("inventory_sessions").delete().eq("inventory_list_id", deleteListId);
    }
    const { data: listRuns } = await supabase.from("smart_order_runs").select("id").eq("inventory_list_id", deleteListId);
    if (listRuns?.length) {
      const rIds = listRuns.map(r => r.id);
      await supabase.from("smart_order_run_items").delete().in("run_id", rIds);
      const { data: purchases } = await supabase.from("purchase_history").select("id").in("smart_order_run_id", rIds);
      if (purchases?.length) {
        await supabase.from("purchase_history_items").delete().in("purchase_history_id", purchases.map(p => p.id));
        await supabase.from("purchase_history").delete().in("id", purchases.map(p => p.id));
      }
      await supabase.from("smart_order_runs").delete().in("id", rIds);
    }
    const { data: listPurchases } = await supabase.from("purchase_history").select("id").eq("inventory_list_id", deleteListId);
    if (listPurchases?.length) {
      await supabase.from("purchase_history_items").delete().in("purchase_history_id", listPurchases.map(p => p.id));
      await supabase.from("purchase_history").delete().in("id", listPurchases.map(p => p.id));
    }
    const { data: parGuides } = await supabase.from("par_guides").select("id").eq("inventory_list_id", deleteListId);
    if (parGuides?.length) {
      await supabase.from("par_guide_items").delete().in("par_guide_id", parGuides.map(g => g.id));
      await supabase.from("par_guides").delete().eq("inventory_list_id", deleteListId);
    }
    const { error } = await supabase.from("inventory_lists").delete().eq("id", deleteListId);
    if (error) toast.error(error.message);
    else {
      toast.success("List deleted");
      setDeleteListId(null);
      if (selectedList?.id === deleteListId) setSelectedList(null);
      fetchLists();
    }
  };

  // ─── OPEN LIST DETAIL ─────────────────────────
  const openListDetail = useCallback(async (list: any) => {
    setSelectedList(list);
    setDetailSearch("");
    setActiveTab("items");
    setEditingItem(null);
    setSelectedItems(new Set());

    // Set view mode from saved active_category_mode
    const modeMap: Record<string, ViewMode> = {
      list_order: "list-order",
      custom_ai: "custom-categories",
      user_manual: "my-categories",
      recently_purchased: "recently-purchased",
    };
    setViewMode(modeMap[list.active_category_mode] || "list-order");

    const [catalogRes, catsRes, setsRes, mapsRes] = await Promise.all([
      supabase.from("inventory_catalog_items").select("*").eq("inventory_list_id", list.id).order("sort_order", { ascending: true }),
      supabase.from("list_categories").select("*").eq("list_id", list.id).order("sort_order", { ascending: true }),
      supabase.from("list_category_sets").select("*").eq("list_id", list.id),
      supabase.from("list_item_category_map").select("*").eq("list_id", list.id).order("item_sort_order", { ascending: true }),
    ]);

    if (catalogRes.data) {
      setCatalogItems(catalogRes.data as CatalogItem[]);
      computeIssues(catalogRes.data as CatalogItem[]);
    }
    setListCategories((catsRes.data || []) as ListCategory[]);
    setCategorySets((setsRes.data || []) as CategorySet[]);
    setItemCategoryMaps((mapsRes.data || []) as ItemCategoryMap[]);

    // Fetch purchase history for this list
    const { data: ph } = await supabase
      .from("purchase_history")
      .select("*, inventory_lists(name)")
      .eq("restaurant_id", restaurantId!)
      .eq("inventory_list_id", list.id)
      .order("created_at", { ascending: false })
      .limit(10);
    if (ph) {
      setPurchaseHistory(ph);
      const itemMap: Record<string, any[]> = {};
      for (const p of ph) {
        const { data: items } = await supabase.from("purchase_history_items").select("*").eq("purchase_history_id", p.id);
        if (items) itemMap[p.id] = items;
      }
      setPhItems(itemMap);
    }
    // Fetch all recent purchase items for "recently purchased" view
    const { data: allPh } = await supabase
      .from("purchase_history")
      .select("id, created_at, vendor_name")
      .eq("restaurant_id", restaurantId!)
      .order("created_at", { ascending: false })
      .limit(20);
    if (allPh?.length) {
      const allPhItems: any[] = [];
      for (const p of allPh) {
        const { data: items } = await supabase.from("purchase_history_items").select("*").eq("purchase_history_id", p.id);
        if (items) {
          items.forEach(item => {
            allPhItems.push({ ...item, purchase_date: p.created_at, vendor_name: p.vendor_name });
          });
        }
      }
      const seen = new Map<string, any>();
      allPhItems.forEach(item => {
        const key = (item.item_name || "").toLowerCase().trim();
        if (!seen.has(key) || new Date(item.purchase_date) > new Date(seen.get(key).purchase_date)) {
          seen.set(key, item);
        }
      });
      setRecentPurchasedItems(Array.from(seen.values()));
    } else {
      setRecentPurchasedItems([]);
    }
  }, [restaurantId]);

  // ─── ISSUES COMPUTATION ───────────────────────
  const computeIssues = (items: CatalogItem[]) => {
    const nameMap: Record<string, number> = {};
    items.forEach(i => {
      const norm = i.item_name.trim().toLowerCase();
      nameMap[norm] = (nameMap[norm] || 0) + 1;
    });
    const result: IssueItem[] = [];
    items.forEach((item) => {
      const reasons: string[] = [];
      if (!item.unit) reasons.push("Missing Unit");
      if (!item.pack_size) reasons.push("Missing Pack Size");
      if (!item.vendor_sku) reasons.push("Missing Product Number");
      if (!item.vendor_name) reasons.push("Missing Vendor Name");
      if (item.default_unit_cost == null) reasons.push("Missing Unit Cost");
      const norm = item.item_name.trim().toLowerCase();
      if (nameMap[norm] > 1) reasons.push("Duplicate Item Name");
      if (reasons.length > 0) {
        result.push({ ...item, reasons });
      }
    });
    setIssues(result);
  };

  // ─── ITEM CRUD ────────────────────────────────
  const handleAddItemToList = async () => {
    if (!selectedList || !restaurantId || !newItem.item_name.trim()) return;
    const maxOrder = catalogItems.length > 0 ? Math.max(...catalogItems.map(i => i.sort_order || 0)) + 1 : 0;
    const { error } = await supabase.from("inventory_catalog_items").insert({
      restaurant_id: restaurantId,
      inventory_list_id: selectedList.id,
      item_name: newItem.item_name.trim(),
      category: newItem.category || null,
      unit: newItem.unit || null,
      pack_size: newItem.pack_size || null,
      vendor_sku: newItem.vendor_sku || null,
      vendor_name: newItem.vendor_name || null,
      default_unit_cost: newItem.default_unit_cost || null,
      sort_order: maxOrder,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Item added");
      setNewItem({ item_name: "", category: "", unit: "", pack_size: "", vendor_sku: "", vendor_name: "", default_unit_cost: 0 });
      setAddItemOpen(false);
      openListDetail(selectedList);
    }
  };

  const handleSaveEdit = async (itemId: string) => {
    setSaveStatus("saving");
    const { error } = await supabase.from("inventory_catalog_items").update(editValues).eq("id", itemId);
    if (error) { toast.error(error.message); setSaveStatus("idle"); }
    else {
      setEditingItem(null);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      openListDetail(selectedList);
      fetchLists();
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    // Also delete any category mappings for this item
    await supabase.from("list_item_category_map").delete().eq("catalog_item_id", itemId);
    const { error } = await supabase.from("inventory_catalog_items").delete().eq("id", itemId);
    if (error) toast.error(error.message);
    else openListDetail(selectedList);
  };

  const handleDuplicateItem = async (item: CatalogItem) => {
    if (!selectedList || !restaurantId) return;
    const maxOrder = catalogItems.length > 0 ? Math.max(...catalogItems.map(i => i.sort_order || 0)) + 1 : 0;
    const { error } = await supabase.from("inventory_catalog_items").insert({
      restaurant_id: restaurantId,
      inventory_list_id: selectedList.id,
      item_name: `${item.item_name} (Copy)`,
      category: item.category,
      unit: item.unit,
      pack_size: item.pack_size,
      vendor_sku: item.vendor_sku,
      vendor_name: item.vendor_name,
      default_unit_cost: item.default_unit_cost,
      sort_order: maxOrder,
    });
    if (error) toast.error(error.message);
    else { toast.success("Item duplicated"); openListDetail(selectedList); }
  };

  // ─── UPDATE ACTIVE CATEGORY MODE ─────────────
  const updateActiveCategoryMode = async (mode: ViewMode) => {
    if (!selectedList) return;
    const dbMode = mode === "custom-categories" ? "custom_ai" : mode === "my-categories" ? "user_manual" : mode === "recently-purchased" ? "recently_purchased" : "list_order";
    await supabase.from("inventory_lists").update({ active_category_mode: dbMode }).eq("id", selectedList.id);
    setSelectedList({ ...selectedList, active_category_mode: dbMode });
  };

  // ─── DRAG & DROP ──────────────────────────────
  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const { source, destination } = result;
    const itemId = result.draggableId;

    if (viewMode === "my-categories" || viewMode === "custom-categories") {
      const setType = viewMode === "custom-categories" ? "custom_ai" : "user_manual";
      const currentCats = getCurrentCategories();
      const currentMaps = getCurrentMappings();
      const grouped = getGroupedItems();
      const sourceCatName = source.droppableId;
      const destCatName = destination.droppableId;

      const sourceItems = [...(grouped[sourceCatName] || [])];
      const destItems = sourceCatName === destCatName ? sourceItems : [...(grouped[destCatName] || [])];

      const [movedItem] = sourceItems.splice(source.index, 1);
      if (!movedItem) return;

      const targetCat = currentCats.find(c => c.name === destCatName);
      const newCategoryId = destCatName === "Uncategorized" ? null : (targetCat?.id || null);

      // Get or create category set
      const set = await getOrCreateCategorySet(selectedList.id, setType);

      if (sourceCatName === destCatName) {
        // Within-category reorder
        sourceItems.splice(destination.index, 0, movedItem);
        // Update mappings optimistically
        const updatedMaps = [...itemCategoryMaps];
        sourceItems.forEach((item, i) => {
          const mapIdx = updatedMaps.findIndex(m => m.category_set_id === set.id && m.catalog_item_id === item.id);
          if (mapIdx >= 0) updatedMaps[mapIdx] = { ...updatedMaps[mapIdx], item_sort_order: i };
        });
        setItemCategoryMaps(updatedMaps);
        setSaveStatus("saving");
        const updates = sourceItems.map((item, i) =>
          supabase.from("list_item_category_map").upsert({
            list_id: selectedList.id, category_set_id: set.id, catalog_item_id: item.id,
            category_id: currentMaps.find(m => m.catalog_item_id === item.id)?.category_id || null,
            item_sort_order: i,
          }, { onConflict: "category_set_id,catalog_item_id" })
        );
        await Promise.all(updates);
      } else {
        // Cross-category move
        destItems.splice(destination.index, 0, movedItem);
        const updatedMaps = [...itemCategoryMaps];
        // Update moved item's category
        const movedMapIdx = updatedMaps.findIndex(m => m.category_set_id === set.id && m.catalog_item_id === movedItem.id);
        if (movedMapIdx >= 0) {
          updatedMaps[movedMapIdx] = { ...updatedMaps[movedMapIdx], category_id: newCategoryId, item_sort_order: destination.index };
        }
        // Re-sort source
        sourceItems.forEach((item, i) => {
          const idx = updatedMaps.findIndex(m => m.category_set_id === set.id && m.catalog_item_id === item.id);
          if (idx >= 0) updatedMaps[idx] = { ...updatedMaps[idx], item_sort_order: i };
        });
        // Re-sort destination
        destItems.forEach((item, i) => {
          const idx = updatedMaps.findIndex(m => m.category_set_id === set.id && m.catalog_item_id === item.id);
          if (idx >= 0) updatedMaps[idx] = { ...updatedMaps[idx], item_sort_order: i };
        });
        setItemCategoryMaps(updatedMaps);
        setSaveStatus("saving");
        const updates: Promise<any>[] = [];
        // Upsert moved item
        updates.push(Promise.resolve(supabase.from("list_item_category_map").upsert({
          list_id: selectedList.id, category_set_id: set.id, catalog_item_id: movedItem.id,
          category_id: newCategoryId, item_sort_order: destination.index,
        }, { onConflict: "category_set_id,catalog_item_id" }).select()));
        // Re-sort source
        sourceItems.forEach((item, i) => {
          updates.push(Promise.resolve(supabase.from("list_item_category_map").upsert({
            list_id: selectedList.id, category_set_id: set.id, catalog_item_id: item.id,
            category_id: currentMaps.find(m => m.catalog_item_id === item.id)?.category_id || null,
            item_sort_order: i,
          }, { onConflict: "category_set_id,catalog_item_id" }).select()));
        });
        // Re-sort destination
        destItems.forEach((item, i) => {
          if (item.id !== movedItem.id) {
            const map = currentMaps.find(m => m.catalog_item_id === item.id);
            updates.push(Promise.resolve(supabase.from("list_item_category_map").upsert({
              list_id: selectedList.id, category_set_id: set.id, catalog_item_id: item.id,
              category_id: map?.category_id || newCategoryId,
              item_sort_order: i,
            }, { onConflict: "category_set_id,catalog_item_id" }).select()));
          }
        });
        await Promise.all(updates);
      }
      setSaveStatus("saved");
      toast.success("Saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      return;
    }

    // Default list-order reorder
    const filtered = getFilteredItems();
    const reordered = Array.from(filtered);
    const [moved] = reordered.splice(source.index, 1);
    reordered.splice(destination.index, 0, moved);
    const updatedItems = catalogItems.map(ci => {
      const idx = reordered.findIndex(ri => ri.id === ci.id);
      if (idx !== -1) return { ...ci, sort_order: idx };
      return ci;
    });
    setCatalogItems(updatedItems);
    setSaveStatus("saving");
    const updates2 = reordered.map((item, i) =>
      supabase.from("inventory_catalog_items").update({ sort_order: i }).eq("id", item.id)
    );
    await Promise.all(updates2);
    setSaveStatus("saved");
    toast.success("Saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  };

  // ─── BULK OPERATIONS ─────────────────────────
  const toggleSelectItem = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const filtered = getFilteredItems();
    if (selectedItems.size === filtered.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filtered.map(i => i.id)));
    }
  };

  const handleBulkMove = async () => {
    if (!selectedList || selectedItems.size === 0) return;
    const setType = viewMode === "custom-categories" ? "custom_ai" : "user_manual";
    const set = await getOrCreateCategorySet(selectedList.id, setType);
    const targetCatId = bulkMoveTarget === "__uncategorized" ? null : bulkMoveTarget;
    
    // Find existing items in target category to determine starting sort_order
    const currentMaps = getCurrentMappings();
    const existingInTarget = currentMaps.filter(m => {
      if (targetCatId === null) return !m.category_id;
      return m.category_id === targetCatId;
    }).filter(m => !selectedItems.has(m.catalog_item_id));
    let nextOrder = existingInTarget.length > 0 ? Math.max(...existingInTarget.map(m => m.item_sort_order || 0)) + 1 : 0;

    // Optimistic update
    const updatedMaps = [...itemCategoryMaps];
    const newMaps: ItemCategoryMap[] = [];
    for (const itemId of selectedItems) {
      const existingIdx = updatedMaps.findIndex(m => m.category_set_id === set.id && m.catalog_item_id === itemId);
      if (existingIdx >= 0) {
        updatedMaps[existingIdx] = { ...updatedMaps[existingIdx], category_id: targetCatId, item_sort_order: nextOrder++ };
      } else {
        newMaps.push({
          id: crypto.randomUUID(),
          list_id: selectedList.id,
          category_set_id: set.id,
          catalog_item_id: itemId,
          category_id: targetCatId,
          item_sort_order: nextOrder++,
        });
      }
    }
    setItemCategoryMaps([...updatedMaps, ...newMaps]);
    setSaveStatus("saving");

    // DB writes
    nextOrder = existingInTarget.length > 0 ? Math.max(...existingInTarget.map(m => m.item_sort_order || 0)) + 1 : 0;
    const updates = Array.from(selectedItems).map(id => {
      const order = nextOrder++;
      return supabase.from("list_item_category_map").upsert({
        list_id: selectedList.id, category_set_id: set.id, catalog_item_id: id,
        category_id: targetCatId, item_sort_order: order,
      }, { onConflict: "category_set_id,catalog_item_id" });
    });
    await Promise.all(updates);

    setSaveStatus("saved");
    toast.success(`Moved ${selectedItems.size} items`);
    setTimeout(() => setSaveStatus("idle"), 2000);
    setSelectedItems(new Set());
    setBulkMoveOpen(false);
    setBulkMoveTarget("");
    // Refresh mappings
    const { data: refreshedMaps } = await supabase.from("list_item_category_map").select("*").eq("list_id", selectedList.id);
    if (refreshedMaps) setItemCategoryMaps(refreshedMaps as ItemCategoryMap[]);
  };

  const handleSaveAICategories = async () => {
    if (!selectedList) return;
    setSaveStatus("saving");
    
    // Get or create custom_ai set
    const set = await getOrCreateCategorySet(selectedList.id, "custom_ai");

    // Delete existing AI categories and mappings for this set
    await supabase.from("list_item_category_map").delete().eq("category_set_id", set.id);
    await supabase.from("list_categories").delete().eq("category_set_id", set.id);

    // Create categories from AI groupings
    const aiGroups = new Set<string>();
    catalogItems.forEach(item => {
      const cat = getAICategory(item.item_name);
      aiGroups.add(cat);
    });

    const catMap: Record<string, string> = {};
    let sortIdx = 0;
    for (const catName of aiGroups) {
      const { data } = await supabase.from("list_categories").insert({
        list_id: selectedList.id, name: catName, sort_order: sortIdx++, category_set_id: set.id,
      }).select().single();
      if (data) catMap[catName] = data.id;
    }

    // Create mappings for each item
    const mappings = catalogItems.map((item, idx) => {
      const aiCat = getAICategory(item.item_name);
      return {
        list_id: selectedList.id,
        category_set_id: set.id,
        catalog_item_id: item.id,
        category_id: catMap[aiCat] || null,
        item_sort_order: idx,
      };
    });
    if (mappings.length > 0) {
      await supabase.from("list_item_category_map").insert(mappings);
    }

    // Update active mode
    await updateActiveCategoryMode("custom-categories");

    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
    toast.success("AI categories saved to this list");
    openListDetail(selectedList);
  };

  const handleSaveMyCategories = async () => {
    if (!selectedList) return;
    setSaveStatus("saving");
    try {
      const set = await getOrCreateCategorySet(selectedList.id, "user_manual");
      const currentCats = listCategories.filter(c => c.category_set_id === set.id);
      const currentMaps = itemCategoryMaps.filter(m => m.category_set_id === set.id);

      // Build upsert payload for every catalog item in this list
      const mappings = catalogItems.map((item, idx) => {
        const existing = currentMaps.find(m => m.catalog_item_id === item.id);
        return {
          list_id: selectedList.id,
          category_set_id: set.id,
          catalog_item_id: item.id,
          category_id: existing?.category_id || null,
          item_sort_order: existing?.item_sort_order ?? idx,
        };
      });

      if (mappings.length > 0) {
        await supabase.from("list_item_category_map").upsert(mappings, { onConflict: "category_set_id,catalog_item_id" });
      }

      await updateActiveCategoryMode("my-categories");
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      toast.success("My categories saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
      setSaveStatus("idle");
    }
  };

  // ─── IMPORT ───────────────────────────────────
  const resetImport = () => {
    setImportStep("upload");
    setImportData([]);
    setImportHeaders([]);
    setImportMapping({});
    setImportPreview([]);
    setImportSummary(null);
    setImportTargetList("new");
    setImportNewListName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { headers, rows } = await parseFile(file);
      if (rows.length === 0) { toast.error("No data found"); return; }
      setImportData(rows);
      setImportHeaders(headers);
      const autoMap: Record<string, string> = {};
      const synonyms: Record<string, string[]> = {
        item_name: ["item", "itemname", "name", "product", "productname", "description"],
        unit: ["unit", "uom", "unitofmeasure", "measure"],
        pack_size: ["packsize", "pack", "size", "casesize", "casepack"],
        vendor_sku: ["sku", "vendorsku", "itemnumber", "itemno", "itemcode", "upc", "productcode", "productnumber"],
        default_unit_cost: ["cost", "price", "unitcost", "unitprice", "caseprice"],
        brand_name: ["brand", "brandname", "manufacturer", "mfg", "mfgbrand"],
      };
      for (const h of headers) {
        const lower = h.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const [field, syns] of Object.entries(synonyms)) {
          if (syns.some(s => lower.includes(s))) {
            if (!autoMap[field]) autoMap[field] = h;
          }
        }
      }
      if (restaurantId) {
        const { data: templates } = await supabase
          .from("import_templates")
          .select("*")
          .eq("restaurant_id", restaurantId)
          .order("last_used_at", { ascending: false })
          .limit(5);
        if (templates?.length) {
          const headerSet = new Set(headers.map(h => h.toLowerCase()));
          for (const t of templates) {
            const mapping = t.mapping_json as Record<string, string>;
            const allMatch = Object.values(mapping).every(v => headerSet.has(v.toLowerCase()));
            if (allMatch) {
              setImportMapping(mapping);
              toast.info(`Auto-applied mapping template: ${t.name}`);
              setImportStep("map");
              return;
            }
          }
        }
      }
      setImportMapping(autoMap);
      setImportStep("map");
    } catch {
      toast.error("Failed to read file");
    }
  };

  const handleImportPreview = () => {
    const missing = requiredMapFields.filter(f => !importMapping[f]);
    if (missing.length > 0) {
      toast.error(`Map required fields: ${missing.map(f => f.replace("_", " ")).join(", ")}`);
      return;
    }
    let dupes = 0;
    let missingCount = 0;
    const seenNames = new Set<string>();
    const preview = importData.map((row, idx) => {
      const itemName = String(row[importMapping.item_name] || "").trim();
      const unit = String(row[importMapping.unit] || "").trim();
      const packSize = String(row[importMapping.pack_size] || "").trim();
      const vendorSku = importMapping.vendor_sku ? String(row[importMapping.vendor_sku] || "").trim() : "";
      const unitCost = importMapping.default_unit_cost ? parseFloat(row[importMapping.default_unit_cost]) || null : null;
      const brandName = importMapping.brand_name ? String(row[importMapping.brand_name] || "").trim() : "";
      if (!itemName) { missingCount++; return null; }
      if (seenNames.has(itemName.toLowerCase())) dupes++;
      seenNames.add(itemName.toLowerCase());
      if (!unit || !packSize) missingCount++;
      return { sr_no: idx + 1, item_name: itemName, unit, pack_size: packSize, vendor_sku: vendorSku, default_unit_cost: unitCost, brand_name: brandName };
    }).filter(Boolean) as any[];
    setImportPreview(preview);
    setImportSummary({ created: preview.length, duplicates: dupes, missing: missingCount });
    setImportStep("preview");
  };

  const handleImportConfirm = async () => {
    if (!restaurantId || !user) return;
    let targetListId = importTargetList;
    if (importTargetList === "new") {
      const name = importNewListName.trim() || `Import ${new Date().toLocaleDateString()}`;
      const { data, error } = await supabase.from("inventory_lists").insert({
        restaurant_id: restaurantId, name, created_by: user.id,
      }).select().single();
      if (error || !data) { toast.error("Failed to create list"); return; }
      targetListId = data.id;
    }
    let created = 0;
    for (let i = 0; i < importPreview.length; i++) {
      const row = importPreview[i];
      const { error } = await supabase.from("inventory_catalog_items").insert({
        restaurant_id: restaurantId,
        inventory_list_id: targetListId,
        item_name: row.item_name,
        unit: row.unit || null,
        pack_size: row.pack_size || null,
        vendor_sku: row.vendor_sku || null,
        product_number: row.vendor_sku || null,
        brand_name: row.brand_name || null,
        default_unit_cost: row.default_unit_cost,
        sort_order: i,
      });
      if (!error) created++;
    }
    const templateName = `Template ${new Date().toLocaleDateString()}`;
    await supabase.from("import_templates").insert({
      restaurant_id: restaurantId,
      name: templateName,
      mapping_json: importMapping,
      inventory_list_id: targetListId,
      last_used_at: new Date().toISOString(),
    });
    toast.success(`Imported ${created} items`);
    setImportOpen(false);
    resetImport();
    fetchLists();
    if (selectedList?.id === targetListId) openListDetail(selectedList);
  };

  // ─── LIST CATEGORY MANAGEMENT (per-list, per-set) ──────
  const handleAddListCategory = async () => {
    if (!selectedList || !newListCategoryName.trim()) return;
    const currentCats = getCurrentCategories();
    if (currentCats.some(c => c.name === newListCategoryName.trim())) { toast.error("Category already exists"); return; }
    
    const setType = viewMode === "custom-categories" ? "custom_ai" : "user_manual";
    const set = await getOrCreateCategorySet(selectedList.id, setType);
    
    const maxOrder = currentCats.length > 0 ? Math.max(...currentCats.map(c => c.sort_order)) + 1 : 0;
    const { data, error } = await supabase.from("list_categories").insert({
      list_id: selectedList.id, name: newListCategoryName.trim(), sort_order: maxOrder, category_set_id: set.id,
    }).select().single();
    if (error) toast.error(error.message);
    else {
      toast.success(`Category "${newListCategoryName.trim()}" created`);
      setNewListCategoryName("");
      if (data) setListCategories(prev => [...prev, data as ListCategory]);
    }
  };

  const handleRenameCategory = async (oldCat: ListCategory, newName: string) => {
    if (!selectedList) return;
    await supabase.from("list_categories").update({ name: newName }).eq("id", oldCat.id);
    toast.success("Category renamed");
    openListDetail(selectedList);
  };

  const handleDeleteCategory = async (cat: ListCategory) => {
    if (!selectedList) return;
    // Nullify category_id in mappings for this category
    await supabase.from("list_item_category_map").update({ category_id: null }).eq("category_id", cat.id);
    await supabase.from("list_categories").delete().eq("id", cat.id);
    toast.success("Category deleted, items uncategorized");
    openListDetail(selectedList);
  };

  // ─── EXPORT ───────────────────────────────────
  const handleExportList = async (list: any, format: "csv" | "xlsx" | "pdf") => {
    const { data } = await supabase.from("inventory_catalog_items").select("*").eq("inventory_list_id", list.id);
    if (!data?.length) { toast.error("No items to export"); return; }
    const fn = `inventory-${list.name}`;
    const meta = { listName: list.name };
    if (format === "csv") exportToCSV(data, fn, "inventory");
    else if (format === "xlsx") exportToExcel(data, fn, "inventory", meta);
    else exportToPDF(data, fn, "inventory", meta);
  };

  // ─── PURCHASE HISTORY: ADD TO LIST ────────────
  const handleAddFromPurchase = async (itemName: string) => {
    if (!selectedList || !restaurantId) return;
    const exists = catalogItems.some(i => i.item_name.toLowerCase() === itemName.toLowerCase());
    if (exists) { toast.info("Item already in list"); return; }
    const maxOrder = catalogItems.length > 0 ? Math.max(...catalogItems.map(i => i.sort_order || 0)) + 1 : 0;
    const { error } = await supabase.from("inventory_catalog_items").insert({
      restaurant_id: restaurantId, inventory_list_id: selectedList.id,
      item_name: itemName, sort_order: maxOrder,
    });
    if (error) toast.error(error.message);
    else { toast.success(`Added "${itemName}" to list`); openListDetail(selectedList); }
  };

  // ─── FILTERED / GROUPED ITEMS ─────────────────
  const getFilteredItems = useCallback(() => {
    return catalogItems.filter(i => {
      if (detailSearch && !i.item_name.toLowerCase().includes(detailSearch.toLowerCase())) return false;
      return true;
    });
  }, [catalogItems, detailSearch]);

  const filteredItems = getFilteredItems();

  const getGroupedItems = (): Record<string, CatalogItem[]> => {
    const items = filteredItems;

    if (viewMode === "list-order") {
      return { "All Items": items };
    }

    if (viewMode === "custom-categories" || viewMode === "my-categories") {
      const currentCats = getCurrentCategories();
      const currentMaps = getCurrentMappings();
      const result: Record<string, CatalogItem[]> = {};
      
      // Build a map from item id to mapping
      const itemMapLookup = new Map<string, ItemCategoryMap>();
      currentMaps.forEach(m => itemMapLookup.set(m.catalog_item_id, m));

      // Uncategorized first (items with no mapping or null category_id)
      const uncategorized = items.filter(i => {
        const map = itemMapLookup.get(i.id);
        return !map || !map.category_id;
      }).sort((a, b) => {
        const ma = itemMapLookup.get(a.id);
        const mb = itemMapLookup.get(b.id);
        return (ma?.item_sort_order ?? a.sort_order ?? 0) - (mb?.item_sort_order ?? b.sort_order ?? 0);
      });
      result["Uncategorized"] = uncategorized;

      // Then each category in sort_order
      const sortedCats = [...currentCats].sort((a, b) => a.sort_order - b.sort_order);
      for (const cat of sortedCats) {
        const catItems = items.filter(i => {
          const map = itemMapLookup.get(i.id);
          return map && map.category_id === cat.id;
        }).sort((a, b) => {
          const ma = itemMapLookup.get(a.id);
          const mb = itemMapLookup.get(b.id);
          return (ma?.item_sort_order ?? 0) - (mb?.item_sort_order ?? 0);
        });
        result[cat.name] = catItems;
      }

      // Remove empty groups except Uncategorized
      const filtered: Record<string, CatalogItem[]> = {};
      for (const [key, val] of Object.entries(result)) {
        if (val.length > 0 || key === "Uncategorized") filtered[key] = val;
      }
      return Object.keys(filtered).length ? filtered : { "Uncategorized": [] };
    }

    if (viewMode === "recently-purchased") {
      const matched: CatalogItem[] = [];
      const unmatched: CatalogItem[] = [];
      items.forEach(item => {
        const match = recentPurchasedItems.find(rp => {
          if (item.vendor_sku && rp.vendor_sku) {
            return item.vendor_sku.toLowerCase().trim() === (rp.vendor_sku || "").toLowerCase().trim();
          }
          return item.item_name.toLowerCase().trim() === (rp.item_name || "").toLowerCase().trim();
        });
        if (match) matched.push(item);
        else unmatched.push(item);
      });
      const groups: Record<string, CatalogItem[]> = {};
      if (matched.length) groups["Recently Purchased"] = matched;
      if (unmatched.length) groups["Not Recently Purchased"] = unmatched;
      return Object.keys(groups).length ? groups : { "All Items": items };
    }

    return { "All Items": items };
  };

  // ─── SORTED LISTS FOR GRID ────────────────────
  const sortedLists = [...lists]
    .filter(l => !gridSearch || l.name.toLowerCase().includes(gridSearch.toLowerCase()))
    .sort((a, b) => gridSort === "name" ? a.name.localeCompare(b.name) : new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // ─── VIEW MODE LABEL ──────────────────────────
  const viewModeLabel: Record<ViewMode, string> = {
    "list-order": "List Order",
    "custom-categories": "Custom Categories",
    "my-categories": "My Categories",
    "recently-purchased": "Recently Purchased",
  };
  const viewModeIcon: Record<ViewMode, React.ReactNode> = {
    "list-order": <LayoutList className="h-3.5 w-3.5" />,
    "custom-categories": <Sparkles className="h-3.5 w-3.5" />,
    "my-categories": <User className="h-3.5 w-3.5" />,
    "recently-purchased": <Clock className="h-3.5 w-3.5" />,
  };

  // ─── LOADING STATE ────────────────────────────
  if (!currentRestaurant) {
    return (
      <div className="empty-state">
        <Package className="empty-state-icon" />
        <p className="empty-state-title">Select a restaurant to manage lists</p>
      </div>
    );
  }

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

  // ═══════════════════════════════════════════════
  // ─── LIST DETAIL VIEW ─────────────────────────
  // ═══════════════════════════════════════════════
  if (selectedList) {
    const grouped = getGroupedItems();
    const currentCats = getCurrentCategories();

    return (
      <div className="space-y-5 animate-fade-in">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink href="/app/dashboard">Home</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink className="cursor-pointer" onClick={() => setSelectedList(null)}>List Management</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{selectedList.name}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="flex items-center justify-between gap-4 pb-2">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setSelectedList(null)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-amber text-primary-foreground font-bold text-lg">
              {selectedList.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{selectedList.name}</h1>
              <p className="text-sm text-muted-foreground">
                {catalogItems.length} items • Updated {new Date(selectedList.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {saveStatus === "saving" && <span className="text-xs text-muted-foreground animate-pulse">Saving...</span>}
            {saveStatus === "saved" && <span className="text-xs text-success flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span>}

            <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={() => { setImportTargetList(selectedList.id); setImportOpen(true); }}>
              <Upload className="h-3.5 w-3.5" /> Import
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-9"><Download className="h-3.5 w-3.5" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleExportList(selectedList, "csv")}>CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportList(selectedList, "xlsx")}>Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportList(selectedList, "pdf")}>PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Manage List Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-9"><Settings className="h-3.5 w-3.5" /> Manage list</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setRenameListId(selectedList.id); setRenameValue(selectedList.name); setRenameOpen(true); }}>
                  <Pencil className="h-3.5 w-3.5 mr-2" /> Rename list
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDuplicate(selectedList)}>
                  <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate list
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setReorderMode(!reorderMode)}>
                  <GripVertical className="h-3.5 w-3.5 mr-2" /> {reorderMode ? "Exit reorder mode" : "Reorder mode"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCategoryManagerOpen(true)}>
                  <FolderPlus className="h-3.5 w-3.5 mr-2" /> Category manager
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger><Download className="h-3.5 w-3.5 mr-2" /> Export list</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => handleExportList(selectedList, "csv")}>CSV</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExportList(selectedList, "xlsx")}>Excel (.xlsx)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExportList(selectedList, "pdf")}>PDF</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteListId(selectedList.id)}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete list
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Tabs: Items | Issues */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="items" className="gap-1.5">
              <LayoutList className="h-3.5 w-3.5" /> Items
            </TabsTrigger>
            <TabsTrigger value="issues" className="gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Issues
              {issues.length > 0 && <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">{issues.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* ── ITEMS TAB ── */}
          <TabsContent value="items" className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="relative min-w-[240px] max-w-md flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={detailSearch} onChange={e => setDetailSearch(e.target.value)} placeholder="Search items..." className="pl-10 h-10" />
              </div>

              <div className="flex items-center gap-3 ml-auto">
                {/* View Mode Menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2 h-10">
                      <Menu className="h-3.5 w-3.5" />
                      {viewModeLabel[viewMode]}
                      <ChevronDown className="h-3 w-3 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuItem onClick={() => { setViewMode("list-order"); updateActiveCategoryMode("list-order"); setSelectedItems(new Set()); }} className="gap-2">
                      <LayoutList className="h-4 w-4" /> List Order
                      {viewMode === "list-order" && <Check className="h-3.5 w-3.5 ml-auto" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setViewMode("custom-categories"); updateActiveCategoryMode("custom-categories"); setSelectedItems(new Set()); }} className="gap-2">
                      <Sparkles className="h-4 w-4" /> Custom Categories
                      {viewMode === "custom-categories" && <Check className="h-3.5 w-3.5 ml-auto" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setViewMode("my-categories"); updateActiveCategoryMode("my-categories"); setSelectedItems(new Set()); }} className="gap-2">
                      <User className="h-4 w-4" /> My Categories
                      {viewMode === "my-categories" && <Check className="h-3.5 w-3.5 ml-auto" />}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { setViewMode("recently-purchased"); updateActiveCategoryMode("recently-purchased"); setSelectedItems(new Set()); }} className="gap-2">
                      <Clock className="h-4 w-4" /> Recently Purchased
                      {viewMode === "recently-purchased" && <Check className="h-3.5 w-3.5 ml-auto" />}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
                  <DialogTrigger asChild>
                    <Button className="bg-gradient-amber gap-1.5 h-10 px-5"><Plus className="h-4 w-4" /> Add Item</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add Item</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1"><Label className="text-xs">Item Name *</Label><Input value={newItem.item_name} onChange={e => setNewItem({ ...newItem, item_name: e.target.value })} /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Unit *</Label><Input value={newItem.unit} onChange={e => setNewItem({ ...newItem, unit: e.target.value })} placeholder="e.g. lbs, each" /></div>
                        <div className="space-y-1"><Label className="text-xs">Pack Size *</Label><Input value={newItem.pack_size} onChange={e => setNewItem({ ...newItem, pack_size: e.target.value })} placeholder="e.g. 12 oz" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Category</Label>
                          <Select value={newItem.category} onValueChange={v => setNewItem({ ...newItem, category: v })}>
                            <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                            <SelectContent>
                              {currentCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1"><Label className="text-xs">Product Number</Label><Input value={newItem.vendor_sku} onChange={e => setNewItem({ ...newItem, vendor_sku: e.target.value })} placeholder="Vendor item number used for ordering" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Vendor Name</Label><Input value={newItem.vendor_name} onChange={e => setNewItem({ ...newItem, vendor_name: e.target.value })} placeholder="e.g. Sysco, US Foods" /></div>
                        <div className="space-y-1"><Label className="text-xs">Unit Cost</Label><Input type="number" step="0.01" value={newItem.default_unit_cost || ""} onChange={e => setNewItem({ ...newItem, default_unit_cost: parseFloat(e.target.value) || 0 })} /></div>
                      </div>
                      <Button onClick={handleAddItemToList} className="w-full bg-gradient-amber" disabled={!newItem.item_name || !newItem.unit || !newItem.pack_size}>Add Item</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {/* Bulk action bar */}
            {selectedItems.size > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                <Badge variant="secondary" className="text-xs">{selectedItems.size} selected</Badge>
                <Dialog open={bulkMoveOpen} onOpenChange={setBulkMoveOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs">
                      <MoveRight className="h-3.5 w-3.5" /> Move to category
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-sm">
                    <DialogHeader><DialogTitle>Move {selectedItems.size} items</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <Select value={bulkMoveTarget} onValueChange={setBulkMoveTarget}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Select category..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__uncategorized">Uncategorized</SelectItem>
                          {currentCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button onClick={handleBulkMove} className="w-full bg-gradient-amber" disabled={!bulkMoveTarget}>Move Items</Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSelectedItems(new Set())}>
                  <X className="h-3.5 w-3.5 mr-1" /> Clear
                </Button>
              </div>
            )}

            {/* Custom Categories: Auto-create + Save button */}
            {viewMode === "custom-categories" && (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="text-xs text-muted-foreground flex-1">Auto-generated categories based on item names. Click "Save" to persist to this list.</p>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleSaveAICategories}>
                  <Check className="h-3 w-3" /> Save categories to list
                </Button>
              </div>
            )}

            {/* My Categories: Create category input */}
            {viewMode === "my-categories" && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20">
                <FolderPlus className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={newListCategoryName}
                  onChange={e => setNewListCategoryName(e.target.value)}
                  placeholder="+ Create category..."
                  className="h-8 text-sm flex-1 max-w-xs"
                  onKeyDown={e => e.key === "Enter" && handleAddListCategory()}
                />
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={handleAddListCategory} disabled={!newListCategoryName.trim()}>
                  <Plus className="h-3 w-3" /> Create
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleSaveMyCategories} disabled={saveStatus === "saving"}>
                  <Check className="h-3 w-3" /> {saveStatus === "saving" ? "Saving..." : "Save"}
                </Button>
              </div>
            )}

            {/* Items Table with Groups */}
            <DragDropContext onDragEnd={handleDragEnd}>
              {filteredItems.length === 0 ? (
                <div className="border rounded-lg py-16 text-center text-muted-foreground">
                  <FolderOpen className="mx-auto h-12 w-12 mb-4 opacity-20" />
                  <p className="text-sm font-medium">No items found</p>
                  <p className="text-xs mt-1 mb-4">Add items or import from a file to get started.</p>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAddItemOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> Add Item
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                {Object.entries(grouped).map(([catName, catItems]) => (
                  <div key={catName} className="rounded-lg border overflow-hidden">
                    {/* Category header */}
                    {Object.keys(grouped).length > 1 && (
                      <button
                        type="button"
                        className="flex items-center justify-between w-full px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors"
                        onClick={() => toggleCategoryCollapse(catName)}
                      >
                        <div className="flex items-center gap-2.5">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">{catName}</h3>
                          <Badge variant="secondary" className="text-[10px] font-mono">{catItems.length}</Badge>
                        </div>
                        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${collapsedCategories.has(catName) ? "-rotate-90" : ""}`} />
                      </button>
                    )}

                    {/* Category content */}
                    {!collapsedCategories.has(catName) && (
                      catItems.length === 0 ? (
                        <div className="py-10 text-center text-muted-foreground">
                          <p className="text-sm">No items in this category</p>
                          <Button variant="ghost" size="sm" className="mt-2 gap-1 text-xs" onClick={() => setAddItemOpen(true)}>
                            <Plus className="h-3 w-3" /> Add Item
                          </Button>
                        </div>
                      ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/20 border-b border-border/40">
                            {(viewMode === "my-categories" || viewMode === "custom-categories") && (
                              <TableHead className="w-10">
                                <Checkbox
                                  checked={catItems.length > 0 && catItems.every(i => selectedItems.has(i.id))}
                                  onCheckedChange={() => {
                                    const allSelected = catItems.every(i => selectedItems.has(i.id));
                                    setSelectedItems(prev => {
                                      const next = new Set(prev);
                                      catItems.forEach(i => allSelected ? next.delete(i.id) : next.add(i.id));
                                      return next;
                                    });
                                  }}
                                />
                              </TableHead>
                            )}
                            <TableHead className="w-8"></TableHead>
                            <TableHead className="text-xs font-semibold">Item Name</TableHead>
                            <TableHead className="text-xs font-semibold">Unit</TableHead>
                            <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                            <TableHead className="text-xs font-semibold">Product #</TableHead>
                            <TableHead className="text-xs font-semibold">Last Ordered</TableHead>
                            <TableHead className="text-xs font-semibold text-right">Unit Cost</TableHead>
                            <TableHead className="text-xs font-semibold w-24">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <Droppable droppableId={catName}>
                          {(provided) => (
                            <TableBody ref={provided.innerRef} {...provided.droppableProps}>
                              {catItems.map((item, idx) => (
                                <Draggable key={item.id} draggableId={item.id} index={idx} isDragDisabled={!reorderMode && viewMode !== "my-categories" && viewMode !== "custom-categories"}>
                                  {(dragProvided, snapshot) => (
                                    <TableRow
                                      ref={dragProvided.innerRef}
                                      {...dragProvided.draggableProps}
                                      className={`group/row border-b border-border/40 transition-colors ${snapshot.isDragging ? "bg-accent shadow-md" : "hover:bg-muted/30"} ${selectedItems.has(item.id) ? "bg-primary/5" : ""}`}
                                    >
                                      {editingItem === item.id ? (
                                        <>
                                          {(viewMode === "my-categories" || viewMode === "custom-categories") && <TableCell />}
                                          <TableCell><div {...dragProvided.dragHandleProps}><GripVertical className="h-4 w-4 text-muted-foreground/30" /></div></TableCell>
                                          <TableCell><Input className="h-8 text-sm" value={editValues.item_name} onChange={e => setEditValues({ ...editValues, item_name: e.target.value })} /></TableCell>
                                          <TableCell><Input className="h-8 text-sm" value={editValues.unit || ""} onChange={e => setEditValues({ ...editValues, unit: e.target.value })} /></TableCell>
                                          <TableCell><Input className="h-8 text-sm" value={editValues.pack_size || ""} onChange={e => setEditValues({ ...editValues, pack_size: e.target.value })} /></TableCell>
                                          <TableCell><Input className="h-8 text-sm" value={editValues.vendor_sku || ""} onChange={e => setEditValues({ ...editValues, vendor_sku: e.target.value })} /></TableCell>
                                          <TableCell><Input className="h-8 text-sm w-20" type="number" value={editValues.default_unit_cost || 0} onChange={e => setEditValues({ ...editValues, default_unit_cost: +e.target.value })} /></TableCell>
                                          <TableCell>
                                            <div className="flex gap-1">
                                              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => handleSaveEdit(item.id)}>Save</Button>
                                              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setEditingItem(null)}><X className="h-3 w-3" /></Button>
                                            </div>
                                          </TableCell>
                                        </>
                                      ) : (
                                        <>
                                          {(viewMode === "my-categories" || viewMode === "custom-categories") && (
                                            <TableCell>
                                              <Checkbox
                                                checked={selectedItems.has(item.id)}
                                                onCheckedChange={() => toggleSelectItem(item.id)}
                                              />
                                            </TableCell>
                                          )}
                                          <TableCell className="w-8">
                                            <div {...dragProvided.dragHandleProps} className="cursor-grab active:cursor-grabbing">
                                              <GripVertical className="h-4 w-4 text-muted-foreground/20 group-hover/row:text-muted-foreground/60 transition-colors" />
                                            </div>
                                          </TableCell>
                                          <TableCell className="text-sm font-medium text-foreground">
                                            <div>
                                              <span>{item.item_name}</span>
                                              <ItemIdentityBlock
                                                brandName={item.brand_name}
                                                className="block mt-0.5"
                                              />
                                            </div>
                                          </TableCell>
                                          <TableCell className="text-xs text-muted-foreground">{item.unit || <span className="text-destructive/60">—</span>}</TableCell>
                                          <TableCell className="text-xs text-muted-foreground">{item.pack_size || <span className="text-destructive/60">—</span>}</TableCell>
                                          <TableCell className="text-xs font-mono text-muted-foreground/60">{item.vendor_sku || "—"}</TableCell>
                                          <TableCell className="text-xs text-muted-foreground">
                                            {lastOrderDates[item.id]
                                              ? new Date(lastOrderDates[item.id]).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })
                                              : "—"}
                                          </TableCell>
                                          <TableCell className="text-sm font-mono tabular-nums text-right">{item.default_unit_cost != null ? `$${Number(item.default_unit_cost).toFixed(2)}` : "—"}</TableCell>
                                          <TableCell>
                                            <div className="flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingItem(item.id); setEditValues({ item_name: item.item_name, category: item.category, unit: item.unit, pack_size: item.pack_size, vendor_sku: item.vendor_sku, default_unit_cost: item.default_unit_cost }); }}>
                                                <Pencil className="h-3.5 w-3.5" />
                                              </Button>
                                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDuplicateItem(item)}>
                                                <Copy className="h-3.5 w-3.5" />
                                              </Button>
                                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteItem(item.id)}>
                                                <Trash2 className="h-3.5 w-3.5" />
                                              </Button>
                                            </div>
                                          </TableCell>
                                        </>
                                      )}
                                    </TableRow>
                                  )}
                                </Draggable>
                              ))}
                              {provided.placeholder}
                            </TableBody>
                          )}
                        </Droppable>
                      </Table>
                      )
                    )}
                  </div>
                ))}
                </div>
              )}
            </DragDropContext>
          </TabsContent>

          {/* ── ISSUES TAB ── */}
          <TabsContent value="issues" className="space-y-4">
            {issues.length === 0 ? (
              <div className="border rounded-lg py-16 text-center text-muted-foreground">
                <Check className="mx-auto h-12 w-12 mb-4 text-success opacity-40" />
                <p className="text-sm font-medium">No issues found</p>
                <p className="text-xs text-muted-foreground mt-1">All items have the required fields filled in.</p>
              </div>
            ) : (
              <div className="overflow-hidden border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-xs font-semibold">Item Name</TableHead>
                      <TableHead className="text-xs font-semibold">Issues</TableHead>
                      <TableHead className="text-xs font-semibold">Product #</TableHead>
                      <TableHead className="text-xs font-semibold">Vendor</TableHead>
                      <TableHead className="text-xs font-semibold">Unit</TableHead>
                      <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                      <TableHead className="text-xs font-semibold w-20">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {issues.map(item => (
                      <IssueRow key={item.id} item={item} onFix={(item) => {
                        setEditingItem(item.id);
                        setEditValues({ item_name: item.item_name, category: item.category, unit: item.unit, pack_size: item.pack_size, vendor_sku: item.vendor_sku, vendor_name: item.vendor_name, default_unit_cost: item.default_unit_cost });
                        setActiveTab("items");
                      }} onQuickSave={async (id, updates) => {
                        const { error } = await supabase.from("inventory_catalog_items").update(updates).eq("id", id);
                        if (error) toast.error(error.message);
                        else { toast.success("Updated"); openListDetail(selectedList); }
                      }} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

        </Tabs>

        {/* Category Manager Dialog */}
        <Dialog open={categoryManagerOpen} onOpenChange={setCategoryManagerOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Category Manager — {selectedList.name}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input value={newListCategoryName} onChange={e => setNewListCategoryName(e.target.value)} placeholder="New category name..." className="h-9" onKeyDown={e => e.key === "Enter" && handleAddListCategory()} />
                <Button size="sm" onClick={handleAddListCategory} disabled={!newListCategoryName.trim()} className="bg-gradient-amber gap-1"><Plus className="h-3.5 w-3.5" /> Add</Button>
              </div>
              {currentCats.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No categories for this mode. Add one above.</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-auto">
                  {currentCats.map(cat => {
                    const currentMaps = getCurrentMappings();
                    const count = currentMaps.filter(m => m.category_id === cat.id).length;
                    return (
                      <div key={cat.id} className="flex items-center justify-between p-2 rounded-md border bg-muted/20">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{cat.name}</span>
                          <Badge variant="secondary" className="text-[10px]">{count} items</Badge>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                            const newName = prompt("Rename category:", cat.name);
                            if (newName && newName !== cat.name) handleRenameCategory(cat, newName);
                          }}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteCategory(cat)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Rename Dialog */}
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Rename List</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>New Name</Label><Input value={renameValue} onChange={e => setRenameValue(e.target.value)} /></div>
              <Button onClick={handleRename} className="w-full bg-gradient-amber">Rename</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteListId} onOpenChange={(o) => !o && setDeleteListId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete list?</AlertDialogTitle>
              <AlertDialogDescription>This will permanently delete the list and all related data. This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Import Dialog (shared) */}
        {renderImportDialog()}
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  // ─── IMPORT DIALOG RENDERER ───────────────────
  // ═══════════════════════════════════════════════
  function renderImportDialog() {
    return (
      <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) resetImport(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Import Items</DialogTitle></DialogHeader>

          {importStep === "upload" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Upload a CSV or Excel file with your inventory items.</p>
              <div className="space-y-2">
                <Label className="text-xs">Import into</Label>
                <Select value={importTargetList} onValueChange={setImportTargetList}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Create new list</SelectItem>
                    {lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {importTargetList === "new" && (
                <div className="space-y-2">
                  <Label className="text-xs">New List Name</Label>
                  <Input value={importNewListName} onChange={e => setImportNewListName(e.target.value)} placeholder="e.g. Main Kitchen" className="h-9" />
                </div>
              )}
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="block w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:bg-primary file:text-primary-foreground hover:file:bg-primary/90" />
            </div>
          )}

          {importStep === "map" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Map your file columns to the required fields.</p>
              {[...requiredMapFields, ...optionalMapFields].map(field => {
                const displayLabel = field === "vendor_sku" ? "Product Number" : field === "default_unit_cost" ? "Unit Cost" : field === "brand_name" ? "Brand" : field.replace(/_/g, " ");
                return (
                <div key={field} className="flex items-center gap-3">
                  <Label className="w-28 text-xs capitalize">{displayLabel}{requiredMapFields.includes(field) && " *"}</Label>
                  <Select value={importMapping[field] || ""} onValueChange={v => setImportMapping(prev => ({ ...prev, [field]: v }))}>
                    <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Select column" /></SelectTrigger>
                    <SelectContent>
                      {importHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {importMapping[field] && <Check className="h-4 w-4 text-success shrink-0" />}
                </div>
                );
              })}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setImportStep("upload"); }} className="flex-1">Back</Button>
                <Button onClick={handleImportPreview} className="flex-1 bg-gradient-amber">Preview</Button>
              </div>
            </div>
          )}

          {importStep === "preview" && (
            <div className="space-y-4">
              {importSummary && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-lg font-bold text-primary">{importSummary.created}</p>
                    <p className="text-[10px] text-muted-foreground">Items to import</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-lg font-bold text-warning">{importSummary.duplicates}</p>
                    <p className="text-[10px] text-muted-foreground">Duplicates</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-lg font-bold text-destructive">{importSummary.missing}</p>
                    <p className="text-[10px] text-muted-foreground">Missing fields</p>
                  </div>
                </div>
              )}
              <div className="max-h-60 overflow-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Sr#</TableHead>
                      <TableHead className="text-xs">Item Name</TableHead>
                      <TableHead className="text-xs">Unit</TableHead>
                      <TableHead className="text-xs">Pack Size</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.slice(0, 20).map((row: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-mono">{row.sr_no}</TableCell>
                        <TableCell className="text-xs">{row.item_name}</TableCell>
                        <TableCell className="text-xs">{row.unit || <span className="text-destructive">—</span>}</TableCell>
                        <TableCell className="text-xs">{row.pack_size || <span className="text-destructive">—</span>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {importPreview.length > 20 && <p className="text-xs text-muted-foreground">...and {importPreview.length - 20} more</p>}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setImportStep("map")} className="flex-1">Back</Button>
                <Button onClick={handleImportConfirm} className="flex-1 bg-gradient-amber">Confirm Import</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  // ═══════════════════════════════════════════════
  // ─── MY LISTS GRID VIEW ───────────────────────
  // ═══════════════════════════════════════════════
  return (
    <div className="space-y-8 animate-fade-in">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/app/dashboard">Home</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>List Management</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">List Management</h1>
          <p className="text-sm text-muted-foreground">View, create, and manage your inventory lists.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setImportTargetList("new"); setImportOpen(true); }}>
            <Upload className="h-4 w-4" /> Import
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-amber gap-2 shadow-amber" size="sm"><Plus className="h-4 w-4" /> Create List</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Inventory List</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>List Name</Label>
                  <Input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="e.g. Main Kitchen" className="h-10" />
                </div>
                <Button onClick={handleCreateList} className="w-full bg-gradient-amber" disabled={!newListName.trim()}>Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Search & Sort */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={gridSearch} onChange={e => setGridSearch(e.target.value)} placeholder="Search lists..." className="pl-9 h-10" />
        </div>
        <Select value={gridSort} onValueChange={(v: "date" | "name") => setGridSort(v)}>
          <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="date">Sort by Date</SelectItem>
            <SelectItem value="name">Sort by Name</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lists Grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {/* Create card */}
        <Card className="border-dashed border-2 rounded-xl hover:border-primary/30 hover:bg-muted/30 transition-all cursor-pointer" onClick={() => setCreateOpen(true)}>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 mb-3">
              <Plus className="h-5 w-5 opacity-40" />
            </div>
            <span className="text-sm font-medium">Create new list</span>
          </CardContent>
        </Card>

        {/* Purchase History card */}
        <Card className="rounded-xl hover:shadow-md transition-all cursor-pointer border shadow-sm group" onClick={() => navigate("/app/purchase-history")}>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <ShoppingCart className="h-4 w-4 text-primary" />
              </div>
              <h3 className="font-semibold text-sm">Purchase History</h3>
            </div>
            <p className="text-xs text-muted-foreground">View all saved orders and procurement costs</p>
            <Button variant="outline" size="sm" className="w-full gap-1 text-xs">
              Open <ChevronRight className="h-3 w-3" />
            </Button>
          </CardContent>
        </Card>

        {sortedLists.map(list => (
          <Card key={list.id} className="rounded-xl hover:shadow-md transition-all cursor-pointer border shadow-sm group" onClick={() => openListDetail(list)}>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-amber text-primary-foreground font-bold text-sm">
                    {list.name.charAt(0).toUpperCase()}
                  </div>
                  <h3 className="font-semibold text-sm">{list.name}</h3>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onClick={() => openListDetail(list)}>
                      <FolderOpen className="h-3.5 w-3.5 mr-2" /> Open
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setRenameListId(list.id); setRenameValue(list.name); setRenameOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDuplicate(list)}>
                      <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger><Download className="h-3.5 w-3.5 mr-2" /> Export</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => handleExportList(list, "csv")}>CSV</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportList(list, "xlsx")}>Excel (.xlsx)</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportList(list, "pdf")}>PDF</DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteListId(list.id)}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] font-mono">{itemCounts[list.id] || 0} items</Badge>
                <span className="text-[11px] text-muted-foreground">{new Date(list.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              </div>
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={(e) => { e.stopPropagation(); openListDetail(list); }}>
                Open
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {sortedLists.length === 0 && !gridSearch && (
        <div className="border rounded-lg py-16 text-center text-muted-foreground">
          <ClipboardList className="mx-auto h-12 w-12 mb-4 opacity-20" />
          <p className="text-sm font-medium">No lists yet</p>
          <p className="text-xs mt-1 mb-4">Create your first inventory list or import from a file.</p>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Create List
          </Button>
        </div>
      )}

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename List</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>New Name</Label><Input value={renameValue} onChange={e => setRenameValue(e.target.value)} /></div>
            <Button onClick={handleRename} className="w-full bg-gradient-amber">Rename</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteListId} onOpenChange={(o) => !o && setDeleteListId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete list?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the list and all related data. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Dialog */}
      {renderImportDialog()}
    </div>
  );
}
