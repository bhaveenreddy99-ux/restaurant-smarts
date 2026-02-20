
# Inventory Management — Input UX + Review/Approval Enhancements

## Summary of All Changes Requested

1. **Count entry input**: User can delete the `0` and start typing from a blank field (e.g. `0.1`, `0.5`, `10`)
2. **Session cards**: Show "total cases" (sum of counts) on **Review** and **Approved** cards too — currently only In Progress shows it, but the stat is "items count" not "sum"
3. **Review list**: Make counts editable in the Review dialog; show PAR, Pack Size, Risk, Suggested Order
4. **Approval list (View dialog for approved sessions)**: Show Pack Size column
5. **Smart Order**: Show Pack Size in the smart order view

---

## Gap Analysis Against Current Code

### 1. Count Input — zero value blocks user from typing decimal

**Current (line 952 — mobile card, line 1006 — desktop table):**
```
value={item.current_stock || ""}   // mobile
value={item.current_stock}          // desktop
```

The desktop table uses `value={item.current_stock}` — when stock is `0` the field shows `0`, user must triple-click to select it before typing. The spec says user should be able to delete `0` and type `0.1`.

**Fix:** Change both inputs to treat the value as a controlled string internally. Use `onFocus` to select all text so user can immediately overtype. Also change `onChange` to allow empty string intermediate state:
- `value={item.current_stock == null ? "" : String(item.current_stock)}`
- `onFocus={(e) => e.target.select()}` — this selects all on focus so any key immediately replaces the `0`
- `onChange` parses to float, allows empty string as null/0 locally
- `onBlur` saves the final value

This is the cleanest UX: user clicks or tabs into field → `0` is selected → starts typing `0.1` → `0` gets replaced.

### 2. Session card stat: "total cases" = sum of current_stock

**Current (line 179):**
```
statsMap[row.session_id].qty++;   // counts rows, not sum of stock
```
And label (line 1072):
```
const qtyLabel = stats ? `${stats.qty} items` : null;
```

**Fix:**
- Change aggregation to sum `current_stock`: `statsMap[row.session_id].qty += Number(row.current_stock ?? 0)`
- Change label to: `${stats.qty % 1 === 0 ? stats.qty : stats.qty.toFixed(1)} cases`
- This applies to **all 3 sections** automatically (the same `renderSessionCard` renders all)

### 3. Review dialog: make counts editable + show PAR + Pack Size + Risk + Suggested Order

**Current `Review.tsx` view dialog (lines 269-308):** read-only table with columns: Item, Category, Stock, PAR, Risk, Suggested Order. No Pack Size. Stock is not editable.

**Fix in `Review.tsx`:**
- Add **Pack Size** column header and cell
- Make **Stock** column an editable `<Input>` that saves `current_stock` to `inventory_session_items` on blur
- Add inline state `editedItems` that mirrors `viewItems` so edits are tracked locally and persisted
- PAR column already exists and is read-only ✓

**Fix in `EnterInventory.tsx` (Review card view dialog):** Same — the view dialog for IN_REVIEW sessions in `EnterInventory.tsx` currently shows read-only stock with no Pack Size. Apply same changes: add Pack Size column, make stock editable for IN_REVIEW sessions.

### 4. Approved view dialog: add Pack Size column

**Current approved view dialog (EnterInventory.tsx lines 1406-1456):**
Columns: Item, Category, Stock, PAR, Risk, Suggested Order — **no Pack Size**.

**Fix:** Add `pack_size` column between Category and Stock.

### 5. Smart Order view

The Smart Order page (`/app/smart-order`) is a separate file. Pack Size already exists in `smart_order_run_items.pack_size`. Need to check SmartOrder.tsx to confirm column is shown.

---

## Files to Modify

### `src/pages/app/inventory/EnterInventory.tsx`

**Change A — `fetchSessions` line 179:**
Sum stock instead of counting rows:
```
statsMap[row.session_id].qty += Number(row.current_stock ?? 0);
```

**Change B — `renderSessionCard` line 1072:**
```
const qtyLabel = stats && stats.qty > 0
  ? `${stats.qty % 1 === 0 ? stats.qty : stats.qty.toFixed(1)} cases`
  : null;
```

**Change C — Mobile card input (line 952):**
```
value={item.current_stock == null ? "" : item.current_stock === 0 ? "0" : String(item.current_stock)}
onFocus={(e) => e.target.select()}
onChange={(e) => {
  const val = e.target.value;
  handleUpdateStock(item.id, val === "" ? 0 : parseFloat(val) || 0);
}}
```

**Change D — Desktop table input (line 1006):**
Same treatment as mobile:
```
value={item.current_stock == null ? "" : String(item.current_stock)}
onFocus={(e) => e.target.select()}
```

**Change E — Approved view dialog (around line 1410):**
Add Pack Size column header after Category:
```
<TableHead className="text-xs font-semibold">Pack Size</TableHead>
```
And cell after Category cell:
```
<TableCell className="text-xs text-muted-foreground">{item.pack_size || "—"}</TableCell>
```

**Change F — Review view dialog (in EnterInventory.tsx, for IN_REVIEW sessions):**
The view dialog at lines 1406-1456 only shows full risk/PAR columns for APPROVED sessions. For IN_REVIEW, it just shows Item, Category, Stock. We need to:
- Show PAR (read-only) for IN_REVIEW sessions too
- Make stock editable for IN_REVIEW sessions
- Add Pack Size for both

### `src/pages/app/inventory/Review.tsx`

**Change G — Add `editedItems` state:**
```
const [editedItems, setEditedItems] = useState<Record<string, number>>({});
```

**Change H — `handleView` (already exists) — no change needed.**

**Change I — View dialog table:**
- Add Pack Size column
- Make Stock an editable Input for IN_REVIEW sessions
- Save on blur via `supabase.from("inventory_session_items").update({ current_stock: val }).eq("id", item.id)`
- PAR column already exists ✓
- Risk + Suggested Order already exist ✓

---

## SmartOrder.tsx — Quick Check Needed

Let me also check SmartOrder.tsx to confirm Pack Size visibility.

---

## Detailed Technical Approach for Editable Stock in Review

The Review dialog already loads `viewItems` from the DB. To make stock editable:

1. Add a `localItems` state that starts as a copy of `viewItems` when the dialog opens
2. On input change, update `localItems` in memory
3. On `onBlur`, call `supabase.from("inventory_session_items").update({ current_stock: newVal }).eq("id", item.id)`
4. Recompute risk and suggested order dynamically from `localItems`

This keeps the dialog "live" — manager can adjust a count, see risk color update immediately, then approve.

---

## Summary Table

| Change | File | Lines Affected |
|---|---|---|
| Sum stock instead of row count for "cases" stat | EnterInventory.tsx | 179, 1072 |
| Input select-all on focus (mobile + desktop) | EnterInventory.tsx | 952, 1006 |
| Add Pack Size to approved view dialog | EnterInventory.tsx | ~1409 |
| Make stock editable + add Pack Size in review view | EnterInventory.tsx | ~1406-1456 |
| Make stock editable + add Pack Size in Review.tsx dialog | Review.tsx | 269-308 |

No database changes. No new tables. No schema migrations.
