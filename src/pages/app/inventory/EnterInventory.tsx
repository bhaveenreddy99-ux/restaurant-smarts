import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { toast } from "sonner";
import {
  Plus, Send, Package, BookOpen, Play, ArrowLeft, Eye, CheckCircle,
  XCircle, ShoppingCart, Copy, Clock, ClipboardCheck, Trash2, ChevronRight, Eraser,
  Search, SkipForward, EyeOff, Check, ListOrdered, AlertTriangle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useIsCompact, useIsMobile } from "@/hooks/use-mobile";
import { useCategoryMapping } from "@/hooks/useCategoryMapping";

const defaultCategories = ["Frozen", "Cooler", "Dry"];

// Risk classification helper
function getRisk(currentStock: number, parLevel: number | null | undefined): { label: string; color: string; bgClass: string; textClass: string } {
  if (parLevel === null || parLevel === undefined || parLevel <= 0) {
    return { label: "No PAR", color: "gray", bgClass: "bg-muted/60", textClass: "text-muted-foreground" };
  }
  const ratio = currentStock / parLevel;
  if (ratio >= 1.0) return { label: "Low", color: "green", bgClass: "bg-success/10", textClass: "text-success" };
  if (ratio > 0.5) return { label: "Medium", color: "yellow", bgClass: "bg-warning/10", textClass: "text-warning" };
  return { label: "High", color: "red", bgClass: "bg-destructive/10", textClass: "text-destructive" };
}

