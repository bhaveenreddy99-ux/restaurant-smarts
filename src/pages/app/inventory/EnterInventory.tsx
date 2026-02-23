import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { format } from "date-fns";
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
  Search, SkipForward, EyeOff, Check, ListOrdered, AlertTriangle, MoreHorizontal,
  LayoutGrid, List as ListIcon, TrendingDown, CalendarClock, MapPin, Filter } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useIsCompact, useIsMobile } from "@/hooks/use-mobile";
import { useCategoryMapping } from "@/hooks/useCategoryMapping";

import {
  getRisk, getRowState, getRowBgClass, formatNum, parseInputValue,
  inputDisplayValue, computeOrderQty, computeRiskLevel, formatCurrency,
} from "@/lib/inventory-utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ItemIdentityBlock from "@/components/ItemIdentityBlock";
import { useLastOrderDates } from "@/hooks/useLastOrderDates";

const defaultCategories = ["Frozen", "Cooler", "Dry"];

// ── Schedule helpers ──────────────────────────────────
function computeNextOccurrence(schedule: any): Date | null {
  const dayMap: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  const tzOffsets: Record<string, number> = {
    "America/New_York": -5, "America/Chicago": -6,
    "America/Denver": -7, "America/Los_Angeles": -8,
  };
  const days: string[] = schedule.days_of_week || [];
  const [h, m] = (schedule.time_of_day || "09:00").split(":").map(Number);
  const offset = tzOffsets[schedule.timezone] ?? -5;
  const now = new Date();

  const monthlyDay = days.find(d => d.startsWith("MONTHLY_"));
  if (monthlyDay) {
    const day = parseInt(monthlyDay.split("_")[1]);
    const candidate = new Date(now.getFullYear(), now.getMonth(), day, h, m, 0, 0);
    if (candidate <= now) candidate.setMonth(candidate.getMonth() + 1);
    return candidate;
  }

  for (let i = 0; i <= 7; i++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + i);
    const candidateDay = Object.keys(dayMap).find(k => dayMap[k] === candidate.getDay());
    if (candidateDay && days.includes(candidateDay)) {
      candidate.setHours(h, m, 0, 0);
      if (candidate > now) return candidate;
    }
  }
  return null;
}

function getScheduleStatus(nextDate: Date): "upcoming" | "ready" | "overdue" {
  const diffMs = nextDate.getTime() - Date.now();
  if (diffMs < 0) return "overdue";
  if (diffMs < 60 * 60 * 1000) return "ready";
  return "upcoming";
}

