

## Standardize Item Identity Across All Pages

### Goal
Every table in the app should follow the same pattern:
- **Brand name** displayed as a sub-line under Item Name (using `ItemIdentityBlock`)
- **Product #**, **Pack Size**, and **Last Ordered** shown as dedicated table columns

### Current State (Audit Results)

| Page | Brand sub-line | Product # col | Pack Size col | Last Ordered col |
|------|---------------|---------------|---------------|-----------------|
| List Management | Done | Done | Done | **Missing** |
| Enter Inventory | Done | Done | Done | Done |
| Review | Done | **Missing** | Done | **Missing** |
| PAR Management | Done (inline, not ItemIdentityBlock) | **Missing** | Done | **Missing** |
| Smart Order | Brand mixed with Pack Size in sub-line | **Missing** | Done | **Missing** |
| Purchase History | Brand as separate column (OK for receipts) | N/A | Done | N/A |
| Invoices | Handled by InvoiceItemsTable | Done | Done | N/A |

### Changes Required

**1. List Management** (`src/pages/app/ListManagement.tsx`)
- Add a **Last Ordered** column after Product # column
- Use the existing `lastOrderDates[item.id]` lookup (already imported)

**2. Review Page** (`src/pages/app/inventory/Review.tsx`)
- Add **Product #** column (read from `item.vendor_sku`)
- Add **Last Ordered** column (resolve via catalog lookup map, same pattern as EnterInventory)
- Build a `catalogLookup` map from catalog items to resolve `lastOrderDates` by item name

**3. PAR Management** (`src/pages/app/PARManagement.tsx`)
- Replace inline brand display with `ItemIdentityBlock` component
- Add **Product #** column (from `par_guide_items.brand_name` -- need to check if product_number is available; if not, resolve via catalog lookup)
- Add **Last Ordered** column (resolve via catalog lookup)
- Import `ItemIdentityBlock` and `useLastOrderDates`

**4. Smart Order** (`src/pages/app/SmartOrder.tsx`)
- Change sub-line to show **only brand name** (remove pack_size from sub-line since it already has its own column)
- Use `ItemIdentityBlock` instead of inline span
- Add **Product #** column
- Add **Last Ordered** column
- Import `ItemIdentityBlock` and `useLastOrderDates`
- Build catalog lookup to resolve product numbers and last order dates

### Technical Details

**Catalog Lookup Pattern** (reused across pages):
The `useLastOrderDates` hook returns a map of `catalog_item_id -> date`. Pages that show `inventory_session_items` or `par_guide_items` (which lack `catalog_item_id`) need a lookup map built from `catalogItems` state: `item_name -> catalog_item`. This pattern is already implemented in EnterInventory and will be replicated to Review, PAR Management, and Smart Order.

**Data availability per table:**
- `par_guide_items`: has `brand_name` but no `product_number` -- will resolve via catalog lookup
- `smart_order_run_items`: has `brand_name` and `pack_size` but no `product_number` -- will resolve via catalog lookup
- `inventory_session_items`: has `brand_name` and `vendor_sku` (product number) -- direct access

**Files to modify (4 files):**
1. `src/pages/app/ListManagement.tsx` -- add Last Ordered column
2. `src/pages/app/inventory/Review.tsx` -- add Product # and Last Ordered columns
3. `src/pages/app/PARManagement.tsx` -- use ItemIdentityBlock, add Product # and Last Ordered columns
4. `src/pages/app/SmartOrder.tsx` -- use ItemIdentityBlock (brand only), add Product # and Last Ordered columns

