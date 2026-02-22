import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  FileText, Upload, Plus, Search, Loader2, Check, AlertTriangle,
  X, DollarSign, Package, Calendar, Hash, Truck, Eye, Trash2,
  TrendingUp, TrendingDown, Info
} from "lucide-react";
import { formatNum } from "@/lib/inventory-utils";
import * as XLSX from "xlsx";

interface InvoiceItem {
  product_number: string | null;
  item_name: string;
  quantity: number;
  unit_cost: number | null;
  line_total: number | null;
  unit: string | null;
  pack_size: string | null;
  catalog_item_id: string | null;
  match_status: "MATCHED" | "UNMATCHED" | "MANUAL";
  catalog_match_name?: string;
}

interface InvoiceHeader {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  location_id: string;
  linked_smart_order_id: string;
}

export default function InvoicesPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const [purchases, setPurchases] = useState<any[]>([]);
  const [purchaseItems, setPurchaseItems] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewPurchase, setViewPurchase] = useState<any>(null);
  const [viewItems, setViewItems] = useState<any[]>([]);
  const [searchFilter, setSearchFilter] = useState("");
  const [dateRange, setDateRange] = useState("all");

  // Create invoice state
  const [activeTab, setActiveTab] = useState("upload");
  const [header, setHeader] = useState<InvoiceHeader>({
    vendor_name: "", invoice_number: "", invoice_date: new Date().toISOString().split("T")[0],
    location_id: "", linked_smart_order_id: "",
  });
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [smartOrders, setSmartOrders] = useState<any[]>([]);
  const [linkedSmartOrderItems, setLinkedSmartOrderItems] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchPurchases = useCallback(async () => {
    if (!currentRestaurant) return;
    setLoading(true);
    let query = supabase.from("purchase_history").select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .order("created_at", { ascending: false });

    if (dateRange !== "all") {
      const now = new Date();
      let start: Date;
      if (dateRange === "7") start = new Date(now.getTime() - 7 * 86400000);
      else if (dateRange === "30") start = new Date(now.getTime() - 30 * 86400000);
      else start = new Date(now.getTime() - 90 * 86400000);
      query = query.gte("created_at", start.toISOString());
    }

    const { data } = await query;
    if (data) setPurchases(data);
    setLoading(false);
  }, [currentRestaurant, dateRange]);

  useEffect(() => { fetchPurchases(); }, [fetchPurchases]);

  useEffect(() => {
    if (!currentRestaurant) return;
    Promise.all([
      supabase.from("inventory_catalog_items").select("id, item_name, vendor_sku, vendor_name, unit, pack_size, default_unit_cost")
        .eq("restaurant_id", currentRestaurant.id),
      supabase.from("locations").select("id, name").eq("restaurant_id", currentRestaurant.id).eq("is_active", true),
      supabase.from("smart_order_runs").select("id, created_at, inventory_list_id, inventory_lists(name)")
        .eq("restaurant_id", currentRestaurant.id).order("created_at", { ascending: false }).limit(10),
    ]).then(([catRes, locRes, soRes]) => {
      if (catRes.data) setCatalogItems(catRes.data);
      if (locRes.data) setLocations(locRes.data);
      if (soRes.data) setSmartOrders(soRes.data);
    });
  }, [currentRestaurant]);

  // Match invoice items against catalog
  const matchItems = useCallback((rawItems: any[]): InvoiceItem[] => {
    return rawItems.map(raw => {
      const item: InvoiceItem = {
        product_number: raw.product_number || null,
        item_name: raw.item_name || "",
        quantity: Number(raw.quantity) || 0,
        unit_cost: raw.unit_cost != null ? Number(raw.unit_cost) : null,
        line_total: raw.line_total != null ? Number(raw.line_total) : null,
        unit: raw.unit || null,
        pack_size: raw.pack_size || null,
        catalog_item_id: null,
        match_status: "UNMATCHED",
      };

      // Try matching by product number (vendor_sku)
      if (item.product_number) {
        const match = catalogItems.find(c =>
          c.vendor_sku && c.vendor_sku.toLowerCase() === item.product_number!.toLowerCase()
        );
        if (match) {
          item.catalog_item_id = match.id;
          item.match_status = "MATCHED";
          item.catalog_match_name = match.item_name;
          return item;
        }
      }

      // Fuzzy match by item name
      const normalizedName = item.item_name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const nameMatch = catalogItems.find(c => {
        const catName = c.item_name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return catName === normalizedName || catName.includes(normalizedName) || normalizedName.includes(catName);
      });
      if (nameMatch) {
        item.catalog_item_id = nameMatch.id;
        item.match_status = "MATCHED";
        item.catalog_match_name = nameMatch.item_name;
      }

      return item;
    });
  }, [catalogItems]);

  // Parse file
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isCSV = file.name.toLowerCase().endsWith(".csv") || file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls");
    const isPDF = file.name.toLowerCase().endsWith(".pdf");

    if (isCSV) {
      // Parse CSV/Excel locally
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      if (rows.length === 0) {
        toast.error("No data found in file");
        return;
      }

      // Map columns heuristically
      const headers = Object.keys(rows[0]).map(h => h.toLowerCase());
      const findCol = (keys: string[]) => {
        const original = Object.keys(rows[0]);
        for (const k of keys) {
          const idx = headers.findIndex(h => h.includes(k));
          if (idx >= 0) return original[idx];
        }
        return null;
      };

      const nameCol = findCol(["item", "description", "product name", "desc"]);
      const qtyCol = findCol(["qty", "quantity", "shipped", "ship"]);
      const priceCol = findCol(["price", "unit cost", "cost", "unit price"]);
      const totalCol = findCol(["total", "extended", "amount", "ext"]);
      const skuCol = findCol(["product number", "sku", "item number", "item #", "product #", "prod"]);
      const unitCol = findCol(["unit", "uom", "measure"]);
      const packCol = findCol(["pack", "size", "pack size"]);

      const parsed = rows.map(row => ({
        product_number: skuCol ? String(row[skuCol] || "") : null,
        item_name: nameCol ? String(row[nameCol] || "") : "",
        quantity: qtyCol ? Number(row[qtyCol]) || 0 : 0,
        unit_cost: priceCol ? Number(String(row[priceCol]).replace(/[$,]/g, "")) || null : null,
        line_total: totalCol ? Number(String(row[totalCol]).replace(/[$,]/g, "")) || null : null,
        unit: unitCol ? String(row[unitCol] || "") : null,
        pack_size: packCol ? String(row[packCol] || "") : null,
      })).filter(r => r.item_name);

      setItems(matchItems(parsed));
      toast.success(`Parsed ${parsed.length} items from file`);
    } else if (isPDF) {
      // Use AI to parse PDF text
      setParsing(true);
      try {
        const text = await file.text();
        const { data: result, error } = await supabase.functions.invoke("parse-invoice", {
          body: { content: text, file_type: "PDF" },
        });

        if (error) throw error;
        if (result.error) throw new Error(result.error);

        if (result.vendor_name) setHeader(h => ({ ...h, vendor_name: result.vendor_name }));
        if (result.invoice_number) setHeader(h => ({ ...h, invoice_number: result.invoice_number }));
        if (result.invoice_date) setHeader(h => ({ ...h, invoice_date: result.invoice_date }));

        if (result.items?.length) {
          setItems(matchItems(result.items));
          toast.success(`AI extracted ${result.items.length} items`);
        } else {
          toast.error("AI could not extract items from this PDF");
        }
      } catch (err: any) {
        toast.error(err.message || "Failed to parse PDF");
      }
      setParsing(false);
    } else {
      toast.error("Unsupported file type. Use PDF, CSV, or Excel.");
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Manual add item
  const addManualItem = () => {
    setItems(prev => [...prev, {
      product_number: null, item_name: "", quantity: 1, unit_cost: null,
      line_total: null, unit: null, pack_size: null,
      catalog_item_id: null, match_status: "MANUAL",
    }]);
  };

  const updateItem = (index: number, field: string, value: any) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const mapItemToCatalog = (index: number, catalogId: string) => {
    const cat = catalogItems.find(c => c.id === catalogId);
    if (!cat) return;
    setItems(prev => prev.map((item, i) =>
      i === index ? { ...item, catalog_item_id: catalogId, match_status: "MATCHED" as const, catalog_match_name: cat.item_name } : item
    ));
  };

  // Load linked smart order items for variance
  useEffect(() => {
    if (!header.linked_smart_order_id) { setLinkedSmartOrderItems([]); return; }
    supabase.from("smart_order_run_items").select("*").eq("run_id", header.linked_smart_order_id)
      .then(({ data }) => { if (data) setLinkedSmartOrderItems(data); });
  }, [header.linked_smart_order_id]);

  // Save invoice
  const handleSave = async () => {
    if (!currentRestaurant || !user) return;
    const unmatchedCount = items.filter(i => i.match_status === "UNMATCHED").length;
    if (unmatchedCount > 0) {
      toast.error(`${unmatchedCount} unmatched item(s). Please map all items before saving.`);
      return;
    }
    if (items.length === 0) {
      toast.error("No items to save");
      return;
    }
    if (!header.vendor_name.trim()) {
      toast.error("Vendor name is required");
      return;
    }

    setSaving(true);
    try {
      const { data: purchase, error: phError } = await supabase.from("purchase_history").insert({
        restaurant_id: currentRestaurant.id,
        vendor_name: header.vendor_name.trim(),
        invoice_number: header.invoice_number.trim() || null,
        invoice_date: header.invoice_date || null,
        location_id: header.location_id || null,
        smart_order_run_id: header.linked_smart_order_id || null,
        created_by: user.id,
        invoice_status: "COMPLETE",
      }).select().single();

      if (phError) throw phError;

      const phItems = items.map(i => ({
        purchase_history_id: purchase.id,
        item_name: i.item_name,
        quantity: i.quantity,
        unit_cost: i.unit_cost,
        total_cost: i.line_total ?? (i.unit_cost ? i.unit_cost * i.quantity : null),
        pack_size: i.pack_size,
        catalog_item_id: i.catalog_item_id,
        match_status: i.match_status,
      }));

      const { error: itemsError } = await supabase.from("purchase_history_items").insert(phItems);
      if (itemsError) throw itemsError;

      toast.success("Invoice saved successfully");
      setCreateOpen(false);
      resetCreateForm();
      fetchPurchases();
    } catch (err: any) {
      toast.error(err.message || "Failed to save invoice");
    }
    setSaving(false);
  };

  const resetCreateForm = () => {
    setHeader({ vendor_name: "", invoice_number: "", invoice_date: new Date().toISOString().split("T")[0], location_id: "", linked_smart_order_id: "" });
    setItems([]);
    setActiveTab("upload");
  };

  const handleViewPurchase = async (p: any) => {
    const { data } = await supabase.from("purchase_history_items").select("*").eq("purchase_history_id", p.id);
    setViewItems(data || []);
    setViewPurchase(p);
  };

  const handleDeletePurchase = async (id: string) => {
    await supabase.from("purchase_history_items").delete().eq("purchase_history_id", id);
    await supabase.from("purchase_history").delete().eq("id", id);
    toast.success("Invoice deleted");
    fetchPurchases();
  };

  // Compute expected on-hand for items (informational)
  const [lastSessionItems, setLastSessionItems] = useState<any[]>([]);
  useEffect(() => {
    if (!currentRestaurant) return;
    supabase.from("inventory_sessions").select("id").eq("restaurant_id", currentRestaurant.id)
      .eq("status", "APPROVED").order("approved_at", { ascending: false }).limit(1)
      .then(({ data: sessions }) => {
        if (sessions?.length) {
          supabase.from("inventory_session_items").select("item_name, current_stock")
            .eq("session_id", sessions[0].id).then(({ data }) => { if (data) setLastSessionItems(data); });
        }
      });
  }, [currentRestaurant]);

  const getExpectedOnHand = (itemName: string, qtyReceived: number) => {
    const sessionItem = lastSessionItems.find(s =>
      s.item_name.toLowerCase() === itemName.toLowerCase()
    );
    if (!sessionItem) return null;
    return Number(sessionItem.current_stock) + qtyReceived;
  };

  // Filter purchases
  const filteredPurchases = useMemo(() => {
    if (!searchFilter) return purchases;
    const lower = searchFilter.toLowerCase();
    return purchases.filter(p =>
      (p.vendor_name || "").toLowerCase().includes(lower) ||
      (p.invoice_number || "").toLowerCase().includes(lower)
    );
  }, [purchases, searchFilter]);

  // Stats
  const totalSpend = useMemo(() => {
    return purchases.reduce((sum, p) => sum, 0); // We'd need to fetch items for this
  }, [purchases]);

  const unmatchedCount = items.filter(i => i.match_status === "UNMATCHED").length;
  const matchedCount = items.filter(i => i.match_status === "MATCHED").length;
  const invoiceTotal = items.reduce((sum, i) => sum + (i.line_total ?? (i.unit_cost ? i.unit_cost * i.quantity : 0)), 0);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices (Receiving)</h1>
          <p className="page-description">Upload vendor invoices, match items, and track spend</p>
        </div>
        <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetCreateForm(); }}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-amber shadow-amber gap-2" size="sm">
              <Plus className="h-4 w-4" /> New Invoice
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Record Invoice
              </DialogTitle>
            </DialogHeader>

            {/* Header Fields */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Vendor Name *</Label>
                <Input value={header.vendor_name} onChange={e => setHeader(h => ({ ...h, vendor_name: e.target.value }))} placeholder="e.g. Sysco" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Invoice #</Label>
                <Input value={header.invoice_number} onChange={e => setHeader(h => ({ ...h, invoice_number: e.target.value }))} placeholder="INV-001" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Invoice Date</Label>
                <Input type="date" value={header.invoice_date} onChange={e => setHeader(h => ({ ...h, invoice_date: e.target.value }))} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Location</Label>
                <Select value={header.location_id || "none"} onValueChange={v => setHeader(h => ({ ...h, location_id: v === "none" ? "" : v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Optional Smart Order Link */}
            {smartOrders.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs font-medium flex items-center gap-1">
                  Link to Smart Order
                  <Tooltip><TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent>Link to compare estimated vs actual costs</TooltipContent></Tooltip>
                </Label>
                <Select value={header.linked_smart_order_id || "none"} onValueChange={v => setHeader(h => ({ ...h, linked_smart_order_id: v === "none" ? "" : v }))}>
                  <SelectTrigger className="h-9 text-sm w-full"><SelectValue placeholder="Optional — select to compare costs" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {smartOrders.map(so => (
                      <SelectItem key={so.id} value={so.id}>
                        {(so as any).inventory_lists?.name || "Smart Order"} — {new Date(so.created_at).toLocaleDateString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Upload / Manual Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full">
                <TabsTrigger value="upload" className="flex-1 gap-1.5 text-xs">
                  <Upload className="h-3.5 w-3.5" /> Upload File
                </TabsTrigger>
                <TabsTrigger value="manual" className="flex-1 gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Manual Entry
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="space-y-3">
                <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/40 transition-colors">
                  <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={handleFileUpload} className="hidden" id="invoice-upload" />
                  <label htmlFor="invoice-upload" className="cursor-pointer space-y-2">
                    {parsing ? (
                      <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin" />
                    ) : (
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground/40" />
                    )}
                    <p className="text-sm font-medium">{parsing ? "AI is parsing your invoice..." : "Drop or click to upload"}</p>
                    <p className="text-xs text-muted-foreground">PDF, CSV, or Excel files supported</p>
                  </label>
                </div>
              </TabsContent>

              <TabsContent value="manual">
                <Button variant="outline" size="sm" onClick={addManualItem} className="gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Add Item
                </Button>
              </TabsContent>
            </Tabs>

            {/* Items Table */}
            {items.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="text-xs gap-1">
                      <Package className="h-3 w-3" /> {items.length} items
                    </Badge>
                    {matchedCount > 0 && (
                      <Badge className="bg-success/10 text-success text-xs border-0 gap-1">
                        <Check className="h-3 w-3" /> {matchedCount} matched
                      </Badge>
                    )}
                    {unmatchedCount > 0 && (
                      <Badge className="bg-destructive/10 text-destructive text-xs border-0 gap-1">
                        <AlertTriangle className="h-3 w-3" /> {unmatchedCount} unmatched
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm font-semibold font-mono">
                    Total: ${formatNum(invoiceTotal)}
                  </div>
                </div>

                <div className="rounded-lg border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/20">
                        <TableHead className="text-[10px] font-semibold uppercase w-8">Status</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase">SKU</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase">Item Name</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase text-right">Qty</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase text-right">Unit Cost</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase text-right">Total</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase">Match</TableHead>
                        {lastSessionItems.length > 0 && (
                          <TableHead className="text-[10px] font-semibold uppercase text-right">
                            <Tooltip><TooltipTrigger className="flex items-center gap-1">Est. On-Hand <Info className="h-3 w-3" /></TooltipTrigger>
                              <TooltipContent>Expected on-hand after delivery (informational only)</TooltipContent></Tooltip>
                          </TableHead>
                        )}
                        {linkedSmartOrderItems.length > 0 && (
                          <TableHead className="text-[10px] font-semibold uppercase text-right">Variance</TableHead>
                        )}
                        <TableHead className="w-8" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item, idx) => {
                        const expectedOH = getExpectedOnHand(item.item_name, item.quantity);
                        const soItem = linkedSmartOrderItems.find(s =>
                          s.item_name.toLowerCase() === item.item_name.toLowerCase()
                        );
                        const costVariance = soItem && item.unit_cost != null && soItem.unit_cost != null
                          ? ((item.unit_cost - soItem.unit_cost) / soItem.unit_cost) * 100
                          : null;

                        return (
                          <TableRow key={idx} className={item.match_status === "UNMATCHED" ? "bg-destructive/5" : ""}>
                            <TableCell>
                              {item.match_status === "MATCHED" ? (
                                <Check className="h-4 w-4 text-success" />
                              ) : item.match_status === "MANUAL" ? (
                                <Badge variant="secondary" className="text-[9px]">M</Badge>
                              ) : (
                                <AlertTriangle className="h-4 w-4 text-destructive" />
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{item.product_number || "—"}</TableCell>
                            <TableCell>
                              {item.match_status === "MANUAL" ? (
                                <Input value={item.item_name} onChange={e => updateItem(idx, "item_name", e.target.value)}
                                  className="h-7 text-xs" placeholder="Item name" />
                              ) : (
                                <div>
                                  <span className="text-sm">{item.item_name}</span>
                                  {item.catalog_match_name && item.catalog_match_name !== item.item_name && (
                                    <span className="text-[10px] text-muted-foreground block">→ {item.catalog_match_name}</span>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.match_status === "MANUAL" ? (
                                <Input type="number" value={item.quantity || ""} onChange={e => updateItem(idx, "quantity", Number(e.target.value))}
                                  className="h-7 text-xs w-16 text-right" min={0} />
                              ) : (
                                <span className="font-mono text-sm">{formatNum(item.quantity)}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.match_status === "MANUAL" ? (
                                <Input type="number" value={item.unit_cost ?? ""} onChange={e => updateItem(idx, "unit_cost", e.target.value ? Number(e.target.value) : null)}
                                  className="h-7 text-xs w-20 text-right" min={0} step="0.01" />
                              ) : (
                                <span className="font-mono text-sm">{item.unit_cost != null ? `$${formatNum(item.unit_cost)}` : "—"}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              ${formatNum(item.line_total ?? (item.unit_cost ? item.unit_cost * item.quantity : 0))}
                            </TableCell>
                            <TableCell>
                              {item.match_status === "UNMATCHED" ? (
                                <Select onValueChange={v => mapItemToCatalog(idx, v)}>
                                  <SelectTrigger className="h-7 text-[10px] w-32"><SelectValue placeholder="Map to item..." /></SelectTrigger>
                                  <SelectContent>
                                    {catalogItems.map(c => (
                                      <SelectItem key={c.id} value={c.id} className="text-xs">{c.item_name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : item.match_status === "MANUAL" ? (
                                <Select value={item.catalog_item_id || "none"} onValueChange={v => mapItemToCatalog(idx, v === "none" ? "" : v)}>
                                  <SelectTrigger className="h-7 text-[10px] w-32"><SelectValue placeholder="Link item..." /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    {catalogItems.map(c => (
                                      <SelectItem key={c.id} value={c.id} className="text-xs">{c.item_name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span className="text-xs text-success">✓ {item.catalog_match_name}</span>
                              )}
                            </TableCell>
                            {lastSessionItems.length > 0 && (
                              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                {expectedOH != null ? formatNum(expectedOH) : "—"}
                              </TableCell>
                            )}
                            {linkedSmartOrderItems.length > 0 && (
                              <TableCell className="text-right">
                                {costVariance != null ? (
                                  <span className={`text-xs font-mono flex items-center justify-end gap-0.5 ${
                                    costVariance > 5 ? "text-destructive" : costVariance < -2 ? "text-success" : "text-muted-foreground"
                                  }`}>
                                    {costVariance > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                    {costVariance > 0 ? "+" : ""}{formatNum(costVariance)}%
                                  </span>
                                ) : "—"}
                              </TableCell>
                            )}
                            <TableCell>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeItem(idx)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Add more items button */}
                <Button variant="outline" size="sm" onClick={addManualItem} className="gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Add Item
                </Button>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setCreateOpen(false); resetCreateForm(); }}>Cancel</Button>
              <Button
                onClick={handleSave}
                disabled={saving || items.length === 0 || unmatchedCount > 0}
                className="bg-gradient-amber shadow-amber gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save Invoice ({items.length} items)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Date Range</Label>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-36 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="7">Last 7 Days</SelectItem>
                  <SelectItem value="30">Last 30 Days</SelectItem>
                  <SelectItem value="90">Last 90 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[180px]">
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={searchFilter} onChange={e => setSearchFilter(e.target.value)}
                  placeholder="Search by vendor or invoice #..." className="h-9 text-xs pl-8" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/8">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{filteredPurchases.length}</p>
              <p className="text-xs text-muted-foreground">Total Invoices</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/8">
              <Truck className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">{new Set(purchases.map(p => p.vendor_name).filter(Boolean)).size}</p>
              <p className="text-xs text-muted-foreground">Active Vendors</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/8">
              <Calendar className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {purchases.length > 0 ? new Date(purchases[0].created_at).toLocaleDateString() : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Last Invoice</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoice List */}
      {loading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading...</CardContent></Card>
      ) : filteredPurchases.length === 0 ? (
        <Card>
          <CardContent className="empty-state">
            <FileText className="empty-state-icon" />
            <p className="empty-state-title">No invoices yet</p>
            <p className="empty-state-description">Upload your first vendor invoice to start tracking spend and receiving.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredPurchases.map(p => (
            <Card key={p.id} className="hover:shadow-card transition-all duration-200">
              <CardContent className="flex items-center justify-between p-4">
                <div className="cursor-pointer flex-1" onClick={() => handleViewPurchase(p)}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/8">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{p.vendor_name || "Unknown Vendor"}</p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {p.invoice_number && <span className="font-mono">#{p.invoice_number}</span>}
                        <span>{new Date(p.created_at).toLocaleDateString()}</span>
                        {p.invoice_date && <span>· Invoice: {new Date(p.invoice_date).toLocaleDateString()}</span>}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">{(p as any).invoice_status || "COMPLETE"}</Badge>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleViewPurchase(p)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => handleDeletePurchase(p.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* View Invoice Dialog */}
      <Dialog open={!!viewPurchase} onOpenChange={() => { setViewPurchase(null); setViewItems([]); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {viewPurchase?.vendor_name || "Invoice"} {viewPurchase?.invoice_number ? `#${viewPurchase.invoice_number}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {viewPurchase?.invoice_date && <span>Invoice Date: {new Date(viewPurchase.invoice_date).toLocaleDateString()}</span>}
              <span>Recorded: {viewPurchase && new Date(viewPurchase.created_at).toLocaleDateString()}</span>
            </div>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20">
                    <TableHead className="text-[10px] font-semibold uppercase">Item</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase text-right">Qty</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase text-right">Unit Cost</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewItems.map(i => (
                    <TableRow key={i.id}>
                      <TableCell className="text-sm">{i.item_name}</TableCell>
                      <TableCell className="text-sm text-right font-mono">{formatNum(i.quantity)}</TableCell>
                      <TableCell className="text-sm text-right font-mono">{i.unit_cost != null ? `$${formatNum(i.unit_cost)}` : "—"}</TableCell>
                      <TableCell className="text-sm text-right font-mono font-semibold">${formatNum(i.total_cost || 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="text-right text-sm font-semibold font-mono">
              Total: ${formatNum(viewItems.reduce((s, i) => s + Number(i.total_cost || 0), 0))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