function formatCountdown(nextDate: Date): string {
  const diffMs = nextDate.getTime() - Date.now();
  if (diffMs <= 0) return "Now";
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function EnterInventoryPage() {
  const { currentRestaurant, locations, currentLocation, setCurrentLocation } = useRestaurant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isCompact = useIsCompact();
  const isMobile = useIsMobile();
  const { lastOrderDates } = useLastOrderDates(currentRestaurant?.id, currentLocation?.id);

  const [lists, setLists] = useState<any[]>([]);
  const [selectedList, setSelectedList] = useState("");
  const [loading, setLoading] = useState(true);

  const [inProgressSessions, setInProgressSessions] = useState<any[]>([]);
  const [reviewSessions, setReviewSessions] = useState<any[]>([]);
  const [approvedSessions, setApprovedSessions] = useState<any[]>([]);
  const [sessionStats, setSessionStats] = useState<Record<string, { qty: number; totalValue: number; counted: number; total: number }>>({});
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
  const [viewToggle, setViewToggle] = useState<"table" | "compact">("table");
  const [statusFilter, setStatusFilter] = useState<"all" | "uncounted" | "low" | "critical">("all");
  const [lastEditedId, setLastEditedId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Inventory schedules
  const [schedules, setSchedules] = useState<any[]>([]);
  const [, setCounterTick] = useState(0);

  // Approved PAR data for read-only display during count entry
  const [approvedParMap, setApprovedParMap] = useState<Record<string, number>>({});

  // Load approved PAR values when session opens
  useEffect(() => {
    if (!activeSession || !currentRestaurant) { setApprovedParMap({}); return; }
    const loadApprovedPar = async () => {
      const { data: guides } = await supabase
        .from("par_guides")
        .select("id")
        .eq("restaurant_id", currentRestaurant.id)
        .eq("inventory_list_id", activeSession.inventory_list_id);

      if (!guides || guides.length === 0) { setApprovedParMap({}); return; }

      const guideIds = guides.map(g => g.id);
      const { data: allParItems } = await supabase
        .from("par_guide_items")
        .select("item_name, par_level, par_guide_id")
        .in("par_guide_id", guideIds);

      if (!allParItems || allParItems.length === 0) { setApprovedParMap({}); return; }

      const map: Record<string, number> = {};
      allParItems.forEach(p => { map[p.item_name] = Number(p.par_level); });
      setApprovedParMap(map);
    };
    loadApprovedPar();
  }, [activeSession, currentRestaurant]);

  const fetchSchedules = useCallback(async () => {
    if (!currentRestaurant) return;
    const { data } = await supabase
      .from("reminders")
      .select("*, inventory_lists(name), locations(name)")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("is_enabled", true)
      .not("inventory_list_id", "is", null);
    if (data) setSchedules(data);
  }, [currentRestaurant]);

  useEffect(() => {
    if (!currentRestaurant) return;
    supabase.from("inventory_lists").select("*").eq("restaurant_id", currentRestaurant.id)
      .then(({ data }) => {
        if (data) {
          setLists(data);
          if (data.length > 0 && !selectedList) setSelectedList(data[0].id);
        }
      });
    fetchSchedules();
  }, [currentRestaurant]);

  useEffect(() => {
    const timer = setInterval(() => setCounterTick(t => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

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

    // Fetch item counts + total values + progress for all sessions
    const allSessions = [...filteredIp, ...filteredRv, ...filteredAp];
    if (allSessions.length > 0) {
      const sessionIds = allSessions.map((s) => s.id);
      const { data: statsRaw } = await supabase
        .from("inventory_session_items")
        .select("session_id, current_stock, unit_cost")
        .in("session_id", sessionIds);

      const statsMap: Record<string, { qty: number; totalValue: number; counted: number; total: number }> = {};
      (statsRaw || []).forEach((row) => {
        if (!statsMap[row.session_id]) statsMap[row.session_id] = { qty: 0, totalValue: 0, counted: 0, total: 0 };
        statsMap[row.session_id].qty += Number(row.current_stock ?? 0);
        statsMap[row.session_id].total += 1;
        if (row.current_stock !== null && Number(row.current_stock) > 0) {
          statsMap[row.session_id].counted += 1;
        }
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
        vendor_sku: ci.product_number || ci.vendor_sku || null,
        pack_size: ci.pack_size || null,
        vendor_name: ci.vendor_name || null,
        brand_name: ci.brand_name || null
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
      vendor_sku: catalogItem.product_number || catalogItem.vendor_sku || null,
      pack_size: catalogItem.pack_size || null,
      vendor_name: catalogItem.vendor_name || null,
      brand_name: catalogItem.brand_name || null
    };
    const { data, error } = await supabase.from("inventory_session_items").insert(payload).select().single();
    if (error) { toast.error(error.message); return; }
    setItems([...items, data]);
    toast.success(`Added ${catalogItem.item_name}`);
  };

  const handleUpdateStock = async (id: string, rawValue: string) => {
    const parsed = parseInputValue(rawValue);
    setItems(items.map((i) => i.id === id ? { ...i, current_stock: parsed } : i));
    setLastEditedId(id);
  };

  const handleUpdatePar = async (id: string, rawValue: string) => {
    const parsed = parseInputValue(rawValue);
    setItems(items.map((i) => i.id === id ? { ...i, par_level: parsed } : i));
  };

  const handleClearRow = async (id: string) => {
    setItems(items.map((i) => i.id === id ? { ...i, current_stock: null } : i));
    setSavingId(id);
    const { error } = await supabase.from("inventory_session_items").update({ current_stock: null } as any).eq("id", id);
    setSavingId(null);
    if (error) toast.error("Could not clear");
    else {
      setSavedId(id);
      setTimeout(() => setSavedId(prev => prev === id ? null : prev), 1500);
    }
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

  const handleSaveStock = useCallback(async (id: string, stockVal: number | null) => {
    setSavingId(id);
    const { error } = await supabase.from("inventory_session_items").update({ current_stock: stockVal ?? null } as any).eq("id", id);
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

  const autoCreateSmartOrder = async (sessionId: string) => {
    if (!currentRestaurant || !user) return;
    try {
      const { data: session } = await supabase.from("inventory_sessions").select("*").eq("id", sessionId).single();
      if (!session) return;

      const { data: sessionItems } = await supabase.from("inventory_session_items").select("*").eq("session_id", sessionId);
      if (!sessionItems || sessionItems.length === 0) return;

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

      const computed = sessionItems.map(i => {
        const parLevel = parMap[i.item_name] ?? Number(i.par_level);
        const currentStock = Number(i.current_stock ?? 0);
        const risk = computeRiskLevel(currentStock, parLevel);
        const suggestedOrder = computeOrderQty(currentStock, parLevel, i.unit, i.pack_size);
        return { ...i, parLevel, currentStock, risk, suggestedOrder };
      });

      const redCount = computed.filter(i => i.risk === "RED").length;
      const yellowCount = computed.filter(i => i.risk === "YELLOW").length;

      const { data: run, error: runError } = await supabase.from("smart_order_runs").insert({
        restaurant_id: currentRestaurant.id,
        session_id: sessionId,
        inventory_list_id: session.inventory_list_id,
        par_guide_id: latestGuide?.id || null,
        created_by: user.id,
      }).select().single();
      if (runError || !run) return;

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
    const { data } = await supabase.from("inventory_session_items").select("*").eq("session_id", session.id);
    
    if (currentRestaurant) {
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
      const risk = computeRiskLevel(currentStock, parLevel);
      const suggestedOrder = computeOrderQty(currentStock, parLevel, i.unit, i.pack_size);
      return {
        ...i,
        par_level: parLevel,
        suggestedOrder,
        risk,
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

  const nextSchedule = useMemo(() => {
    if (!schedules.length) return null;
    let closest: any = null;
    let closestDate: Date | null = null;
    for (const s of schedules) {
      const d = computeNextOccurrence(s);
      if (d && (!closestDate || d < closestDate)) {
        closestDate = d;
        closest = { ...s, nextDate: d };
      }
    }
    return closest;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules]);

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

  const getApprovedPar = (itemName: string): number | null => {
    const val = approvedParMap[itemName];
    return val !== undefined ? val : null;
  };

  // Build catalog lookup: item_name -> { catalog_item_id, product_number }
  const catalogLookup = useMemo(() => {
    const map: Record<string, { id: string; product_number: string | null }> = {};
    catalogItems.forEach((ci: any) => {
      map[ci.item_name] = { id: ci.id, product_number: ci.product_number || ci.vendor_sku || null };
    });
    return map;
  }, [catalogItems]);

  const getLastOrderDate = (itemName: string): string | null => {
    const cat = catalogLookup[itemName];
    if (!cat) return null;
    return lastOrderDates[cat.id] || null;
  };

  const getProductNumber = (item: any): string | null => {
    return item.vendor_sku || catalogLookup[item.item_name]?.product_number || null;
  };

  const formatLastOrdered = (date: string | null): string => {
    if (!date) return "—";
    try { return format(new Date(date), "MM/dd/yy"); } catch { return "—"; }
  };

  // Apply status filter in addition to category/search filters
  const filteredItems = items.filter((i) => {
    const cat = getItemCategory(i);
    if (filterCategory !== "all" && cat !== filterCategory) return false;
    if (search && !i.item_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (showOnlyEmpty && Number(i.current_stock) > 0) return false;
    // Status filter
    if (statusFilter === "uncounted" && getRowState(i) !== "uncounted") return false;
    if (statusFilter === "low") {
      const par = getApprovedPar(i.item_name);
      const risk = getRisk(Number(i.current_stock ?? 0), par);
      if (risk.label !== "Low") return false;
    }
    if (statusFilter === "critical") {
      const par = getApprovedPar(i.item_name);
      const risk = getRisk(Number(i.current_stock ?? 0), par);
      if (risk.label !== "Critical") return false;
    }
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

  const categories = hasMappings
    ? mappedCategories.map(c => c.name)
    : [...new Set(items.map((i) => i.category).filter(Boolean))];
  const allCategories = hasMappings
    ? categories
    : [...defaultCategories, ...categories.filter((c) => !defaultCategories.includes(c))];

  const selectedListName = lists.find((l) => l.id === selectedList)?.name || "";

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

  // Progress for active editor
  const countedItems = items.filter(i => i.current_stock !== null && Number(i.current_stock) > 0).length;
  const totalItems = items.length;
  const progressPct = totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0;

  // Submit summary stats
  const submitSummary = useMemo(() => {
    let lowCount = 0;
    let criticalCount = 0;
    let estimatedValue = 0;
    items.forEach(i => {
      const par = getApprovedPar(i.item_name);
      const risk = getRisk(Number(i.current_stock ?? 0), par);
      if (risk.label === "Low") lowCount++;
      if (risk.label === "Critical") criticalCount++;
      if (par && par > 0) {
        const need = Math.max(0, par - Number(i.current_stock ?? 0));
        if (need > 0 && i.unit_cost) estimatedValue += need * Number(i.unit_cost);
      }
    });
    return { counted: countedItems, total: totalItems, lowCount, criticalCount, estimatedValue };
  }, [items, approvedParMap]);

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
    const useCompactLayout = isCompact || viewToggle === "compact";

    return (
      <div className="space-y-0 animate-fade-in pb-28 lg:pb-4">
        {/* ═══ STICKY TOP CONTROL BAR ═══ */}
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm -mx-4 px-4 lg:-mx-0 lg:px-0 border-b border-border/40">
          {/* Row 1: Identity + Location + Submit */}
          <div className="flex items-center gap-3 py-3">
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-lg" onClick={() => { setActiveSession(null); fetchSessions(); }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="text-base lg:text-lg font-bold tracking-tight truncate">{activeSession.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground truncate">{selectedListName}</span>
                {locations.length > 1 && currentLocation && (
                  <Badge variant="outline" className="text-[10px] gap-1 shrink-0 font-normal">
                    <MapPin className="h-2.5 w-2.5" />
                    {currentLocation.name}
                  </Badge>
                )}
              </div>
            </div>

            {/* Save status */}
            <div className="shrink-0 min-w-[50px] text-right hidden lg:block">
              {savingId && <span className="text-xs text-muted-foreground animate-pulse">Saving…</span>}
              {!savingId && savedId && <span className="text-xs text-success flex items-center gap-1 justify-end"><Check className="h-3.5 w-3.5" /> Saved</span>}
            </div>

            {/* Submit — sticky visible on desktop */}
            <Button
              onClick={() => setSubmitConfirmOpen(true)}
              className="bg-gradient-amber shadow-amber gap-2 h-9 px-5 text-sm shrink-0 hidden lg:flex"
              disabled={items.length === 0}
            >
              <Send className="h-3.5 w-3.5" /> Submit for Review
            </Button>
          </div>

          {/* Row 2: Search + Category pills + Progress + Filters */}
          <div className="flex items-center gap-3 pb-3 flex-wrap lg:flex-nowrap">
            {/* LEFT: Search */}
            <div className="relative min-w-[180px] lg:min-w-[240px] lg:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items…"
                className="pl-9 h-10 text-sm bg-card border-border/50"
              />
            </div>

            {/* LEFT: Category pills */}
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              <button
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${filterCategory === "all" ? "bg-foreground text-background" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                onClick={() => setFilterCategory("all")}
              >All</button>
              {allCategories.map(c => (
                <button
                  key={c}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${filterCategory === c ? "bg-foreground text-background" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                  onClick={() => setFilterCategory(c)}
                >{c}</button>
              ))}
            </div>

            {/* CENTER: Progress — desktop */}
            <div className="hidden lg:flex items-center gap-3 mx-auto shrink-0">
              <div className="text-center">
                <p className="text-sm font-bold tabular-nums">{countedItems} <span className="text-muted-foreground font-normal">/ {totalItems}</span></p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">counted</p>
              </div>
              <div className="w-32 h-2 rounded-full bg-muted/60 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-amber transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{progressPct}%</span>
            </div>

            {/* RIGHT: View toggle + Filters */}
            <div className="hidden lg:flex items-center gap-2 ml-auto shrink-0">
              {/* View toggle */}
              <div className="flex items-center border rounded-lg overflow-hidden h-9">
                <button
                  className={`px-3 h-full text-xs font-medium transition-all ${viewToggle === "table" ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:bg-muted/50"}`}
                  onClick={() => setViewToggle("table")}
                >Standard</button>
                <button
                  className={`px-3 h-full text-xs font-medium transition-all ${viewToggle === "compact" ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:bg-muted/50"}`}
                  onClick={() => setViewToggle("compact")}
                >Compact</button>
              </div>

              {/* Status filter dropdown */}
              <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                <SelectTrigger className="h-9 w-[130px] text-xs">
                  <Filter className="h-3.5 w-3.5 mr-1.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Show All</SelectItem>
                  <SelectItem value="uncounted">Uncounted</SelectItem>
                  <SelectItem value="low">Low Stock</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>

              {/* Quick actions */}
              <Button size="sm" variant="outline" className="h-9 gap-1.5 text-xs" onClick={jumpToNextEmpty}>
                <SkipForward className="h-3.5 w-3.5" /> Next Empty
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setClearEntriesSessionId(activeSession.id)}>
                    <Eraser className="h-3.5 w-3.5 mr-2" /> Clear entries
                  </DropdownMenuItem>
                  <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                    <DialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                        <Plus className="h-3.5 w-3.5 mr-2" /> Add item
                      </DropdownMenuItem>
                    </DialogTrigger>
                  </Dialog>
                  {catalogItems.length > 0 && (
                    <DropdownMenuItem onClick={() => setCatalogOpen(true)}>
                      <BookOpen className="h-3.5 w-3.5 mr-2" /> Add from catalog
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => { setCategoryMode(categoryMode === "list_order" ? "custom-categories" : categoryMode === "custom-categories" ? "my-categories" : "list_order"); setFilterCategory("all"); }}>
                    <ListOrdered className="h-3.5 w-3.5 mr-2" />
                    {categoryMode === "list_order" ? "Switch to AI Categories" : categoryMode === "custom-categories" ? "Switch to My Categories" : "Switch to List Order"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* ═══ MOBILE PROGRESS BAR ═══ */}
        {isCompact && totalItems > 0 && (
          <div className="py-3 px-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-bold tabular-nums">{countedItems} / {totalItems} <span className="font-normal text-muted-foreground">counted</span></span>
              <span className="text-xs font-medium text-muted-foreground tabular-nums">{progressPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-amber transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {/* ═══ MAIN CONTENT ═══ */}
        {filteredItems.length === 0 ? (
          <div className="rounded-xl border border-border/40 bg-card mt-4">
            <div className="py-16 text-center">
              <Package className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-sm font-medium text-muted-foreground">No items match your filters</p>
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs mx-auto">Try adjusting your search or category filter, or add new items.</p>
              <Button variant="outline" className="mt-4 gap-1.5" onClick={() => { setSearch(""); setFilterCategory("all"); setStatusFilter("all"); }}>
                Clear Filters
              </Button>
            </div>
          </div>
        ) : useCompactLayout ? (
          /* ─── CARD LAYOUT (tablet/mobile or compact toggle) ─── */
          <div className="space-y-6 mt-2">
            {sortedCategoryKeys.map((category) => {
              const catItems = groupedItems[category];
              return (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60">{category}</p>
                    <span className="text-[10px] text-muted-foreground/40 tabular-nums">({catItems.length})</span>
                  </div>
                  <div className="space-y-2.5">
                    {catItems.map((item) => {
                      const globalIdx = filteredItems.indexOf(item);
                      const approvedPar = getApprovedPar(item.item_name);
                      const need = approvedPar !== null && item.current_stock !== null
                        ? Math.max(0, approvedPar - Number(item.current_stock ?? 0))
                        : null;
                      const risk = getRisk(item.current_stock, approvedPar);
                      const rowState = getRowState(item.current_stock);
                      const isRecentlyEdited = lastEditedId === item.id;

                      return (
                        <div
                          key={item.id}
                          className={`rounded-xl border transition-all duration-200 ${
                            rowState === "counted" ? "border-success/20 bg-success/[0.03]" :
                            rowState === "zero" ? "border-border/30 bg-muted/10" :
                            "border-border/40 bg-card"
                          } ${isRecentlyEdited ? "ring-2 ring-primary/20" : ""}`}
                        >
                          <div className="p-4 space-y-3">
                            {/* Item identity */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-sm leading-tight">{item.item_name}</p>
                                <ItemIdentityBlock
                                  brandName={item.brand_name}
                                  className="block mt-0.5"
                                />
                                <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                                  {getProductNumber(item) && <span className="text-[10px] text-muted-foreground/50">#{getProductNumber(item)}</span>}
                                  {item.pack_size && <span className="text-[10px] text-muted-foreground/50">{item.pack_size}</span>}
                                  <span className="text-[10px] text-muted-foreground/50">Last: {formatLastOrdered(getLastOrderDate(item.item_name))}</span>
                                </div>
                              </div>
                              <Badge className={`${risk.bgClass} ${risk.textClass} border-0 text-[10px] font-medium shrink-0`}>
                                {risk.label}
                              </Badge>
                            </div>

                            {/* Count input area — large targets for tablet */}
                            <div className="flex items-end gap-4">
                              <div className="flex-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">On Hand</label>
                                <Input
                                  ref={el => { inputRefs.current[item.id] = el; }}
                                  inputMode="decimal"
                                  type="number"
                                  min={0}
                                  step={0.1}
                                  value={inputDisplayValue(item.current_stock)}
                                  onFocus={(e) => e.target.select()}
                                  onChange={(e) => handleUpdateStock(item.id, e.target.value)}
                                  onBlur={() => handleSaveStock(item.id, item.current_stock)}
                                  onKeyDown={(e) => handleKeyDown(e, globalIdx, "stock")}
                                  className="h-14 text-xl font-mono text-center font-semibold rounded-lg border-2 border-border/60 focus:border-primary/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                              </div>
                              <div className="shrink-0 text-center w-16">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">PAR</label>
                                <p className="h-14 flex items-center justify-center text-lg font-mono text-muted-foreground/70">
                                  {approvedPar !== null ? approvedPar : "—"}
                                </p>
                              </div>
                              {need !== null && need > 0 && (
                                <div className="shrink-0 text-center w-16">
                                  <label className="text-[10px] font-semibold text-warning uppercase tracking-wider mb-1.5 block">Need</label>
                                  <p className="h-14 flex items-center justify-center text-lg font-mono text-warning font-bold">
                                    {need % 1 === 0 ? need : need.toFixed(1)}
                                  </p>
                                </div>
                              )}
                            </div>

                            {/* Save indicator */}
                            {(savingId === item.id || savedId === item.id) && (
                              <div className="flex items-center gap-1.5">
                                {savingId === item.id && <span className="text-[10px] text-muted-foreground animate-pulse">Saving…</span>}
                                {savedId === item.id && <span className="text-[10px] text-success flex items-center gap-0.5"><Check className="h-3 w-3" /> Saved</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ─── TABLE LAYOUT (desktop standard) ─── */
          <div className="mt-4 space-y-6">
            {sortedCategoryKeys.map((category) => {
              const catItems = groupedItems[category];
              return (
                <div key={category} className="rounded-xl border border-border/40 overflow-hidden bg-card">
                  {/* Category header */}
                  <div className="px-5 py-3 bg-muted/30 border-b border-border/30">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">{category}</p>
                      <span className="text-[10px] text-muted-foreground/40 tabular-nums">({catItems.length})</span>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b border-border/20 hover:bg-transparent">
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 pl-5">Item</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-24">Product #</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-24">Pack Size</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-24">Last Ordered</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-36 text-center">On Hand</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-20 text-right">PAR</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-20 text-right">Need</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-24 text-center pr-5">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {catItems.map((item) => {
                        const globalIdx = filteredItems.indexOf(item);
                        const approvedPar = getApprovedPar(item.item_name);
                        const currentStock = Number(item.current_stock ?? 0);
                        const need = approvedPar !== null ? Math.max(0, approvedPar - currentStock) : null;
                        const risk = getRisk(item.current_stock, approvedPar);
                        const rowState = getRowState(item.current_stock);
                        const rowBg = getRowBgClass(item.current_stock);
                        const isRecentlyEdited = lastEditedId === item.id;

                        return (
                          <TableRow
                            key={item.id}
                            className={`border-b border-border/10 transition-all duration-200 hover:bg-muted/20 ${rowBg} ${isRecentlyEdited ? "bg-primary/[0.03]" : ""}`}
                          >
                            <TableCell className="pl-5 py-3">
                              <p className="font-medium text-sm leading-tight">{item.item_name}</p>
                              <ItemIdentityBlock
                                brandName={item.brand_name}
                                className="block mt-0.5"
                              />
                            </TableCell>
                            <TableCell className="py-3 text-xs text-muted-foreground/60 font-mono">
                              {getProductNumber(item) || <span className="text-muted-foreground/30">—</span>}
                            </TableCell>
                            <TableCell className="py-3 text-xs text-muted-foreground/60">
                              {item.pack_size || <span className="text-muted-foreground/30">—</span>}
                            </TableCell>
                            <TableCell className="py-3 text-xs text-muted-foreground/60">
                              {formatLastOrdered(getLastOrderDate(item.item_name))}
                            </TableCell>
                            <TableCell className="text-center py-3">
                              <div className="flex items-center justify-center gap-2">
                                <Input
                                  ref={el => { inputRefs.current[item.id] = el; }}
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step={0.1}
                                  value={inputDisplayValue(item.current_stock)}
                                  onFocus={(e) => e.target.select()}
                                  onChange={(e) => handleUpdateStock(item.id, e.target.value)}
                                  onBlur={() => handleSaveStock(item.id, item.current_stock)}
                                  onKeyDown={(e) => handleKeyDown(e, globalIdx, "stock")}
                                  className="w-24 h-10 text-base font-mono text-center font-semibold rounded-lg border-2 border-border/50 focus:border-primary/50 bg-background [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <div className="w-5">
                                  {savingId === item.id && <span className="text-muted-foreground animate-pulse text-xs">…</span>}
                                  {savedId === item.id && <Check className="h-3.5 w-3.5 text-success" />}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm text-muted-foreground/60 py-3">
                              {approvedPar !== null ? approvedPar : <span className="text-muted-foreground/30">—</span>}
                            </TableCell>
                            <TableCell className="text-right py-3">
                              {need !== null && need > 0
                                ? <span className="font-mono text-sm font-semibold text-destructive">{need % 1 === 0 ? need : need.toFixed(1)}</span>
                                : <span className="text-muted-foreground/30 text-sm">—</span>
                              }
                            </TableCell>
                            <TableCell className="text-center pr-5 py-3">
                              <Badge className={`${risk.bgClass} ${risk.textClass} border-0 text-[10px] font-medium`}>
                                {risk.label}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              );
            })}
          </div>
        )}

        {/* ═══ TABLET/MOBILE STICKY BOTTOM BAR ═══ */}
        {isCompact && (
          <div className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur-md border-t border-border/40 safe-area-bottom">
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Progress mini */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-muted/60 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-amber transition-all" style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground tabular-nums shrink-0">{countedItems}/{totalItems}</span>
                </div>
              </div>

              {/* Quick filter */}
              <Button
                variant={showOnlyEmpty ? "default" : "outline"}
                size="sm"
                className={`h-10 text-xs shrink-0 ${showOnlyEmpty ? "bg-foreground text-background" : ""}`}
                onClick={() => setShowOnlyEmpty(!showOnlyEmpty)}
              >
                Uncounted
              </Button>

              {/* Submit */}
              <Button
                className="bg-gradient-amber shadow-amber h-11 px-5 text-sm font-medium shrink-0"
                onClick={() => setSubmitConfirmOpen(true)}
                disabled={items.length === 0}
              >
                <Send className="h-4 w-4 mr-1.5" /> Submit
              </Button>
            </div>
          </div>
        )}

        {/* ═══ SUBMIT CONFIRMATION MODAL ═══ */}
        <AlertDialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-lg">Submit for Review?</AlertDialogTitle>
              <AlertDialogDescription className="text-sm">
                This will send the inventory count to a manager for review.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 my-2">
              <div className="rounded-lg bg-muted/30 p-3 text-center">
                <p className="text-2xl font-bold tabular-nums">{submitSummary.counted}</p>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Items Counted</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3 text-center">
                <p className="text-2xl font-bold tabular-nums">{submitSummary.total - submitSummary.counted}</p>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Uncounted</p>
              </div>
              <div className="rounded-lg bg-warning/10 p-3 text-center">
                <p className="text-2xl font-bold text-warning tabular-nums">{submitSummary.lowCount}</p>
                <p className="text-[10px] font-medium text-warning uppercase tracking-wide">Low Stock</p>
              </div>
              <div className="rounded-lg bg-destructive/10 p-3 text-center">
                <p className="text-2xl font-bold text-destructive tabular-nums">{submitSummary.criticalCount}</p>
                <p className="text-[10px] font-medium text-destructive uppercase tracking-wide">Critical</p>
              </div>
            </div>

            {submitSummary.estimatedValue > 0 && (
              <div className="rounded-lg border border-border/40 p-3 text-center">
                <p className="text-xs text-muted-foreground">Estimated Reorder Value</p>
                <p className="text-lg font-bold tabular-nums">${submitSummary.estimatedValue.toFixed(2)}</p>
              </div>
            )}

            <AlertDialogFooter className="mt-2">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setSubmitConfirmOpen(false); handleSubmitForReview(); }} className="bg-gradient-amber">
                Confirm Submit
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Add Item Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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

        {/* Catalog Dialog */}
        {catalogItems.length > 0 && (
          <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
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
        )}

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

  // ─── MAIN DASHBOARD: COMMAND CENTER ──────────
  const viewRiskSummary = viewItems && viewSession?.status === "APPROVED"
    ? viewItems.reduce((acc, item) => {
        const risk = getRisk(Number(item.current_stock), item.approved_par);
        acc[risk.color] = (acc[risk.color] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    : null;

  return (
    <div className="space-y-5 animate-fade-in">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/app/dashboard">Home</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Inventory management</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your counts, reviews, and history</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Location switcher for multi-location */}
          {locations.length > 1 && (
            <Select value={currentLocation?.id || "all"} onValueChange={(v) => {
              if (v === "all") setCurrentLocation(null);
              else {
                const loc = locations.find(l => l.id === v);
                if (loc) setCurrentLocation(loc);
              }
            }}>
              <SelectTrigger className="h-9 w-40 text-xs gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={selectedList} onValueChange={setSelectedList}>
            <SelectTrigger className="h-9 w-40 lg:w-48 text-xs"><SelectValue placeholder="Inventory List" /></SelectTrigger>
            <SelectContent>
              {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button className="bg-gradient-amber shadow-amber gap-2 h-9" onClick={() => setStartOpen(true)}>
            <Play className="h-4 w-4" /> Start count
          </Button>
        </div>
      </div>

      {/* ── NEXT SCHEDULED COUNT PANEL ── */}
      {nextSchedule && (() => {
        const status = getScheduleStatus(nextSchedule.nextDate);
        const statusConfig = {
          upcoming: { label: "Upcoming", cls: "bg-primary/10 text-primary border-primary/20" },
          ready:    { label: "Ready to Start", cls: "bg-success/10 text-success border-success/30" },
          overdue:  { label: "Overdue", cls: "bg-destructive/10 text-destructive border-destructive/30" },
        }[status];
        const existingSession = inProgressSessions.find(s => s.inventory_list_id === nextSchedule.inventory_list_id);
        return (
          <div className={`rounded-lg border p-4 ${status === "overdue" ? "border-destructive/30 bg-destructive/5" : status === "ready" ? "border-success/30 bg-success/5" : "border-border bg-card"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Next Scheduled Count</p>
                  <Badge className={`text-[10px] border ${statusConfig.cls}`}>{statusConfig.label}</Badge>
                </div>
                <p className="font-semibold text-sm">{nextSchedule.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {nextSchedule.inventory_lists?.name}
                  {nextSchedule.locations?.name ? ` · ${nextSchedule.locations.name}` : ""}
                  {" · "}
                  {nextSchedule.nextDate.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                  {" at "}
                  {nextSchedule.nextDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {status === "overdue" ? "This count is past due" : `Starts in ${formatCountdown(nextSchedule.nextDate)}`}
                </p>
              </div>
              <Button size="sm" className="shrink-0 h-8 text-xs gap-1.5 bg-gradient-amber shadow-amber"
                onClick={() => existingSession ? openEditor(existingSession) : setStartOpen(true)}>
                {existingSession ? <><ChevronRight className="h-3.5 w-3.5" />Continue Count</> : <><Play className="h-3.5 w-3.5" />Start Now</>}
              </Button>
            </div>
          </div>
        );
      })()}

      {/* ── SECTION A: TODAY — In Progress ── */}
      <div>
        <p className="section-label mb-2">Today's count</p>
        {inProgressSessions.length === 0 ? (
          <Card className="border shadow-sm">
            <CardContent className="py-10 text-center">
              <Clock className="h-10 w-10 text-muted-foreground/20 mb-3 mx-auto" />
              <p className="text-sm font-medium text-muted-foreground">No inventory in progress</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Start a count to begin tracking today's inventory</p>
              <Button className="bg-gradient-amber shadow-amber gap-2 mt-4" onClick={() => setStartOpen(true)}>
                <Play className="h-4 w-4" /> Start inventory
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {(() => {
              const s = inProgressSessions[0];
              const stats = sessionStats[s.id];
              const counted = stats?.counted ?? 0;
              const total = stats?.total ?? 0;
              const pct = total > 0 ? Math.round((counted / total) * 100) : 0;
              return (
                <Card key={s.id} className="border shadow-sm overflow-hidden">
                  <CardContent className="p-0">
                    <div className="flex items-start justify-between p-4 pb-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm truncate">{s.name}</p>
                          <Badge className="bg-warning/10 text-warning border-0 text-[10px] shrink-0">In Progress</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{s.inventory_lists?.name}</p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setClearEntriesSessionId(s.id)}>
                            <Eraser className="h-3.5 w-3.5 mr-2" /> Clear entries
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteSessionId(s.id)}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete session
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {total > 0 && (
                      <div className="px-4 pb-3">
                        <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                          <span>{counted} / {total} counted</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-amber transition-all duration-300" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 px-4 pb-4">
                      <Button className="bg-gradient-amber shadow-amber gap-2 flex-1" onClick={() => openEditor(s)}>
                        <ChevronRight className="h-4 w-4" /> Continue count
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {inProgressSessions.slice(1).map(s => {
              const stats = sessionStats[s.id];
              const counted = stats?.counted ?? 0;
              const total = stats?.total ?? 0;
              return (
                <div key={s.id} className="flex items-center gap-3 py-2.5 px-4 rounded-lg border bg-card">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <p className="text-[11px] text-muted-foreground">{s.inventory_lists?.name} · {counted}/{total} counted</p>
                  </div>
                  <Button size="sm" className="bg-gradient-amber gap-1.5 h-8 text-xs shrink-0" onClick={() => openEditor(s)}>Continue</Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setClearEntriesSessionId(s.id)}><Eraser className="h-3.5 w-3.5 mr-2" />Clear entries</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleteSessionId(s.id)}><Trash2 className="h-3.5 w-3.5 mr-2" />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── SECTION B: NEEDS REVIEW — Manager only ── */}
      {isManagerOrOwner && reviewSessions.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <p className="section-label">Needs review</p>
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{reviewSessions.length}</Badge>
          </div>
          <div className="rounded-lg border overflow-hidden divide-y">
            {reviewSessions.map(s => {
              const stats = sessionStats[s.id];
              const qtyLabel = stats?.qty ? `${stats.qty % 1 === 0 ? stats.qty : stats.qty.toFixed(1)} cases` : null;
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/20 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{s.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {s.inventory_lists?.name} · {new Date(s.updated_at).toLocaleDateString()}
                      {qtyLabel ? ` · ${qtyLabel}` : ""}
                    </p>
                  </div>
                  <Button size="sm" className="h-8 text-xs gap-1.5 shrink-0" onClick={() => handleView(s)}>
                    <Eye className="h-3 w-3" /> Review
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleApprove(s.id)}>
                        <CheckCircle className="h-3.5 w-3.5 mr-2 text-success" /> Approve
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => handleReject(s.id)}>
                        <XCircle className="h-3.5 w-3.5 mr-2" /> Send back
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SECTION C: HISTORY — Approved ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="section-label">History</p>
          <Select value={approvedFilter} onValueChange={setApprovedFilter}>
            <SelectTrigger className="h-7 w-32 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {approvedSessions.length === 0 ? (
          <div className="flex items-center gap-3 py-6 px-4 rounded-lg border bg-card text-center justify-center">
            <CheckCircle className="h-5 w-5 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No approved sessions in this period</p>
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden divide-y">
            {approvedSessions.map(s => {
              const stats = sessionStats[s.id];
              const qtyLabel = stats?.qty ? `${stats.qty % 1 === 0 ? stats.qty : stats.qty.toFixed(1)} cases` : null;
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/20 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{s.name}</p>
                      <Badge className="bg-success/10 text-success border-0 text-[10px] shrink-0">Approved</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {s.inventory_lists?.name} · {s.approved_at ? new Date(s.approved_at).toLocaleDateString() : new Date(s.updated_at).toLocaleDateString()}
                      {qtyLabel ? ` · ${qtyLabel}` : ""}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleView(s)}>
                        <Eye className="h-3.5 w-3.5 mr-2" /> View items
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDuplicate(s)}>
                        <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openSmartOrderModal(s)}>
                        <ShoppingCart className="h-3.5 w-3.5 mr-2" /> Create Smart Order
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleteSessionId(s.id)}>
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </div>

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

      {/* View Session Dialog */}
      <Dialog open={!!viewItems} onOpenChange={() => { setViewItems(null); setViewSession(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewSession?.name} — Items
              {viewSession?.status === "APPROVED" && (
                <Badge className="bg-success/10 text-success border-0 text-[10px]">Approved</Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {viewRiskSummary && (
            <div className="grid grid-cols-4 gap-2 mb-2">
              <div className="rounded-lg bg-destructive/10 p-3 text-center">
                <p className="text-lg font-bold text-destructive">{viewRiskSummary.red || 0}</p>
                <p className="text-[10px] font-medium text-destructive uppercase tracking-wide">Critical</p>
              </div>
              <div className="rounded-lg bg-warning/10 p-3 text-center">
                <p className="text-lg font-bold text-warning">{viewRiskSummary.yellow || 0}</p>
                <p className="text-[10px] font-medium text-warning uppercase tracking-wide">Low</p>
              </div>
              <div className="rounded-lg bg-success/10 p-3 text-center">
                <p className="text-lg font-bold text-success">{viewRiskSummary.green || 0}</p>
                <p className="text-[10px] font-medium text-success uppercase tracking-wide">OK</p>
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
                  <TableHead className="text-xs font-semibold">Product #</TableHead>
                  <TableHead className="text-xs font-semibold">Category</TableHead>
                  <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                  <TableHead className="text-xs font-semibold">Last Ordered</TableHead>
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
                      <TableCell className="text-xs text-muted-foreground font-mono">{getProductNumber(item) || "—"}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px] font-normal">{item.category}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.pack_size || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatLastOrdered(getLastOrderDate(item.item_name))}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {isApproved ? (
                          <span>{item.current_stock}</span>
                        ) : (
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step={0.1}
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
            <AlertDialogDescription>This will permanently delete this session and all its items. This action cannot be undone.</AlertDialogDescription>
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
