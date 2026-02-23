/**
 * Computed usage analytics from approved inventory sessions + invoices.
 * Formula: usage = beginning_stock + purchases_between - ending_stock
 */
import { supabase } from "@/integrations/supabase/client";

export interface ComputedUsageItem {
  item_name: string;
  beginning_stock: number;
  ending_stock: number;
  purchases_between: number;
  usage_raw: number;
  weekly_usage: number;
  days_between: number;
}

export interface PARRecommendation {
  item_name: string;
  current_par: number;
  suggested_par: number;
  change_pct: number;
  reason: string;
  type: "increase" | "decrease" | "usage_trend";
}

/**
 * Compute usage from the last 2 approved sessions + purchase data in between.
 */
export async function computeUsageAnalytics(
  restaurantId: string,
  locationId?: string | null,
): Promise<ComputedUsageItem[]> {
  // Get last 2 approved sessions
  let sessionsQuery = supabase
    .from("inventory_sessions")
    .select("id, approved_at, location_id")
    .eq("restaurant_id", restaurantId)
    .eq("status", "APPROVED")
    .not("approved_at", "is", null)
    .order("approved_at", { ascending: false })
    .limit(2);

  if (locationId) {
    sessionsQuery = sessionsQuery.eq("location_id", locationId);
  }

  const { data: sessions } = await sessionsQuery;
  if (!sessions || sessions.length < 2) return [];

  const latest = sessions[0];
  const previous = sessions[1];

  // Get items for both sessions
  const [{ data: latestItems }, { data: prevItems }] = await Promise.all([
    supabase.from("inventory_session_items").select("item_name, current_stock").eq("session_id", latest.id),
    supabase.from("inventory_session_items").select("item_name, current_stock").eq("session_id", previous.id),
  ]);

  if (!latestItems || !prevItems) return [];

  // Get purchases between the two sessions
  let phQuery = supabase
    .from("purchase_history")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .in("invoice_status", ["RECEIVED", "POSTED", "COMPLETE"])
    .gte("created_at", previous.approved_at!)
    .lte("created_at", latest.approved_at!);

  if (locationId) {
    phQuery = phQuery.eq("location_id", locationId);
  }

  const { data: purchases } = await phQuery;
  const purchaseIds = (purchases || []).map(p => p.id);

  let purchaseMap: Record<string, number> = {};
  if (purchaseIds.length > 0) {
    const { data: phItems } = await supabase
      .from("purchase_history_items")
      .select("item_name, quantity")
      .in("purchase_history_id", purchaseIds);

    if (phItems) {
      for (const pi of phItems) {
        const key = pi.item_name.trim().toLowerCase();
        purchaseMap[key] = (purchaseMap[key] || 0) + Number(pi.quantity);
      }
    }
  }

  // Build ending stock map
  const endingMap: Record<string, number> = {};
  for (const item of latestItems) {
    endingMap[item.item_name.trim().toLowerCase()] = Number(item.current_stock);
  }

  // Calculate days between
  const daysBetween = Math.max(
    1,
    (new Date(latest.approved_at!).getTime() - new Date(previous.approved_at!).getTime()) / 86400000,
  );

  // Compute usage for each item in previous session
  const results: ComputedUsageItem[] = [];
  for (const item of prevItems) {
    const key = item.item_name.trim().toLowerCase();
    const beginning = Number(item.current_stock);
    const ending = endingMap[key] ?? 0;
    const purchased = purchaseMap[key] || 0;
    const usageRaw = beginning + purchased - ending;
    const weeklyUsage = (usageRaw / daysBetween) * 7;

    results.push({
      item_name: item.item_name,
      beginning_stock: beginning,
      ending_stock: ending,
      purchases_between: purchased,
      usage_raw: usageRaw,
      weekly_usage: Math.max(0, weeklyUsage),
      days_between: Math.round(daysBetween),
    });
  }

  return results.sort((a, b) => b.weekly_usage - a.weekly_usage);
}

/**
 * Generate rules-based PAR recommendations from consecutive approved sessions.
 */
