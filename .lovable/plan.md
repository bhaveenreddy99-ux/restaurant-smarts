

## Sync Saved Category Grouping to PAR Management and Inventory

### What will change
After you save a list with "My Categories" (or "Custom Categories"), the same category grouping and item order will automatically appear in **PAR Management** and **Enter Inventory** when you view that list. Right now those pages group items by the raw `category` text field on each item -- this update will make them read from the list's saved category mappings instead.

### How it will work
1. When you select a list in PAR Management or Enter Inventory, the system checks that list's `active_category_mode` setting
2. It loads the matching category set (Custom AI or My Categories) and the item-to-category mappings
3. Items are grouped by those mapped categories and displayed in the saved sort order
4. If no category mapping exists yet (e.g. older lists), it falls back to the existing `category` text field so nothing breaks

### Technical details

#### 1. Shared helper hook: `useCategoryMapping`
Create a new hook at `src/hooks/useCategoryMapping.ts` that:
- Accepts `listId` and `restaurantId`
- Reads the list's `active_category_mode` from `inventory_lists`
- Fetches the matching `list_category_sets` row (by `set_type`)
- Fetches `list_categories` for that set (names + sort order)
- Fetches `list_item_category_map` entries for that set
- Returns `{ categories, itemCategoryMap, loading }` so consuming pages can group items

#### 2. Update PAR Management (`src/pages/app/PARManagement.tsx`)
- Import and call `useCategoryMapping(selectedList, restaurantId)`
- Replace the current grouping logic (lines 158-163) which uses `item.category` with a lookup into the category map:
  - For each `par_guide_item`, find its matching `catalog_item_id` via `item_name`, then look up the mapped category
  - Sort items within each category by `item_sort_order` from the mapping
  - Sort category sections by `sort_order` from `list_categories`
- Update the category filter chips to use mapped category names instead of raw `item.category`
- Fall back to `item.category` when no mapping exists

#### 3. Update Enter Inventory (`src/pages/app/inventory/EnterInventory.tsx`)
- Import and call `useCategoryMapping(selectedList, restaurantId)` when a session is open
- Replace the current grouping logic (lines 408-413) which uses `item.category` with the same mapping-based approach:
  - Match `inventory_session_items` to catalog items by `item_name`, look up their mapped category
  - Sort items within each category by `item_sort_order`
  - Sort category sections by `sort_order`
- Update category filter chips accordingly
- Fall back to `item.category` when no mapping exists

#### 4. No database changes needed
All required tables (`list_category_sets`, `list_categories`, `list_item_category_map`, `inventory_lists.active_category_mode`) already exist from the previous migration.

