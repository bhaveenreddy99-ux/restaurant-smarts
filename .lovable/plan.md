
# Inventory Management Enhancement Plan

## What Already Exists (No Changes Needed)

The codebase already has these features from previous sessions:
- 3-section dashboard (In Progress / Review / Approved) in `EnterInventory.tsx`
- Category mode dropdown (List Order / Custom Categories / My Categories)
- `useCategoryMapping` hook reading saved category sets from `list_category_sets`, `list_categories`, `list_item_category_map`
- Decimal input fields with `step=0.01`, min=0, max=100
- Arrow key + Enter keyboard navigation
- PAR read-only display from `par_guides` + `par_guide_items`
- Risk colors (Red/Yellow/Green) in the View dialog for approved sessions
- Suggested order column in the View dialog

## What Needs to Be Fixed or Added

After thorough code review, here are the specific gaps:

### Gap 1 — Landing Page: Item Count + Total Value on Cards

**Current state:** Session cards show only the session name, list name, and date.

**Fix:** When loading sessions, also fetch the count of `inventory_session_items` per session and sum `current_stock * unit_cost` for a total value. Display these two numbers on each card.

Implementation: Modify `fetchSessions()` to join/aggregate item counts. Use a `select("*, inventory_session_items(count)")` or a secondary `.from("inventory_session_items").select("session_id, current_stock, unit_cost")` query keyed by `session_id`, then enrich the sessions array before rendering.

### Gap 2 — Clear Entries: Sets to NULL Not 0

**Current state:** `handleClearEntries` updates `current_stock = 0`. The user spec requires `current_stock = NULL` so blank means "not yet counted."

**Fix:** Change the update payload to `{ current_stock: null }`. Also update local state to set `current_stock: null` (not 0). The Input component should handle null gracefully (empty string display).

### Gap 3 — Category Mode: Sync the active_category_mode from the list

**Current state:** The dropdown in the count entry view defaults to `"list_order"` on every session open, ignoring `inventory_lists.active_category_mode`.

**Fix:** When `openEditor(session)` is called, fetch the list's `active_category_mode` and set `categoryMode` accordingly:
- DB value `"list_order"` → component state `"list_order"`
- DB value `"ai"` or `"custom-categories"` → component state `"custom-categories"`
- DB value `"user"` or `"my-categories"` → component state `"my-categories"`

Also: the `useCategoryMapping` hook maps `"my-categories"` → `set_type = "user_manual"` and `"custom-categories"` → `set_type = "custom_ai"`. That mapping is correct. No hook changes needed.

### Gap 4 — Session Creation: Store Active PAR into par_level

**Current state:** `handleCreateSession` already populates `par_level` from the selected PAR guide if the user picks one in the "Start Inventory Session" dialog. However if no PAR guide is chosen, items get `par_level = 0`.

**Fix:** In `handleCreateSession`, if no explicit `selectedPar` is chosen, auto-detect the latest `par_guide` for that list and use its items' `par_level` values. This ensures `inventory_session_items.par_level` is always populated from the approved PAR before the session begins.

### Gap 5 — Auto-create Smart Order Run on Approval

**Current state:** The manager must manually click "Create Smart Order" after approval. The user spec says to create `smart_order_runs` + `smart_order_run_items` automatically when a session is approved.

**Fix:** Enhance `handleApprove(sessionId)` in `EnterInventory.tsx` (and in `Review.tsx`) to:
1. Fetch all `inventory_session_items` for the session
2. Fetch PAR data for the list (latest PAR guide)
3. Compute risk + suggested order per item
4. Insert a `smart_order_runs` record (linked to session)
5. Insert `smart_order_run_items` for each item

This makes Smart Order available immediately after approval, without a separate user action.

### Gap 6 — Notifications on Approval

**Current state:** Approval does nothing with `notifications` or `notification_preferences`.

