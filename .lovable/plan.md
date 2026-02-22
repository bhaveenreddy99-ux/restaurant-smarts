
# Redesign Inventory Review Page

## Overview
Replace the current Dialog-based review with a full-page layout featuring sticky header, summary bar, filter tabs, category grouping, and independent table scrolling. Also audit all list pages (List Management, Purchase History, Smart Order, Invoices) for the same `SelectItem value=""` issue that was just fixed.

## Changes

### 1. Review Page Full Rewrite (`src/pages/app/inventory/Review.tsx`)

**Current problems:**
- Review detail is inside a Dialog (max-h-[90vh]), causing scroll/overflow issues
- No filter tabs (only "Exceptions only" toggle)
- No search
- No category grouping
- Row backgrounds used for risk instead of badge-only
- No sticky header/summary

**New layout (full-page, no dialog):**

```
[Sticky Header]
  Left: Session name, list name, location, date
  Right: Approve + Reject buttons (for OWNER/MANAGER)

[Sticky Summary Bar]
  4 cards: Critical (red count) | Low (yellow count) | OK (green count) | No PAR (gray count)

[Sticky Search + Filter Row]
  Search input | Filter tabs: All | Critical | Low | OK | No PAR

[Scrollable Table]
  Columns: Item | Pack Size | On Hand (right-align) | PAR (right-align) | Need (right-align, bold) | Risk (badge)
  - Grouped by category (collapsible accordion with item count)
  - Neutral row backgrounds (no colored rows)
  - Risk shown as compact badge only
  - min-h-[56px] per row for tablet touch targets

[Back button] to return to session list
```

**Technical approach:**
- Two views in one component: session list view and session detail view (toggled via state, no Dialog)
- Sticky elements via `sticky top-0 z-10 bg-background`
- Table body scrolls independently using flex layout with `overflow-y-auto` and `flex-1`
- Category grouping via collapsible sections using existing Collapsible component
- Filter tabs using existing Tabs component
- Numeric columns right-aligned with `text-right`
- Need column bold with `font-bold`
- Risk badge only (remove `risk.bgClass` from TableRow)

### 2. Audit All List Pages for Empty SelectItem Values

Check and fix any `<SelectItem value="">` patterns across:

- **SmartOrder.tsx** - Check date/list filter selects
- **ListManagement.tsx** - Check any select dropdowns
- **PurchaseHistory.tsx** - No selects found (safe)
- **Invoices.tsx** - Already fixed

From code review: SmartOrder.tsx uses `value="all"` for its "All" options, so it's already safe. ListManagement.tsx needs checking for any select items with empty values.

### 3. Files to Modify

| File | Change |
|------|--------|
| `src/pages/app/inventory/Review.tsx` | Full redesign: remove Dialog, add full-page layout with sticky header, summary, filters, category grouping, scrollable table |

### Technical Details

- **Sticky layout**: Use `flex flex-col h-full` on the outer container, with `overflow-y-auto` on the table section and `shrink-0` on header/summary/filters
- **Category grouping**: Group items by `item.category`, render as collapsible sections with Accordion or Collapsible
- **Filter logic**: Derive filtered items from `viewItems` based on active tab (All/Critical/Low/OK/No PAR) and search query
- **Need calculation**: `Math.max(0, PAR - OnHand)` using existing `computeOrderQty` 
- **Tablet optimization**: `min-h-[56px]` on rows, `text-base` for readability, adequate padding
- **Back navigation**: Simple state toggle between list view and detail view (no router change needed)
