import { useCallback, useMemo, useRef, useState } from "react";
import { InvoiceItem, InvoiceHeader } from "./types";

export function useInvoiceMatching(catalogItems: any[]) {
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

  return { matchItems };
}