export async function computePARRecommendations(
  restaurantId: string,
  locationId?: string | null,
): Promise<PARRecommendation[]> {
  // Get last 4 approved sessions
  let sessionsQuery = supabase
    .from("inventory_sessions")
    .select("id, approved_at")
    .eq("restaurant_id", restaurantId)
    .eq("status", "APPROVED")
    .not("approved_at", "is", null)
    .order("approved_at", { ascending: false })
    .limit(4);

  if (locationId) {
    sessionsQuery = sessionsQuery.eq("location_id", locationId);
  }

  const { data: sessions } = await sessionsQuery;
  if (!sessions || sessions.length < 3) return [];

  // Load items for all sessions
  const sessionIds = sessions.map(s => s.id);
  const { data: allItems } = await supabase
    .from("inventory_session_items")
    .select("session_id, item_name, current_stock, par_level, unit_cost")
    .in("session_id", sessionIds);

  if (!allItems) return [];

  // Order sessions chronologically
  const orderedIds = [...sessionIds].reverse();
  const sessionIndexMap = Object.fromEntries(orderedIds.map((id, i) => [id, i]));

  // Group by item
  const itemData: Record<string, { stocks: (number | null)[]; pars: number[]; unit_cost: number }> = {};
  for (const si of allItems) {
    const key = si.item_name.trim().toLowerCase();
    if (!itemData[key]) {
      itemData[key] = { stocks: new Array(orderedIds.length).fill(null), pars: [], unit_cost: Number(si.unit_cost ?? 0) };
    }
    const idx = sessionIndexMap[si.session_id];
    if (idx !== undefined) {
      itemData[key].stocks[idx] = Number(si.current_stock);
      itemData[key].pars.push(Number(si.par_level));
    }
  }

  // Get purchases between sessions for usage computation
  const usage = await computeUsageAnalytics(restaurantId, locationId);
  const usageMap: Record<string, number> = {};
  for (const u of usage) {
    usageMap[u.item_name.trim().toLowerCase()] = u.weekly_usage;
  }

  const recommendations: PARRecommendation[] = [];

  for (const [key, data] of Object.entries(itemData)) {
    const validStocks = data.stocks.filter((s): s is number => s !== null);
    if (validStocks.length < 3) continue;

    const currentPar = Math.max(...data.pars, 0);
    if (currentPar <= 0) continue;

    const displayName = allItems.find(i => i.item_name.trim().toLowerCase() === key)?.item_name || key;

    // Rule 1: RED in 3 consecutive sessions → increase PAR 10-20%
    const isRedConsecutive = validStocks.slice(-3).every(s => s < currentPar * 0.5);
    if (isRedConsecutive) {
      const increase = Math.round(currentPar * 0.15);
      recommendations.push({
        item_name: displayName,
        current_par: currentPar,
        suggested_par: currentPar + increase,
        change_pct: Math.round((increase / currentPar) * 100),
        reason: `Stock critically low (<50% PAR) for 3 consecutive counts. Consider increasing PAR.`,
        type: "increase",
      });
      continue;
    }

    // Rule 2: Overstock in 3 consecutive sessions → decrease PAR 10-20%
    const isOverstockConsecutive = validStocks.slice(-3).every(s => s > currentPar * 1.3);
    if (isOverstockConsecutive) {
      const decrease = Math.round(currentPar * 0.15);
      recommendations.push({
        item_name: displayName,
        current_par: currentPar,
        suggested_par: currentPar - decrease,
        change_pct: -Math.round((decrease / currentPar) * 100),
        reason: `Stock consistently above PAR (>130%) for 3 consecutive counts. Consider decreasing PAR.`,
        type: "decrease",
      });
      continue;
    }

    // Rule 3: Usage trend increasing >20% between periods
    const weeklyUsage = usageMap[key];
    if (weeklyUsage && weeklyUsage > currentPar * 0.8) {
      recommendations.push({
        item_name: displayName,
        current_par: currentPar,
        suggested_par: Math.ceil(weeklyUsage * 1.2),
        change_pct: Math.round(((Math.ceil(weeklyUsage * 1.2) - currentPar) / currentPar) * 100),
        reason: `Weekly usage (${weeklyUsage.toFixed(1)}) approaching PAR level. Consider buffer increase.`,
        type: "usage_trend",
      });
    }
  }

  return recommendations.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
}
