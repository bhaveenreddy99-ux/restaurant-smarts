
# Review & Approved Inventory — Column Display + PAR from Guide + Table Layout

## What the User Wants

1. **Review list (Review.tsx)**: Already shows column names (Item, Category, Pack Size, Stock, PAR, Risk, Suggested Order) — but PAR values shown are `approved_par` which is fetched from `par_guides`. Need to confirm this is correctly pulling the approved PAR guide data. The `handleView` function does fetch from `par_guides` → `par_guide_items` and enriches items with `approved_par`. This is correct. The visual issue is: when the dialog has no PAR guide linked (or `approved_par` is null), it shows "—". No changes needed to Review.tsx for PAR — it already fetches from the approved PAR guide.

2. **Approved list (Approved.tsx)**: 
   - Currently shows: Item, Category, Stock, PAR (from `item.par_level` in session items), Unit Cost — **missing Pack Size, Risk, Suggested Order**
   - PAR is reading from `item.par_level` (stored when session was created) — user wants it from the **approved PAR guide** (par_guides → par_guide_items), just like Review.tsx does
   - Layout is **cards** with a popup dialog — user wants a **table** (no popup, show everything inline)

3. **Approved list layout change**: Replace the card list + popup dialog with a single expandable table. Each session becomes a collapsible section: header row showing session name, list name, date — expanded rows showing items inline.

---

## Gap Analysis

### Approved.tsx — Current State

**Session list:** Cards with "View" button → opens dialog
```
sessions.map(s => <Card> ... <Button onClick={() => handleView(s)}>View</Button> </Card>)
```

**View dialog table columns:** Item | Category | Stock | PAR | Unit Cost

**PAR source:** `item.par_level` — this is stored in `inventory_session_items.par_level` at session creation time. It does NOT fetch from `par_guides`. If the PAR guide was updated after the session was created, the displayed PAR would be stale.

### What Needs to Change in Approved.tsx

1. **Fetch PAR guide data** in `handleView` (same as Review.tsx does) — enrich items with `approved_par` from the latest `par_guide_items` for that list
2. **Add columns**: Pack Size, Risk, Suggested Order (using `approved_par` for the calculation)
3. **Change layout from cards+dialog to inline table**: Each session shows as a collapsible section or accordion with its items listed beneath, so the user sees name + list + date + time, and items expand below without a modal popup

---

## Detailed Implementation Plan

### File 1: `src/pages/app/inventory/Approved.tsx`

#### Change 1 — Add state for expanded sessions and loaded items

Replace `viewItems` / `viewSession` dialog state with an expandable inline table:

```typescript
const [expandedSession, setExpandedSession] = useState<string | null>(null);
const [sessionItems, setSessionItems] = useState<Record<string, any[]>>({});
```

#### Change 2 — Fetch PAR data when expanding a session

Add a `getRisk` helper (same as in Review.tsx) and a `loadSessionItems` function that:
1. Fetches `inventory_session_items` for the session
2. Fetches `par_guides` for the list → gets `par_guide_items`
3. Enriches items with `approved_par`
4. Stores in `sessionItems[session.id]`

```typescript
const loadSessionItems = async (session: any) => {
  if (sessionItems[session.id]) {
    // Already loaded — just toggle
    setExpandedSession(prev => prev === session.id ? null : session.id);
    return;
  }
  
  const { data: items } = await supabase
    .from("inventory_session_items")
    .select("*")
    .eq("session_id", session.id);
  
  // Fetch PAR from guide
  const { data: guide } = await supabase
    .from("par_guides")
    .select("id")
    .eq("restaurant_id", currentRestaurant.id)
    .eq("inventory_list_id", session.inventory_list_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();
  
  const parMap: Record<string, number> = {};
  if (guide) {
    const { data: parItems } = await supabase
      .from("par_guide_items")
      .select("item_name, par_level")
      .eq("par_guide_id", guide.id);
    (parItems || []).forEach(p => { parMap[p.item_name] = Number(p.par_level); });
  }
  
  const enriched = (items || []).map(item => ({
    ...item,
    approved_par: parMap[item.item_name] ?? Number(item.par_level) ?? null,
  }));
  
  setSessionItems(prev => ({ ...prev, [session.id]: enriched }));
  setExpandedSession(session.id);
};
```

#### Change 3 — Replace cards+dialog with table layout

Remove the card grid and dialog entirely. Replace with a single bordered table where:
- Each **session** is a clickable header row (spanning all columns) showing: session name, list name, date/time, approved badge, item count, and an expand arrow
- When a session is **expanded**, its items appear as child rows directly below the header row

Layout:
```
┌─────────────────────────────────────────────────────────────────┐
│  Session Name        List Name     Feb 20, 2026  10:32 AM  ▼   │
├─────────────────────────────────────────────────────────────────┤
│  Item │ Category │ Pack Size │ Stock │ PAR │ Risk │ Suggested   │
│  ...  │ ...      │ ...       │ ...   │ ... │ ...  │ ...         │
├─────────────────────────────────────────────────────────────────┤
│  Session Name 2     List Name 2    Feb 19, 2026  2:15 PM   ►   │
└─────────────────────────────────────────────────────────────────┘
```

The ExportButtons stay but move to the session header row.

#### Change 4 — Add Risk column and Suggested Order column

Using the same `getRisk` helper from Review.tsx:
```typescript
function getRisk(currentStock: number, parLevel: number | null): RiskResult {
  if (!parLevel || parLevel <= 0) return { label: "No PAR", bgClass: "bg-muted/60", textClass: "text-muted-foreground" };
  const ratio = currentStock / parLevel;
  if (ratio >= 1.0) return { label: "Low", bgClass: "bg-success/10", textClass: "text-success" };
  if (ratio > 0.5) return { label: "Medium", bgClass: "bg-warning/10", textClass: "text-warning" };
  return { label: "High", bgClass: "bg-destructive/10", textClass: "text-destructive" };
}
```

Suggested Order = `Math.max(0, approved_par - current_stock)`

#### Column layout for item rows

| Column | Source |
|---|---|
| Item | `item.item_name` |
| Category | `item.category` |
| Pack Size | `item.pack_size` |
| Stock | `item.current_stock` |
| PAR | `item.approved_par` (from par_guide_items) |
| Risk | computed from stock/PAR |
| Suggested Order | `max(0, PAR - stock)` |
| Unit Cost | `item.unit_cost` |

#### Change 5 — Date + Time display

Show both date AND time for the approved_at timestamp:
```
{new Date(s.approved_at).toLocaleDateString()} at {new Date(s.approved_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
```

---

## Files Changed

| File | Change |
|---|---|
| `src/pages/app/inventory/Approved.tsx` | Complete redesign: remove cards+dialog, replace with expandable table; add PAR from guide fetch; add Pack Size, Risk, Suggested Order columns; show date + time |

No changes to `Review.tsx` — it already correctly fetches PAR from `par_guides` and shows all columns.
No changes to `SmartOrder.tsx` — Pack Size column already exists there (confirmed in the code).
No database migrations needed.

---

## What Review.tsx Already Has (No Changes)

- Column names: Item, Category, Pack Size, Stock, PAR, Risk, Suggested Order ✓
- PAR from `par_guide_items` via `handleView` fetching from `par_guides` ✓
- Editable Stock input ✓
- Risk color rows ✓

The only remaining issue in Review.tsx is that `localItems` state is reset incorrectly — the `setLocalItems({})` is called in `handleView` but only when there's no PAR data (the early return path skips it). This is a minor bug — adding `setLocalItems({})` before the early return in the PAR-found path will fix it. This will be included.
