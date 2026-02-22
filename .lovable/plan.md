

# Fix Dashboard to Demo-Ready State

## Overview
Replace all hardcoded/placeholder metrics with real data, add proper labels for unavailable features, and fix filtering logic across all widgets.

## Changes

### 1. Inventory Value KPI (lines 795-802)
- Rename label to "Inventory Value ($)"
- Compute `SUM(current_stock * COALESCE(unit_cost, 0))` from the same latest approved session items already fetched
- Show count of items with null `unit_cost` as sublabel (e.g., "2 items missing costs")
- Remove hardcoded `change={3}` -- no trend % until real trend is implemented

### 2. Inventory Value Trend (lines 327-353)
- Replace hardcoded bar chart with real data
- Query last 8 APPROVED sessions for current restaurant + optional location_id, ordered by `approved_at DESC`
- For each session: `SUM(current_stock * COALESCE(unit_cost, 0))` from `inventory_session_items`
- Render bars proportionally; label each with short date (e.g., "Jan 5")
- If fewer than 2 sessions, show "Not enough data yet" message

### 3. SpendOverview (lines 357-445)
- Add `location_id` filter: pass `currentLocation?.id` as prop, apply `.eq("location_id", id)` when set
- Week spend = `created_at >= 7 days ago`; Month spend = `created_at >= 1st of current month` (already correct)
- No draft filter needed since `purchase_history` currently has no draft status in practice (all records are COMPLETE by default)

### 4. High Usage (lines 730-743)
- Apply location filter via `usage_events.restaurant_id` (no location_id column exists on usage_events, so location filtering is not possible -- leave as-is with a note)
- If empty, widget already shows "No usage data yet" (line 300-304) -- confirmed OK
- Time filter: not wiring yet since usage_events lacks a reliable date-range column for the selected time filter; leave as all-time for now

### 5. Placeholder Widgets -- Label as "Coming Soon"
- **AI Insights** (lines 448-474): Add "Coming Soon" badge, keep sample text but gray out / add opacity, add explanatory subtitle
- **Waste Exposure KPI** (line 810-816): Change value to "Coming Soon" instead of "$--", remove accent styling confusion  
- **Action Center** (lines 828-834): Keep `missingInventory: 0` and `parChanges: 0` -- these correctly hide when 0, so no action items show for unimplemented features. This is fine.

### 6. Smart Order Preview
- Already shows top items from latest session (not from `smart_order_runs`). This is the dashboard preview, which is acceptable.
- No changes needed here -- the actual Smart Order page handles run management.

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/app/Dashboard.tsx` | All changes listed above |

## Technical Details

**Inventory Value calculation** (added to existing `fetchData`):
```
const invValue = items.reduce((sum, i) => sum + i.current_stock * (i.unit_cost || 0), 0);
const missingCosts = items.filter(i => !i.unit_cost).length;
```

**Inventory Value Trend** (new query in `fetchData`):
```
// Fetch last 8 approved sessions
const { data: trendSessions } = await supabase
  .from("inventory_sessions")
  .select("id, approved_at")
  .eq("restaurant_id", rid)
  .eq("status", "APPROVED")
  .order("approved_at", { ascending: false })
  .limit(8);

// For each session, fetch items and compute SUM
for (const s of trendSessions) {
  const { data: sItems } = await supabase
    .from("inventory_session_items")
    .select("current_stock, unit_cost")
    .eq("session_id", s.id);
  s.value = sItems.reduce((sum, i) => sum + i.current_stock * (i.unit_cost || 0), 0);
}
// Reverse to chronological order for chart
```

**SpendOverview location filter**: Add optional `locationId` prop, apply `.eq("location_id", locationId)` to `purchase_history` query when provided.

**AI Insights**: Replace current component body with a "Coming Soon" state that shows the existing sample insights grayed out with a clear "Coming Soon" overlay/badge, so the widget shape is visible but not misleading.

**Waste Exposure**: Show "Coming Soon" as the value text, with sublabel "Overstock analysis". Remove any trend percentage.