**Fix:** After the auto-smart-order is created on approval, read the `notification_preferences` for the restaurant. If any RED items exist, insert a notification record into `notifications` for each Owner/Manager (based on `recipients_mode`):
- Query `restaurant_members` for `role IN ('OWNER', 'MANAGER')`
- If `recipients_mode = "OWNERS_MANAGERS"` → notify all owners + managers
- If `recipients_mode = "ALL"` → notify all members
- If `recipients_mode = "CUSTOM"` → notify users in `alert_recipients`
- Insert a `notifications` row per target user with `type = "LOW_STOCK"`, `severity = "WARN"` or `"ERROR"` based on red count, `title` and `message` with item counts

---

## Files to Modify

### `src/pages/app/inventory/EnterInventory.tsx`

This is the primary file. Changes:

1. **`fetchSessions`**: Fetch item counts and total values per session. Add a helper `fetchSessionStats()` that returns `Map<session_id, { qty: number; totalValue: number }>`.

2. **`renderSessionCard`**: Display `qty` (item count) and `totalValue` on each card for all three section types.

3. **`handleClearEntries`**: Change `current_stock: 0` to `current_stock: null`.

4. **`openEditor`**: After loading session items, also fetch the list's `active_category_mode` and call `setCategoryMode()` with the mapped value.

5. **`handleApprove`**: After updating status to APPROVED, auto-create the smart order run + items, then fire notifications.

### `src/pages/app/inventory/Review.tsx`

6. **`handleApprove`**: Apply the same auto-smart-order + notification logic as in `EnterInventory.tsx` so the Review page approval is also consistent.

---

## Technical Implementation Notes

### Fetching Session Stats (qty + total value)

```
// After loading sessions array:
const sessionIds = sessions.map(s => s.id);
const { data: statsRaw } = await supabase
  .from("inventory_session_items")
  .select("session_id, current_stock, unit_cost")
  .in("session_id", sessionIds);

// Build map
const statsMap = {}; 
statsRaw?.forEach(row => {
  if (!statsMap[row.session_id]) statsMap[row.session_id] = { qty: 0, totalValue: 0 };
  statsMap[row.session_id].qty++;
  if (row.current_stock != null && row.unit_cost != null) {
    statsMap[row.session_id].totalValue += row.current_stock * row.unit_cost;
  }
});
```

### Auto Smart Order on Approval

```
// In handleApprove(sessionId):
// 1. Fetch session to get inventory_list_id
// 2. Fetch session items
// 3. Fetch latest par_guide for the list → par_guide_items
// 4. Compute risk per item
// 5. Insert smart_order_runs → get run.id
// 6. Insert smart_order_run_items
// 7. If run succeeded → fire notifications
```

### Notification Insert Logic

```
// Get notification_preferences for restaurant (channel_in_app: true cases)
// Get restaurant_members
// For each eligible user, insert into notifications:
{
  restaurant_id,
  user_id,
  type: "LOW_STOCK",
  severity: redCount > 0 ? "ERROR" : "WARN",
  title: "Inventory Approved - X items need attention",
  message: `${redCount} high risk, ${yellowCount} medium risk items`,
  data: { session_id, run_id, red: redCount, yellow: yellowCount }
}
```

---

## Summary of Changes

| Area | File | Change Type |
|---|---|---|
| Landing cards: qty + value | EnterInventory.tsx | Enhance fetchSessions + renderSessionCard |
| Clear sets NULL not 0 | EnterInventory.tsx | Fix handleClearEntries |
| Category mode syncs from list | EnterInventory.tsx | Fix openEditor |
| Auto smart order on approve | EnterInventory.tsx + Review.tsx | New logic in handleApprove |
| Notifications on approve | EnterInventory.tsx + Review.tsx | New logic after approval |

No database migrations required. No new tables. No changes to `useCategoryMapping.ts`. No changes to `Review.tsx` schema — only its `handleApprove` logic.