export default function EnterInventoryPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isCompact = useIsCompact();
  const isMobile = useIsMobile();

  const [lists, setLists] = useState<any[]>([]);
  const [selectedList, setSelectedList] = useState("");
  const [loading, setLoading] = useState(true);

  const [inProgressSessions, setInProgressSessions] = useState<any[]>([]);
  const [reviewSessions, setReviewSessions] = useState<any[]>([]);
  const [approvedSessions, setApprovedSessions] = useState<any[]>([]);
  const [sessionStats, setSessionStats] = useState<Record<string, { qty: number; totalValue: number }>>({});
  const [approvedFilter, setApprovedFilter] = useState("30");

  const [activeSession, setActiveSession] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [newItem, setNewItem] = useState({ item_name: "", category: "Cooler", unit: "", current_stock: 0, par_level: 0, unit_cost: 0 });
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const [startOpen, setStartOpen] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [selectedPar, setSelectedPar] = useState("");
  const [parGuides, setParGuides] = useState<any[]>([]);
  const [parItems, setParItems] = useState<any[]>([]);

  const [viewItems, setViewItems] = useState<any[] | null>(null);
  const [viewSession, setViewSession] = useState<any>(null);

  const [clearEntriesSessionId, setClearEntriesSessionId] = useState<string | null>(null);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);

  const [smartOrderSession, setSmartOrderSession] = useState<any>(null);
  const [smartOrderParGuides, setSmartOrderParGuides] = useState<any[]>([]);
  const [smartOrderSelectedPar, setSmartOrderSelectedPar] = useState("");
  const [smartOrderCreating, setSmartOrderCreating] = useState(false);

  // Counting mode state
  const [showOnlyEmpty, setShowOnlyEmpty] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [categoryMode, setCategoryMode] = useState<string>("list_order");
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Approved PAR data for read-only display during count entry
  const [approvedParMap, setApprovedParMap] = useState<Record<string, number>>({});

  // Load approved PAR values when session opens
  useEffect(() => {
    if (!activeSession || !currentRestaurant) { setApprovedParMap({}); return; }
    const loadApprovedPar = async () => {
      // Find approved sessions for this list to get latest PAR values
      // Also load from par_guide_items for the list's par guides
      const { data: guides } = await supabase
        .from("par_guides")
        .select("id")
        .eq("restaurant_id", currentRestaurant.id)
        .eq("inventory_list_id", activeSession.inventory_list_id);

      if (!guides || guides.length === 0) { setApprovedParMap({}); return; }

      // Get all par guide items from all guides for this list
      const guideIds = guides.map(g => g.id);
      const { data: allParItems } = await supabase
        .from("par_guide_items")
        .select("item_name, par_level, par_guide_id")
        .in("par_guide_id", guideIds);

      if (!allParItems || allParItems.length === 0) { setApprovedParMap({}); return; }

      // Use the latest par guide's values (last guide as most recent)
      const map: Record<string, number> = {};
      allParItems.forEach(p => { map[p.item_name] = Number(p.par_level); });
      setApprovedParMap(map);
    };
    loadApprovedPar();
  }, [activeSession, currentRestaurant]);

  useEffect(() => {
    if (!currentRestaurant) return;
    supabase.from("inventory_lists").select("*").eq("restaurant_id", currentRestaurant.id)
      .then(({ data }) => {
        if (data) {
          setLists(data);
          if (data.length > 0 && !selectedList) setSelectedList(data[0].id);
        }
      });
  }, [currentRestaurant]);

  useEffect(() => {
    if (!currentRestaurant) return;
    fetchSessions();
  }, [currentRestaurant, selectedList, approvedFilter]);

  const fetchSessions = async () => {
    if (!currentRestaurant) return;
    setLoading(true);

    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(approvedFilter));

    const [{ data: ip }, { data: rv }, { data: ap }] = await Promise.all([
      supabase.from("inventory_sessions").select("*, inventory_lists(name)").eq("restaurant_id", currentRestaurant.id).eq("status", "IN_PROGRESS").order("updated_at", { ascending: false }),
      supabase.from("inventory_sessions").select("*, inventory_lists(name)").eq("restaurant_id", currentRestaurant.id).eq("status", "IN_REVIEW").order("updated_at", { ascending: false }),
      supabase.from("inventory_sessions").select("*, inventory_lists(name)").eq("restaurant_id", currentRestaurant.id).eq("status", "APPROVED").gte("approved_at", daysAgo.toISOString()).order("approved_at", { ascending: false }),
    ]);

    const filteredIp = (ip || []).filter((s) => !selectedList || s.inventory_list_id === selectedList);
    const filteredRv = (rv || []).filter((s) => !selectedList || s.inventory_list_id === selectedList);
    const filteredAp = (ap || []).filter((s) => !selectedList || s.inventory_list_id === selectedList);

    setInProgressSessions(filteredIp);
    setReviewSessions(filteredRv);
    setApprovedSessions(filteredAp);

    // Fetch item counts + total values for all sessions
    const allSessions = [...filteredIp, ...filteredRv, ...filteredAp];
    if (allSessions.length > 0) {
      const sessionIds = allSessions.map((s) => s.id);
      const { data: statsRaw } = await supabase
        .from("inventory_session_items")
        .select("session_id, current_stock, unit_cost")
        .in("session_id", sessionIds);

      const statsMap: Record<string, { qty: number; totalValue: number }> = {};
      (statsRaw || []).forEach((row) => {
        if (!statsMap[row.session_id]) statsMap[row.session_id] = { qty: 0, totalValue: 0 };
        statsMap[row.session_id].qty += Number(row.current_stock ?? 0);
        if (row.current_stock != null && row.unit_cost != null) {
          statsMap[row.session_id].totalValue += Number(row.current_stock) * Number(row.unit_cost);
        }
      });
      setSessionStats(statsMap);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (!currentRestaurant || !selectedList) { setParGuides([]); return; }
    supabase.from("par_guides").select("*").eq("restaurant_id", currentRestaurant.id).eq("inventory_list_id", selectedList)
      .then(({ data }) => { if (data) setParGuides(data); });
  }, [currentRestaurant, selectedList]);

  useEffect(() => {
    if (!selectedPar) { setParItems([]); return; }
    supabase.from("par_guide_items").select("*").eq("par_guide_id", selectedPar).then(({ data }) => { if (data) setParItems(data); });
  }, [selectedPar]);

  const handleCreateSession = async () => {
    if (!currentRestaurant || !user || !selectedList || !sessionName) return;
    const { data, error } = await supabase.from("inventory_sessions").insert({
      restaurant_id: currentRestaurant.id,
      inventory_list_id: selectedList,
      name: sessionName,
      created_by: user.id
    }).select().single();
    if (error) { toast.error(error.message); return; }

    const { data: catItems } = await supabase.from("inventory_catalog_items").select("*")
      .eq("restaurant_id", currentRestaurant.id).eq("inventory_list_id", selectedList);

    // Auto-detect latest PAR guide if none explicitly selected
    let resolvedParItems = parItems;
    if (resolvedParItems.length === 0 && selectedList) {
      const { data: latestGuide } = await supabase
        .from("par_guides")
        .select("id")
        .eq("restaurant_id", currentRestaurant.id)
        .eq("inventory_list_id", selectedList)
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();
      if (latestGuide) {
        const { data: latestItems } = await supabase.from("par_guide_items").select("*").eq("par_guide_id", latestGuide.id);
        if (latestItems) resolvedParItems = latestItems;
      }
    }

    const parMap: Record<string, number> = {};
    resolvedParItems.forEach((p) => { parMap[p.item_name] = Number(p.par_level); });

    if (catItems && catItems.length > 0) {
      const preItems = catItems.map((ci) => ({
        session_id: data.id,
        item_name: ci.item_name,
        category: ci.category || "Dry",
        unit: ci.unit || "",
        current_stock: 0,
        par_level: parMap[ci.item_name] ?? ci.default_par_level ?? 0,
        unit_cost: ci.default_unit_cost || null,
        vendor_sku: ci.vendor_sku || null,
        pack_size: ci.pack_size || null,
        vendor_name: ci.vendor_name || null
      }));
      await supabase.from("inventory_session_items").insert(preItems);
    } else if (resolvedParItems.length > 0) {
      const preItems = resolvedParItems.map((p) => ({
        session_id: data.id,
        item_name: p.item_name,
        category: p.category || "Dry",
        unit: p.unit || "",
        current_stock: 0,
        par_level: p.par_level
      }));
      await supabase.from("inventory_session_items").insert(preItems);
    }

    toast.success("Session created — start entering counts");
    setSessionName("");
    setStartOpen(false);
    setSelectedPar("");
    openEditor(data);
  };

  const openEditor = async (session: any) => {
    setActiveSession(session);
    const [{ data }, listResult, catalogResult] = await Promise.all([
      supabase.from("inventory_session_items").select("*").eq("session_id", session.id),
      supabase.from("inventory_lists").select("active_category_mode").eq("id", session.inventory_list_id).single(),
      currentRestaurant
        ? supabase.from("inventory_catalog_items").select("*").eq("restaurant_id", currentRestaurant.id).eq("inventory_list_id", session.inventory_list_id)
        : Promise.resolve({ data: null }),
    ]);
    if (data) setItems(data);
    if (catalogResult.data) setCatalogItems(catalogResult.data);
    // Sync category mode from the list's active_category_mode
    if (listResult.data?.active_category_mode) {
      const dbMode = listResult.data.active_category_mode;
      if (dbMode === "ai" || dbMode === "custom-categories") setCategoryMode("custom-categories");
      else if (dbMode === "user" || dbMode === "my-categories") setCategoryMode("my-categories");
      else setCategoryMode("list_order");
    }
  };

  const handleAddItem = async () => {
    if (!activeSession) return;
    const payload = { session_id: activeSession.id, ...newItem };
    const { data, error } = await supabase.from("inventory_session_items").insert(payload).select().single();
    if (error) { toast.error(error.message); return; }
    setItems([...items, data]);
    setNewItem({ item_name: "", category: "Cooler", unit: "", current_stock: 0, par_level: 0, unit_cost: 0 });
    setCreateOpen(false);
  };

  const handleAddFromCatalog = async (catalogItem: any) => {
    if (!activeSession) return;
    const payload = {
      session_id: activeSession.id,
      item_name: catalogItem.item_name,
      category: catalogItem.category || "Dry",
      unit: catalogItem.unit || "",
      current_stock: 0,
      par_level: catalogItem.default_par_level || 0,
      unit_cost: catalogItem.default_unit_cost || 0,
      vendor_sku: catalogItem.vendor_sku || null,
      pack_size: catalogItem.pack_size || null,
      vendor_name: catalogItem.vendor_name || null
    };
    const { data, error } = await supabase.from("inventory_session_items").insert(payload).select().single();
    if (error) { toast.error(error.message); return; }
    setItems([...items, data]);
    toast.success(`Added ${catalogItem.item_name}`);
  };

  const handleUpdateStock = async (id: string, stock: number) => {
    const clamped = Math.min(100, Math.max(0, stock));
    setItems(items.map((i) => i.id === id ? { ...i, current_stock: clamped } : i));
  };

  const handleUpdatePar = async (id: string, par: number) => {
    const clamped = Math.min(100, Math.max(0, par));
    setItems(items.map((i) => i.id === id ? { ...i, par_level: clamped } : i));
  };

  const handleSavePar = useCallback(async (id: string, par: number) => {
    setSavingId(id);
    const { error } = await supabase.from("inventory_session_items").update({ par_level: par }).eq("id", id);
    setSavingId(null);
    if (error) toast.error("Could not save PAR");
    else {
      setSavedId(id);
      setTimeout(() => setSavedId(prev => prev === id ? null : prev), 1500);
    }
  }, []);

  const handleSaveStock = useCallback(async (id: string, stock: number) => {
    setSavingId(id);
    const { error } = await supabase.from("inventory_session_items").update({ current_stock: stock }).eq("id", id);
    setSavingId(null);
    if (error) {
      toast.error("Could not save — tap to retry");
    } else {
      setSavedId(id);
      setTimeout(() => setSavedId(prev => prev === id ? null : prev), 1500);
    }
  }, []);

  const handleSubmitForReview = async () => {
    if (!activeSession) return;
    const { error } = await supabase.from("inventory_sessions").update({ status: "IN_REVIEW", updated_at: new Date().toISOString() }).eq("id", activeSession.id);
    if (error) toast.error(error.message);
    else { toast.success("Submitted for review!"); setActiveSession(null); setItems([]); fetchSessions(); }
  };

  const handleDeleteSession = async () => {
    if (!deleteSessionId) return;
    await supabase.from("inventory_session_items").delete().eq("session_id", deleteSessionId);
    const { error } = await supabase.from("inventory_sessions").delete().eq("id", deleteSessionId);
    if (error) toast.error(error.message);
    else { toast.success("Session deleted"); setDeleteSessionId(null); fetchSessions(); }
  };

  const handleClearEntries = async () => {
    if (!clearEntriesSessionId) return;
    const { error } = await supabase.from("inventory_session_items")
      .update({ current_stock: null } as any)
      .eq("session_id", clearEntriesSessionId);
    if (error) toast.error(error.message);
    else {
      toast.success("Entries cleared — ready for recount");
      setClearEntriesSessionId(null);
      if (activeSession?.id === clearEntriesSessionId) {
        setItems(items.map(i => ({ ...i, current_stock: null })));
      }
    }
  };

  // Helper: auto-create smart order run + items + notifications on approval
  const autoCreateSmartOrder = async (sessionId: string) => {
    if (!currentRestaurant || !user) return;
    try {
      // 1. Fetch session to get inventory_list_id
      const { data: session } = await supabase.from("inventory_sessions").select("*").eq("id", sessionId).single();
      if (!session) return;

      // 2. Fetch session items
      const { data: sessionItems } = await supabase.from("inventory_session_items").select("*").eq("session_id", sessionId);
      if (!sessionItems || sessionItems.length === 0) return;

      // 3. Fetch latest par_guide for the list
      const { data: latestGuide } = await supabase.from("par_guides").select("id")
        .eq("restaurant_id", currentRestaurant.id)
        .eq("inventory_list_id", session.inventory_list_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      const parMap: Record<string, number> = {};
      if (latestGuide) {
        const { data: guideItems } = await supabase.from("par_guide_items").select("item_name, par_level").eq("par_guide_id", latestGuide.id);
        (guideItems || []).forEach(p => { parMap[p.item_name] = Number(p.par_level); });
      }

      // 4. Compute risk + suggested order per item
      const computed = sessionItems.map(i => {
        const parLevel = parMap[i.item_name] ?? Number(i.par_level);
        const currentStock = Number(i.current_stock ?? 0);
        const ratio = parLevel > 0 ? currentStock / parLevel : null;
        const risk = ratio === null ? "GREEN" : ratio < 0.5 ? "RED" : ratio < 1.0 ? "YELLOW" : "GREEN";
        const suggestedOrder = parLevel > 0 ? Math.max(0, parLevel - currentStock) : 0;
        return { ...i, parLevel, currentStock, risk, suggestedOrder };
      });

      const redCount = computed.filter(i => i.risk === "RED").length;
      const yellowCount = computed.filter(i => i.risk === "YELLOW").length;

      // 5. Insert smart_order_runs
      const { data: run, error: runError } = await supabase.from("smart_order_runs").insert({
        restaurant_id: currentRestaurant.id,
        session_id: sessionId,
        inventory_list_id: session.inventory_list_id,
        par_guide_id: latestGuide?.id || null,
        created_by: user.id,
      }).select().single();
      if (runError || !run) return;

      // 6. Insert smart_order_run_items
      const runItems = computed.map(i => ({
        run_id: run.id,
        item_name: i.item_name,
        suggested_order: i.suggestedOrder,
        risk: i.risk,
        current_stock: i.currentStock,
        par_level: i.parLevel,
        unit_cost: i.unit_cost || null,
        pack_size: i.pack_size || null,
      }));
      await supabase.from("smart_order_run_items").insert(runItems);

      // 7. Fire notifications if RED items exist
      if (redCount > 0 || yellowCount > 0) {
        const { data: prefs } = await supabase.from("notification_preferences")
          .select("*, alert_recipients(user_id)")
          .eq("restaurant_id", currentRestaurant.id)
          .eq("channel_in_app", true)
          .limit(1)
          .single();

        if (prefs) {
          const { data: members } = await supabase.from("restaurant_members")
            .select("user_id, role")
            .eq("restaurant_id", currentRestaurant.id);

          let targetUserIds: string[] = [];
          if (prefs.recipients_mode === "OWNERS_MANAGERS") {
            targetUserIds = (members || []).filter(m => m.role === "OWNER" || m.role === "MANAGER").map(m => m.user_id);
          } else if (prefs.recipients_mode === "ALL") {
            targetUserIds = (members || []).map(m => m.user_id);
          } else if (prefs.recipients_mode === "CUSTOM") {
            targetUserIds = (prefs.alert_recipients || []).map((r: any) => r.user_id);
          }

          if (targetUserIds.length > 0) {
            const notifications = targetUserIds.map(uid => ({
              restaurant_id: currentRestaurant.id,
              user_id: uid,
              type: "LOW_STOCK",
              severity: redCount > 0 ? "CRITICAL" : "WARNING" as "CRITICAL" | "WARNING",
              title: `Inventory Approved — ${redCount + yellowCount} item${redCount + yellowCount > 1 ? "s" : ""} need attention`,
              message: `${redCount} high risk, ${yellowCount} medium risk items detected`,
              data: { session_id: sessionId, run_id: run.id, red: redCount, yellow: yellowCount } as any,
            }));
            await supabase.from("notifications").insert(notifications);
          }
        }
      }
    } catch (err) {
      console.error("Auto smart order error:", err);
    }
  };

  const handleApprove = async (sessionId: string) => {
    if (!currentRestaurant || !user) return;
    const { error } = await supabase.from("inventory_sessions").update({
      status: "APPROVED", approved_at: new Date().toISOString(), approved_by: user.id, updated_at: new Date().toISOString()
    }).eq("id", sessionId);
    if (error) { toast.error(error.message); return; }

    // Auto-create smart order run + notifications
    await autoCreateSmartOrder(sessionId);

    toast.success("Session approved!");
    fetchSessions();
  };

  const handleReject = async (sessionId: string) => {
    const { error } = await supabase.from("inventory_sessions").update({ status: "IN_PROGRESS", updated_at: new Date().toISOString() }).eq("id", sessionId);
    if (error) toast.error(error.message);
    else { toast.success("Session sent back"); fetchSessions(); }
  };

  const handleView = async (session: any) => {
    // Load session items
    const { data } = await supabase.from("inventory_session_items").select("*").eq("session_id", session.id);
    
    // If approved, load PAR guide values for risk display
    if (session.status === "APPROVED" && currentRestaurant) {
      const { data: guides } = await supabase
        .from("par_guides")
        .select("id")
        .eq("restaurant_id", currentRestaurant.id)
        .eq("inventory_list_id", session.inventory_list_id);
      
      if (guides && guides.length > 0) {
        const guideIds = guides.map(g => g.id);
        const { data: parData } = await supabase
          .from("par_guide_items")
          .select("item_name, par_level")
          .in("par_guide_id", guideIds);
        
        if (parData) {
          // Enrich items with approved PAR
          const parMap: Record<string, number> = {};
          parData.forEach(p => { parMap[p.item_name] = Number(p.par_level); });
          
          const enriched = (data || []).map(item => ({
            ...item,
            approved_par: parMap[item.item_name] ?? null,
          }));
          setViewItems(enriched);
          setViewSession(session);
          return;
        }
      }
    }
    
    setViewItems((data || []).map(item => ({ ...item, approved_par: null })));
    setViewSession(session);
  };

  const handleDuplicate = async (session: any) => {
    if (!currentRestaurant || !user) return;
    const { data: newSess, error } = await supabase.from("inventory_sessions").insert({
      restaurant_id: currentRestaurant.id,
      inventory_list_id: session.inventory_list_id,
      name: `${session.name} (copy)`,
      created_by: user.id
    }).select().single();
    if (error) { toast.error(error.message); return; }
    const { data: srcItems } = await supabase.from("inventory_session_items").select("*").eq("session_id", session.id);
    if (srcItems && srcItems.length > 0) {
      const duped = srcItems.map(({ id, session_id, ...rest }) => ({ ...rest, session_id: newSess.id }));
      await supabase.from("inventory_session_items").insert(duped);
    }
    toast.success("Session duplicated");
    fetchSessions();
  };

  const openSmartOrderModal = async (session: any) => {
    setSmartOrderSession(session);
    setSmartOrderSelectedPar("");
    if (!currentRestaurant) return;
    const { data } = await supabase.from("par_guides").select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("inventory_list_id", session.inventory_list_id);
    setSmartOrderParGuides(data || []);
  };

  const handleCreateSmartOrder = async () => {
    if (!smartOrderSession || !smartOrderSelectedPar || !currentRestaurant || !user) return;
    setSmartOrderCreating(true);

    const { data: sessionItems } = await supabase.from("inventory_session_items").select("*").eq("session_id", smartOrderSession.id);
    const { data: parItemsData } = await supabase.from("par_guide_items").select("*").eq("par_guide_id", smartOrderSelectedPar);

    if (!sessionItems) { toast.error("No session items found"); setSmartOrderCreating(false); return; }

    const parMap: Record<string, any> = {};
    (parItemsData || []).forEach(p => { parMap[p.item_name] = p; });

    const computed = sessionItems.map(i => {
      const par = parMap[i.item_name];
      const parLevel = par ? Number(par.par_level) : Number(i.par_level);
      const currentStock = Number(i.current_stock);
      const ratio = currentStock / Math.max(parLevel, 1);
      return {
        ...i,
        par_level: parLevel,
        suggestedOrder: Math.max(parLevel - currentStock, 0),
        risk: ratio < 0.5 ? "RED" : ratio < 1 ? "YELLOW" : "GREEN",
      };
    });

    const { data: run, error } = await supabase.from("smart_order_runs").insert({
      restaurant_id: currentRestaurant.id,
      session_id: smartOrderSession.id,
      inventory_list_id: smartOrderSession.inventory_list_id,
      par_guide_id: smartOrderSelectedPar,
      created_by: user.id,
    }).select().single();
    if (error) { toast.error(error.message); setSmartOrderCreating(false); return; }

    const runItems = computed.map(i => ({
      run_id: run.id,
      item_name: i.item_name,
      suggested_order: i.suggestedOrder,
      risk: i.risk,
      current_stock: i.current_stock,
      par_level: i.par_level,
      unit_cost: i.unit_cost || null,
      pack_size: i.pack_size || null,
    }));
    await supabase.from("smart_order_run_items").insert(runItems);

    const { data: ph } = await supabase.from("purchase_history").insert({
      restaurant_id: currentRestaurant.id,
      inventory_list_id: smartOrderSession.inventory_list_id,
      smart_order_run_id: run.id,
      created_by: user.id,
    }).select().single();

    if (ph) {
      const phItems = computed.filter(i => i.suggestedOrder > 0).map(i => ({
        purchase_history_id: ph.id,
        item_name: i.item_name,
        quantity: i.suggestedOrder,
        unit_cost: i.unit_cost || null,
        total_cost: i.unit_cost ? i.suggestedOrder * Number(i.unit_cost) : null,
        pack_size: i.pack_size || null,
      }));
      if (phItems.length > 0) {
        await supabase.from("purchase_history_items").insert(phItems);
      }
    }

    toast.success("Smart order created with purchase history!");
    setSmartOrderSession(null);
    setSmartOrderCreating(false);
    navigate(`/app/smart-order?viewRun=${run.id}`);
  };

  const isManagerOrOwner = currentRestaurant?.role === "OWNER" || currentRestaurant?.role === "MANAGER";

  const mappingMode = categoryMode === "list_order" ? "list_order"
    : categoryMode === "custom-categories" ? "custom-categories"
    : categoryMode === "my-categories" ? "my-categories"
    : null;

  const { categories: mappedCategories, itemCategoryMap, hasMappings } = useCategoryMapping(
    activeSession?.inventory_list_id || selectedList || null,
    mappingMode === "list_order" ? "list_order" : mappingMode
  );

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

  const filteredItems = items.filter((i) => {
    const cat = getItemCategory(i);
    if (filterCategory !== "all" && cat !== filterCategory) return false;
    if (search && !i.item_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (showOnlyEmpty && Number(i.current_stock) > 0) return false;
    return true;
  });

  // Sort by mapped order when mappings exist
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

  const categories = hasMappings
    ? mappedCategories.map(c => c.name)
    : [...new Set(items.map((i) => i.category).filter(Boolean))];
  const allCategories = hasMappings
    ? categories
    : [...defaultCategories, ...categories.filter((c) => !defaultCategories.includes(c))];

  const selectedListName = lists.find((l) => l.id === selectedList)?.name || "";

  // Group items by category for card view
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

  const jumpToNextEmpty = () => {
    const emptyItem = filteredItems.find(i => !i.current_stock || Number(i.current_stock) === 0);
    if (emptyItem && inputRefs.current[emptyItem.id]) {
      inputRefs.current[emptyItem.id]?.focus();
      inputRefs.current[emptyItem.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      toast.info("All items have been counted!");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number, field: "stock" | "par" = "stock") => {
    const getRef = (idx: number, f: string) => inputRefs.current[`${filteredItems[idx]?.id}_${f}`] || inputRefs.current[filteredItems[idx]?.id];

    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = getRef(currentIndex + 1, field);
      if (next) next.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = getRef(currentIndex - 1, field);
      if (prev) prev.focus();
    } else if (e.key === "Tab") {
      if (!e.shiftKey && field === "stock") {
        const parRef = inputRefs.current[`${filteredItems[currentIndex]?.id}_par`];
        if (parRef) { e.preventDefault(); parRef.focus(); }
      } else if (e.shiftKey && field === "par") {
        const stockRef = inputRefs.current[filteredItems[currentIndex]?.id];
        if (stockRef) { e.preventDefault(); stockRef.focus(); }
      }
    }
  };

  // Helper to get approved PAR for an item
  const getApprovedPar = (itemName: string): number | null => {
    const val = approvedParMap[itemName];
    return val !== undefined ? val : null;
  };

  if (loading && lists.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-64" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    );
  }

  // ─── SESSION EDITOR ────────────────────────────
  if (activeSession) {
    return (
      <div className="space-y-0 animate-fade-in pb-24 lg:pb-0">
        {/* Sticky top bar */}
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b pb-3 pt-3 -mx-4 px-4 lg:-mx-0 lg:px-0 lg:border-0 lg:static lg:bg-transparent lg:backdrop-blur-none space-y-3">
          <div className="hidden lg:block">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem><BreadcrumbLink href="/app/dashboard">Home</BreadcrumbLink></BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem><BreadcrumbLink className="cursor-pointer" onClick={() => { setActiveSession(null); fetchSessions(); }}>Inventory management</BreadcrumbLink></BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem><BreadcrumbPage>{activeSession.name}</BreadcrumbPage></BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => { setActiveSession(null); fetchSessions(); }}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <h1 className="text-base lg:text-2xl font-bold tracking-tight truncate">{activeSession.name}</h1>
                <p className="text-xs lg:text-sm text-muted-foreground truncate">{selectedListName}</p>
              </div>
            </div>
            <Badge className="bg-warning/10 text-warning border-0 text-[10px] shrink-0">In progress</Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0">
                  <ListOrdered className="h-3.5 w-3.5" />
                  {categoryMode === "list_order" ? "List Order" : categoryMode === "custom-categories" ? "Custom Categories" : "My Categories"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setCategoryMode("list_order"); setFilterCategory("all"); }}>
                  List Order (no categories)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setCategoryMode("custom-categories"); setFilterCategory("all"); }}>
                  Custom Categories (AI)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setCategoryMode("my-categories"); setFilterCategory("all"); }}>
                  My Categories (User)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Search + filters */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="pl-8 h-9 text-sm" />
            </div>
            <Button
              size="sm"
              variant={showOnlyEmpty ? "default" : "outline"}
              className="h-9 gap-1 text-xs shrink-0"
              onClick={() => setShowOnlyEmpty(!showOnlyEmpty)}
            >
              <EyeOff className="h-3 w-3" /> Empty
            </Button>
            <Button size="sm" variant="outline" className="h-9 gap-1 text-xs shrink-0" onClick={jumpToNextEmpty}>
              <SkipForward className="h-3 w-3" /> Next
            </Button>
          </div>

          {/* Category chips */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            <button
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterCategory === "all" ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"}`}
              onClick={() => setFilterCategory("all")}
            >All</button>
            {allCategories.map(c => (
              <button
                key={c}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterCategory === c ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"}`}
                onClick={() => setFilterCategory(c)}
              >{c}</button>
            ))}
          </div>

          {/* Desktop-only actions */}
          <div className="hidden lg:flex gap-2">
            <Button variant="outline" className="gap-2 text-xs h-9" onClick={() => setClearEntriesSessionId(activeSession.id)}>
              <Eraser className="h-3.5 w-3.5" /> Clear entries
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5 h-9"><Plus className="h-3.5 w-3.5" /> Add Item</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Item</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1"><Label>Item Name</Label><Input value={newItem.item_name} onChange={(e) => setNewItem({ ...newItem, item_name: e.target.value })} className="h-10" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><Label>Category</Label>
                      <Select value={newItem.category} onValueChange={(v) => setNewItem({ ...newItem, category: v })}>
                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>{defaultCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1"><Label>Unit</Label><Input value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} placeholder="lbs, packs..." className="h-10" /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1"><Label>Stock</Label><Input type="number" value={newItem.current_stock} onChange={(e) => setNewItem({ ...newItem, current_stock: +e.target.value })} className="h-10" /></div>
                    <div className="space-y-1"><Label>PAR Level</Label><Input type="number" value={newItem.par_level} onChange={(e) => setNewItem({ ...newItem, par_level: +e.target.value })} className="h-10" /></div>
                    <div className="space-y-1"><Label>Unit Cost</Label><Input type="number" value={newItem.unit_cost} onChange={(e) => setNewItem({ ...newItem, unit_cost: +e.target.value })} className="h-10" /></div>
                  </div>
                  <Button onClick={handleAddItem} className="w-full bg-gradient-amber">Add</Button>
                </div>
              </DialogContent>
            </Dialog>
            {catalogItems.length > 0 &&
              <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5 h-9"><BookOpen className="h-3.5 w-3.5" /> From Catalog</Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader><DialogTitle>Add from Catalog</DialogTitle></DialogHeader>
                  <div className="max-h-80 overflow-y-auto space-y-0.5">
                    {catalogItems.map((ci) =>
                      <div key={ci.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                        <div>
                          <p className="text-sm font-medium">{ci.item_name}</p>
                          <p className="text-[11px] text-muted-foreground">{[ci.category, ci.unit, ci.vendor_name].filter(Boolean).join(" · ")}</p>
                        </div>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleAddFromCatalog(ci)}><Plus className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            }
            <Button onClick={handleSubmitForReview} className="bg-gradient-amber shadow-amber gap-2 ml-auto" disabled={items.length === 0}>
              <Send className="h-4 w-4" /> Submit for Review
            </Button>
          </div>
        </div>

        {/* Main content */}
        {filteredItems.length === 0 ? (
          <Card className="border shadow-sm mt-4">
            <CardContent className="empty-state">
              <Package className="empty-state-icon" />
              <p className="empty-state-title">No items yet</p>
              <p className="empty-state-description">Add items manually or from your catalog to start counting.</p>
            </CardContent>
          </Card>
        ) : isCompact ? (
          /* ─── CARD LAYOUT (tablet/mobile) ─── */
          <div className="space-y-5 mt-4">
            {sortedCategoryKeys.map((category) => {
              const catItems = groupedItems[category];
              return (
              <div key={category}>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2 px-1">{category}</p>
                <div className="space-y-2">
                  {catItems.map((item, idx) => {
                    const globalIdx = filteredItems.indexOf(item);
                    const approvedPar = getApprovedPar(item.item_name);
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
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Count</label>
                              <Input
                                ref={el => { inputRefs.current[item.id] = el; }}
                                inputMode="decimal"
                                type="number"
                                min={0}
                                max={100}
                                step={0.01}
                                value={item.current_stock == null ? "" : String(item.current_stock)}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  handleUpdateStock(item.id, val === "" ? 0 : parseFloat(val) || 0);
                                }}
                                onBlur={() => handleSaveStock(item.id, Number(item.current_stock))}
                                onKeyDown={(e) => handleKeyDown(e, globalIdx, "stock")}
                                className="h-12 text-lg font-mono text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            </div>
                            <div className="shrink-0 text-center">
                              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">PAR</label>
                              <p className="h-12 flex items-center justify-center text-lg font-mono text-muted-foreground">
                                {approvedPar !== null ? approvedPar : "—"}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        ) : (
          /* ─── TABLE LAYOUT (desktop) ─── */
          <Card className="overflow-hidden border shadow-sm mt-4">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-semibold">Item</TableHead>
                  <TableHead className="text-xs font-semibold">Category</TableHead>
                  <TableHead className="text-xs font-semibold">Unit</TableHead>
                  <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                  <TableHead className="text-xs font-semibold">Current Stock</TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground">PAR Level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item, idx) => {
                  const approvedPar = getApprovedPar(item.item_name);
                  return (
                    <TableRow key={item.id} className="hover:bg-muted/20 transition-colors">
                      <TableCell className="font-medium text-sm">{item.item_name}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px] font-normal">{getItemCategory(item)}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.unit}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.pack_size || "—"}</TableCell>
                      <TableCell>
                        <Input
                          ref={el => { inputRefs.current[item.id] = el; }}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={100}
                          step={0.01}
                          value={item.current_stock == null ? "" : String(item.current_stock)}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const val = e.target.value;
                            handleUpdateStock(item.id, val === "" ? 0 : parseFloat(val) || 0);
                          }}
                          onBlur={() => handleSaveStock(item.id, Number(item.current_stock))}
                          onKeyDown={(e) => handleKeyDown(e, idx, "stock")}
                          className="w-20 h-8 text-sm font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {approvedPar !== null ? approvedPar : <span className="text-muted-foreground/50 text-xs">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Mobile/tablet bottom sticky bar */}
        {isCompact && (
          <div className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur-sm border-t p-3 flex gap-2 safe-area-bottom">
            <Button variant="outline" className="flex-1 gap-1.5 h-11 text-sm" onClick={() => setClearEntriesSessionId(activeSession.id)}>
              <Eraser className="h-4 w-4" /> Clear
            </Button>
            <Button className="flex-1 bg-gradient-amber shadow-amber gap-1.5 h-11 text-sm" onClick={() => setSubmitConfirmOpen(true)} disabled={items.length === 0}>
              <Send className="h-4 w-4" /> Submit
            </Button>
          </div>
        )}

        {/* Submit confirmation modal */}
        <AlertDialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Submit for review?</AlertDialogTitle>
              <AlertDialogDescription>
                This will send the inventory count to a manager for review. You won't be able to edit counts until it's sent back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setSubmitConfirmOpen(false); handleSubmitForReview(); }} className="bg-gradient-amber">Submit</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Clear Entries Confirm */}
        <AlertDialog open={!!clearEntriesSessionId} onOpenChange={(o) => !o && setClearEntriesSessionId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all entries?</AlertDialogTitle>
              <AlertDialogDescription>This will reset all current stock values to 0 for this session. The item rows will be kept so you can recount.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleClearEntries} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Clear Entries</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ─── MAIN DASHBOARD: 3 STACKED CARDS ──────────
  const renderSessionCard = (s: any, type: "inprogress" | "review" | "approved") => {
    const stats = sessionStats[s.id];
    const qtyLabel = stats && stats.qty > 0
      ? `${stats.qty % 1 === 0 ? stats.qty : stats.qty.toFixed(1)} cases`
      : null;
    const valueLabel = stats && stats.totalValue > 0 ? `$${stats.totalValue.toFixed(2)}` : null;

    if (isCompact) {
      return (
        <Card key={s.id} className="border shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate">{s.name}</p>
                <p className="text-[11px] text-muted-foreground">{s.inventory_lists?.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {type === "approved" && s.approved_at ? new Date(s.approved_at).toLocaleDateString() : new Date(s.updated_at).toLocaleDateString()}
                  {qtyLabel ? ` • ${qtyLabel}` : ""}
                  {valueLabel ? ` • ${valueLabel}` : ""}
                </p>
              </div>
              <Badge className={`shrink-0 text-[10px] border-0 ${
                type === "inprogress" ? "bg-warning/10 text-warning" :
                type === "review" ? "bg-primary/10 text-primary" :
                "bg-success/10 text-success"
              }`}>
                {type === "inprogress" ? "In progress" : type === "review" ? "Review" : "Approved"}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {type === "inprogress" && (
                <>
                  <Button size="sm" className="bg-gradient-amber gap-1.5 h-10 text-xs flex-1" onClick={() => openEditor(s)}>Continue</Button>
                  <Button size="sm" variant="outline" className="gap-1 h-10 text-xs" onClick={() => setClearEntriesSessionId(s.id)}>
                    <Eraser className="h-3 w-3" /> Clear
                  </Button>
                  <Button size="sm" variant="ghost" className="h-10 w-10 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteSessionId(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
              {type === "review" && (
                <>
                  <Button size="sm" variant="outline" className="gap-1.5 h-10 text-xs flex-1" onClick={() => handleView(s)}>
                    <Eye className="h-3.5 w-3.5" /> View
                  </Button>
                  {isManagerOrOwner && (
                    <>
                      <Button size="sm" className="bg-success hover:bg-success/90 gap-1.5 h-10 text-xs text-success-foreground flex-1" onClick={() => handleApprove(s.id)}>
                        <CheckCircle className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button size="sm" variant="destructive" className="gap-1.5 h-10 text-xs" onClick={() => handleReject(s.id)}>
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </>
              )}
              {type === "approved" && (
                <>
                  <Button size="sm" variant="outline" className="gap-1.5 h-10 text-xs flex-1" onClick={() => handleView(s)}>
                    <Eye className="h-3.5 w-3.5" /> View
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 h-10 text-xs" onClick={() => handleDuplicate(s)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" className="bg-gradient-amber gap-1.5 h-10 text-xs flex-1" onClick={() => openSmartOrderModal(s)}>
                    <ShoppingCart className="h-3.5 w-3.5" /> Smart Order
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      );
    }

    // Desktop row layout
    return (
      <div key={s.id} className="flex items-center justify-between py-3 px-4 rounded-lg border bg-muted/20">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{s.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {s.inventory_lists?.name}
            {type === "approved" && s.approved_at ? ` • ${new Date(s.approved_at).toLocaleDateString()}` : ` • ${new Date(s.updated_at).toLocaleDateString()}`}
            {qtyLabel ? ` • ${qtyLabel}` : ""}
            {valueLabel ? ` • ${valueLabel}` : ""}
          </p>
        </div>
        <Badge className={`text-[10px] border-0 ${
          type === "inprogress" ? "bg-warning/10 text-warning" :
          type === "review" ? "bg-primary/10 text-primary" :
          "bg-success/10 text-success"
        }`}>
          {type === "inprogress" ? "In progress" : type === "review" ? "Ready for review" : "Approved"}
        </Badge>
        <div className="flex items-center gap-2 ml-4">
          {type === "inprogress" && (
            <>
              <Button size="sm" className="bg-gradient-amber gap-1.5 h-8 text-xs" onClick={() => openEditor(s)}>Continue</Button>
              <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={() => setClearEntriesSessionId(s.id)}>
                <Eraser className="h-3 w-3" /> Clear
              </Button>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteSessionId(s.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {type === "review" && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => handleView(s)}>
                <Eye className="h-3.5 w-3.5" /> View
              </Button>
              {isManagerOrOwner && (
                <>
                  <Button size="sm" className="bg-success hover:bg-success/90 gap-1.5 h-8 text-xs text-success-foreground" onClick={() => handleApprove(s.id)}>
                    <CheckCircle className="h-3.5 w-3.5" /> Approve
                  </Button>
                  <Button size="sm" variant="destructive" className="gap-1.5 h-8 text-xs" onClick={() => handleReject(s.id)}>
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </Button>
                </>
              )}
            </>
          )}
          {type === "approved" && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => handleView(s)}>
                <Eye className="h-3.5 w-3.5" /> View
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => handleDuplicate(s)}>
                <Copy className="h-3.5 w-3.5" /> Duplicate
              </Button>
              <Button size="sm" className="bg-gradient-amber gap-1.5 h-8 text-xs" onClick={() => openSmartOrderModal(s)}>
                <ShoppingCart className="h-3.5 w-3.5" /> Create Smart Order
              </Button>
            </>
          )}
        </div>
      </div>
    );
  };

  // Compute risk summary for view dialog (approved sessions)
  const viewRiskSummary = viewItems && viewSession?.status === "APPROVED"
    ? viewItems.reduce((acc, item) => {
        const risk = getRisk(Number(item.current_stock), item.approved_par);
        acc[risk.color] = (acc[risk.color] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    : null;

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/app/dashboard">Home</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Inventory management</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Inventory management</h1>
        <Button className="bg-gradient-amber shadow-amber gap-2 h-10" onClick={() => setStartOpen(true)}>
          <Play className="h-4 w-4" /> Start inventory
        </Button>
      </div>

      {/* CARD 1: In Progress */}
      <Card className="border shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3 gap-2">
          <CardTitle className="text-base font-semibold shrink-0">In progress</CardTitle>
          <Select value={selectedList} onValueChange={setSelectedList}>
            <SelectTrigger className="h-8 w-40 lg:w-48 text-xs"><SelectValue placeholder="Inventory List" /></SelectTrigger>
            <SelectContent>
              {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="pt-0">
          {inProgressSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Clock className="h-10 w-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No inventory in progress</p>
            </div>
          ) : (
            <div className={`space-y-2 ${isCompact ? "grid gap-3 sm:grid-cols-2" : ""}`}>
              {inProgressSessions.map(s => renderSessionCard(s, "inprogress"))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* CARD 2: Review */}
      <Card className="border shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base font-semibold">Review</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {reviewSessions.length === 0 ? (
            <div className="text-center items-center justify-center flex flex-row py-0">
              <ClipboardCheck className="h-10 w-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No inventory</p>
            </div>
          ) : (
            <div className={`space-y-2 ${isCompact ? "grid gap-3 sm:grid-cols-2" : ""}`}>
              {reviewSessions.map(s => renderSessionCard(s, "review"))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* CARD 3: Approved */}
      <Card className="border shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3 gap-2">
          <CardTitle className="text-base font-semibold shrink-0">Approved</CardTitle>
          <Select value={approvedFilter} onValueChange={setApprovedFilter}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="pt-0">
          {approvedSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle className="h-10 w-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No inventory</p>
            </div>
          ) : (
            <div className={`space-y-2 ${isCompact ? "grid gap-3 sm:grid-cols-2" : ""}`}>
              {approvedSessions.map(s => renderSessionCard(s, "approved"))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Start Inventory Dialog */}
      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Start Inventory Session</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Inventory List</Label>
              <Select value={selectedList} onValueChange={(v) => { setSelectedList(v); setSelectedPar(""); }}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Select list" /></SelectTrigger>
                <SelectContent>{lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>PAR Guide (optional)</Label>
              <Select value={selectedPar} onValueChange={setSelectedPar} disabled={!selectedList}>
                <SelectTrigger className="h-10"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {parGuides.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Session Name</Label>
              <Input value={sessionName} onChange={(e) => setSessionName(e.target.value)} placeholder="e.g. Monday AM Count" className="h-10" />
            </div>
            <Button onClick={handleCreateSession} className="w-full bg-gradient-amber" disabled={!selectedList || !sessionName}>Start Session</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Smart Order Modal */}
      <Dialog open={!!smartOrderSession} onOpenChange={(o) => !o && setSmartOrderSession(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Smart Order</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Session: <span className="font-medium text-foreground">{smartOrderSession?.name}</span></p>
              <p className="text-sm text-muted-foreground">List: <span className="font-medium text-foreground">{smartOrderSession?.inventory_lists?.name}</span></p>
            </div>
            <div className="space-y-2">
              <Label>Select PAR Guide</Label>
              <Select value={smartOrderSelectedPar} onValueChange={setSmartOrderSelectedPar}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Choose PAR guide" /></SelectTrigger>
                <SelectContent>
                  {smartOrderParGuides.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {smartOrderParGuides.length === 0 && (
                <p className="text-xs text-muted-foreground">No PAR guides found for this list. Create one in PAR Management first.</p>
              )}
            </div>
            <Button
              onClick={handleCreateSmartOrder}
              className="w-full bg-gradient-amber"
              disabled={!smartOrderSelectedPar || smartOrderCreating}
            >
              {smartOrderCreating ? "Creating..." : "Create Smart Order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Session Dialog — enhanced with risk colors for approved sessions */}
      <Dialog open={!!viewItems} onOpenChange={() => { setViewItems(null); setViewSession(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewSession?.name} — Items
              {viewSession?.status === "APPROVED" && (
                <Badge className="bg-success/10 text-success border-0 text-[10px]">Approved</Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Risk summary cards for approved sessions */}
          {viewRiskSummary && (
            <div className="grid grid-cols-4 gap-2 mb-2">
              <div className="rounded-lg bg-destructive/10 p-3 text-center">
                <p className="text-lg font-bold text-destructive">{viewRiskSummary.red || 0}</p>
                <p className="text-[10px] font-medium text-destructive uppercase tracking-wide">High Risk</p>
              </div>
              <div className="rounded-lg bg-warning/10 p-3 text-center">
                <p className="text-lg font-bold text-warning">{viewRiskSummary.yellow || 0}</p>
                <p className="text-[10px] font-medium text-warning uppercase tracking-wide">Medium</p>
              </div>
              <div className="rounded-lg bg-success/10 p-3 text-center">
                <p className="text-lg font-bold text-success">{viewRiskSummary.green || 0}</p>
                <p className="text-[10px] font-medium text-success uppercase tracking-wide">Low Risk</p>
              </div>
              <div className="rounded-lg bg-muted/60 p-3 text-center">
                <p className="text-lg font-bold text-muted-foreground">{viewRiskSummary.gray || 0}</p>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">No PAR</p>
              </div>
            </div>
          )}

          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-semibold">Item</TableHead>
                  <TableHead className="text-xs font-semibold">Category</TableHead>
                  <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                  <TableHead className="text-xs font-semibold">Stock</TableHead>
                  <TableHead className="text-xs font-semibold">PAR</TableHead>
                  <TableHead className="text-xs font-semibold">Risk</TableHead>
                  <TableHead className="text-xs font-semibold">Suggested Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewItems?.map((item) => {
                  const isApproved = viewSession?.status === "APPROVED";
                  const risk = getRisk(Number(item.current_stock), item.approved_par);
                  const suggestedOrder = item.approved_par != null && item.approved_par > 0
                    ? Math.max(0, item.approved_par - Number(item.current_stock))
                    : null;

                  return (
                    <TableRow key={item.id} className={risk.bgClass}>
                      <TableCell className="text-sm font-medium">{item.item_name}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px] font-normal">{item.category}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.pack_size || "—"}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {isApproved ? (
                          <span>{item.current_stock}</span>
                        ) : (
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step={0.01}
                            className="w-20 h-7 text-sm font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            defaultValue={item.current_stock}
                            onFocus={(e) => e.target.select()}
                            onBlur={async (e) => {
                              const newVal = parseFloat(e.target.value) || 0;
                              await supabase.from("inventory_session_items")
                                .update({ current_stock: newVal })
                                .eq("id", item.id);
                              setViewItems(prev => prev ? prev.map(vi =>
                                vi.id === item.id ? { ...vi, current_stock: newVal } : vi
                              ) : prev);
                            }}
                          />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {item.approved_par !== null && item.approved_par !== undefined ? item.approved_par : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${risk.bgClass} ${risk.textClass} border-0 text-[10px]`}>
                          {risk.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {suggestedOrder !== null ? suggestedOrder.toFixed(1) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Clear Entries Confirm */}
      <AlertDialog open={!!clearEntriesSessionId} onOpenChange={(o) => !o && setClearEntriesSessionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all entries?</AlertDialogTitle>
            <AlertDialogDescription>This will reset all current stock values to 0 for this session. The item rows will be kept so you can recount.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearEntries} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Clear Entries</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Session Confirm */}
      <AlertDialog open={!!deleteSessionId} onOpenChange={(o) => !o && setDeleteSessionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this in-progress session and all its items. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSession} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Yes, delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
