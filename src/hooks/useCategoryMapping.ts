import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface MappedCategory {
  id: string;
  name: string;
  sort_order: number;
}

export interface ItemCategoryEntry {
  catalog_item_id: string;
  category_id: string | null;
  category_name: string;
  item_sort_order: number;
}

interface UseCategoryMappingResult {
  categories: MappedCategory[];
  itemCategoryMap: Record<string, ItemCategoryEntry>; // keyed by item_name
  hasMappings: boolean;
  loading: boolean;
}

/**
 * Fetches the saved category mapping for a given inventory list.
 * Returns mapped categories + a lookup from item_name → mapped category info.
 * Falls back gracefully (hasMappings=false) when no mapping exists.
 */
export function useCategoryMapping(listId: string | null | undefined, modeOverride?: string | null): UseCategoryMappingResult {
  const [categories, setCategories] = useState<MappedCategory[]>([]);
  const [itemCategoryMap, setItemCategoryMap] = useState<Record<string, ItemCategoryEntry>>({});
  const [hasMappings, setHasMappings] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!listId) {
      setCategories([]);
      setItemCategoryMap({});
      setHasMappings(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);

      // 1. Get the list's active_category_mode
      const { data: listData } = await supabase
        .from("inventory_lists")
        .select("active_category_mode")
        .eq("id", listId)
        .single();

      if (cancelled) return;

      const mode = modeOverride !== undefined ? modeOverride : listData?.active_category_mode;
      // Map mode to set_type
      const setType = mode === "my-categories" ? "user_manual"
        : mode === "custom-categories" ? "custom_ai"
        : null;

      if (!setType) {
        setCategories([]);
        setItemCategoryMap({});
        setHasMappings(false);
        setLoading(false);
        return;
      }

      // 2. Get the category set
      const { data: catSets } = await supabase
        .from("list_category_sets")
        .select("id")
        .eq("list_id", listId)
        .eq("set_type", setType);

      if (cancelled) return;

      const catSet = catSets?.[0];
      if (!catSet) {
        setCategories([]);
        setItemCategoryMap({});
        setHasMappings(false);
        setLoading(false);
        return;
      }

      // 3. Fetch categories and item mappings in parallel
      const [catRes, mapRes, catalogRes] = await Promise.all([
        supabase
          .from("list_categories")
          .select("id, name, sort_order")
          .eq("category_set_id", catSet.id)
          .order("sort_order"),
        supabase
          .from("list_item_category_map")
          .select("catalog_item_id, category_id, item_sort_order")
          .eq("category_set_id", catSet.id),
        supabase
          .from("inventory_catalog_items")
          .select("id, item_name")
          .eq("inventory_list_id", listId),
      ]);

      if (cancelled) return;

      const cats = (catRes.data || []) as MappedCategory[];
      const maps = mapRes.data || [];
      const catalogItems = catalogRes.data || [];

      // Build catalog_item_id → item_name lookup
      const catalogIdToName: Record<string, string> = {};
      catalogItems.forEach(ci => { catalogIdToName[ci.id] = ci.item_name; });

      // Build category_id → name lookup
      const catIdToName: Record<string, string> = {};
      cats.forEach(c => { catIdToName[c.id] = c.name; });

      // Build item_name → mapping
      const nameMap: Record<string, ItemCategoryEntry> = {};
      maps.forEach(m => {
        const itemName = catalogIdToName[m.catalog_item_id];
        if (itemName) {
          nameMap[itemName] = {
            catalog_item_id: m.catalog_item_id,
            category_id: m.category_id,
            category_name: m.category_id ? (catIdToName[m.category_id] || "Uncategorized") : "Uncategorized",
            item_sort_order: m.item_sort_order,
          };
        }
      });

      setCategories(cats);
      setItemCategoryMap(nameMap);
      setHasMappings(maps.length > 0);
      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [listId, modeOverride]);

  return { categories, itemCategoryMap, hasMappings, loading };
}
