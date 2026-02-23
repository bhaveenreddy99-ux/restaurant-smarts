import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fetches the latest order date for each catalog item in the restaurant.
 * Returns a map: catalog_item_id -> latest purchase date ISO string.
 * Optionally scoped to a location.
 */
export function useLastOrderDates(restaurantId: string | undefined, locationId?: string | null) {
  const [dateMap, setDateMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!restaurantId) { setDateMap({}); return; }

    let cancelled = false;
    const fetch = async () => {
      setLoading(true);

      // Get purchase_history IDs filtered by restaurant + optional location + status
      let phQuery = supabase
        .from("purchase_history")
        .select("id, created_at, invoice_date")
        .eq("restaurant_id", restaurantId)
        .in("invoice_status", ["RECEIVED", "POSTED", "COMPLETE"]);

      if (locationId) {
        phQuery = phQuery.eq("location_id", locationId);
      }

      const { data: purchases } = await phQuery;
      if (!purchases || purchases.length === 0 || cancelled) {
        setDateMap({});
        setLoading(false);
        return;
      }

      const phIds = purchases.map(p => p.id);
      const phDateMap: Record<string, string> = {};
      purchases.forEach(p => {
        phDateMap[p.id] = p.invoice_date || p.created_at;
      });

      // Get all purchase_history_items with catalog_item_id
      const { data: items } = await supabase
        .from("purchase_history_items")
        .select("catalog_item_id, purchase_history_id")
        .in("purchase_history_id", phIds)
        .not("catalog_item_id", "is", null);

      if (!items || cancelled) {
        setDateMap({});
        setLoading(false);
        return;
      }

      // Build map: catalog_item_id -> max date
      const result: Record<string, string> = {};
      items.forEach(item => {
        if (!item.catalog_item_id) return;
        const date = phDateMap[item.purchase_history_id];
        if (!date) return;
        if (!result[item.catalog_item_id] || date > result[item.catalog_item_id]) {
          result[item.catalog_item_id] = date;
        }
      });

      if (!cancelled) {
        setDateMap(result);
        setLoading(false);
      }
    };

    fetch();
    return () => { cancelled = true; };
  }, [restaurantId, locationId]);

  return { lastOrderDates: dateMap, loading };
}
