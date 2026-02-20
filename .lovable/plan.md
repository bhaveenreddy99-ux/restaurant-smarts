
# Inventory Management — Restaurant-Grade UI/UX Redesign

## Overview

This is a pure UI/UX polish pass. No database changes, no new routes, no schema migrations. All existing logic (autosave, session creation, PAR fetching, smart order, notifications) stays intact — we're rebuilding the presentation layer of three files:

1. `EnterInventory.tsx` — Landing + Count Entry editor
2. `Review.tsx` — Exception-first review screen
3. `Approved.tsx` — History table (already redesigned; minor polish only)

---

## What's Changing and Why

### Current Problems (from code audit)

- **Landing page**: 3 generic titled cards with flat row lists. No visual hierarchy, no progress bar, no "what should I do next" guidance.
- **Count entry (desktop)**: Shows 6 columns including Unit and Pack Size by default — cluttered. No "Need" column (PAR − Stock). No autosave status in header. Status badge is tucked away. No progress fraction shown.
- **Count entry (mobile)**: Already card-based — but labels say "Count" not "On Hand". No status summary.
- **Review.tsx**: List of sessions with View/Approve/Reject side by side. No exception summary cards. No default filter for red/yellow items. Approve button is same size as View.
- **Approved.tsx**: Already has the expandable table (previous work). Minor polish only needed.

---

## File 1: `src/pages/app/inventory/EnterInventory.tsx`

### A) Landing Page — "Command Center" (lines 1230–1514 render block)

**Section 1 — "Today" (In Progress)**

Replace the current generic card with a focused command card:

- **Header**: "Today's Count" title + List selector dropdown (existing)
- **If a session exists**: Show a single prominent session card with:
  - Large session name + list name + location
  - Progress bar: `counted / total` (where counted = items with `current_stock > 0`, total = items.length) — computed from `sessionStats` already fetched
  - Autosave note (static "autosaved" indicator)
  - **Primary CTA**: "Continue Count" button (full width, amber gradient)
  - **Secondary**: "Clear Entries" (outline) + trash icon (ghost, destructive hover)
  - Status badge: "In Progress" (amber)
- **If no session**: Single centered call-to-action with "Start Inventory" button
- **Multiple sessions**: Show first one prominently, others in compact rows below

Implementation: Add a `countedItems` tracker to `sessionStats` — when fetching session items stats, also count `items where current_stock IS NOT NULL AND current_stock > 0` and `total items count`. Change `statsMap` to include `counted` and `total` fields.

```typescript
// In fetchSessions, extend statsMap
statsMap[row.session_id].qty += Number(row.current_stock ?? 0);
if (row.current_stock != null && Number(row.current_stock) > 0) {
  statsMap[row.session_id].counted = (statsMap[row.session_id].counted || 0) + 1;
}
statsMap[row.session_id].total = (statsMap[row.session_id].total || 0) + 1;
```

**Section 2 — "Needs Review" (IN_REVIEW)**

- Only render this section if `isManagerOrOwner` is true
- If staff → section hidden entirely
- Each review session becomes a compact horizontal row:
  - Left: session name (bold) + list name + date (small muted)
  - Center: qty badge (e.g., "12.5 cases")
  - Right: `Review` button (primary), then a 3-dot `DropdownMenu` with Approve and Reject
- Section header: "Needs Review" + count badge showing number of pending sessions

**Section 3 — "History" (APPROVED)**

- Clean table layout (no cards)
- Filter dropdown: Last 7 / 30 / 90 days (add 7 days option — currently missing)
- Rows show: session name, list, date, qty
- 3-dot menu per row: View, Duplicate, Create Smart Order
- No inline approve/reject (these are done)

---

### B) Count Entry Screen — "Fast Entry Mode" (lines 764–1074 activeSession block)

**Sticky Header (top bar) redesign**

Current header has: back button, name, badge, category mode dropdown, search, filter toggle, category chips, desktop actions.

Redesign into 2 distinct sticky layers:

**Layer 1 — Identity bar** (always sticky):
```
[← Back]  [Session Name]        [In Progress]    [Saved ✓]  [Submit for Review →]
           Main Kitchen List
```
- Left: back arrow + session name (bold) + list name (small, muted)
- Center-right: status badge
- Right: autosave status ("Saving..." animate-pulse when savingId active, "Saved ✓" when savedId active, else invisible placeholder)
- Far right: "Submit for Review" button — always visible, amber gradient, disabled when items empty

**Layer 2 — Toolbar** (sticky below layer 1):
```
[🔍 Search ___________] [All][Cooler][Dry][Frozen]   [Uncounted ○] [↕ List Order ▾] [⊞]
```
- Search input (flex-1)
- Category chips (horizontal scroll, no-scrollbar)
- "Uncounted" toggle chip
- Sort/View dropdown (List Order / Custom AI / My Categories)
- View toggle: Table icon / Compact icon (toggles between desktop table and mobile card layout even on desktop)

**Desktop table columns** (NEW — reduced from 6 to 4 default):

| Column | Notes |
|---|---|
| Item | item_name bold + pack_size below in muted smaller text |
| On Hand | Large numeric input (existing logic) |
| PAR | Read-only (from approvedParMap) |
| Need | Computed: `max(0, PAR - On Hand)`, colored red if > 0 |
| Status | Risk badge: High/Medium/Low/No PAR |

Remove from default view: `Category`, `Unit`, `Pack Size` (pack_size moves under item name). These are still shown in mobile cards.

**Row visual priority**:
- High risk rows: subtle `bg-destructive/5` row background + red badge
- Medium: `bg-warning/5`
- Low/No PAR: default white/card background

**Input behavior improvements**:
- `onFocus` → `e.target.select()` (already done — keep)
- `step={0.1}` (currently 0.01 — change to 0.1 for cleaner increments, still allows typing 0.05 manually)
- Remove `max={100}` clamp in `handleUpdateStock` — restaurant items can exceed 100 cases
- `Enter` / `ArrowDown` advances to next row's On Hand input (existing `handleKeyDown` — keep)

**Mobile card layout improvements**:
- Label changes: "Count" → "On Hand"
- Add "Need" value next to PAR: show computed PAR − stock in amber if positive
- Autosave status shown inline on each card (existing savingId/savedId — keep)

**Bottom sticky bar (mobile)** — keep existing Clear + Submit layout.

**Progress indicator** in sticky header (desktop + mobile):
```
14 / 32 counted
```
Computed from: `items.filter(i => i.current_stock != null && Number(i.current_stock) > 0).length` / `items.length`

---

## File 2: `src/pages/app/inventory/Review.tsx`

### Exception-First Review UI

**Current state**: Simple list of session cards with View/Approve/Reject buttons. No summary.

**Redesign**:

**Top summary bar** (only shows when `viewItems` is open OR computed across all sessions):
When viewing a specific session (dialog open), replace the plain dialog header with:
- 4 metric cards: Red count, Yellow count, No PAR count, Total Suggested Order Value
- Default filter toggle: "Exceptions only" (pre-selected) vs "All items"
- Approve button: **top right, prominent**, amber or green gradient, always visible

**Session list** (outer Review page, not in dialog):
- Compact rows (same as the "Needs Review" section redesign above, since Review.tsx is the dedicated manager route)
- Each row: session name + list + date + qty badge
- Primary action: Review (opens dialog) — full style button
- Secondary actions in 3-dot menu: Approve directly, Reject

**Inside the view dialog**:
- Risk summary cards (already exists, keep)
- **NEW**: "Exceptions only" toggle chip — when ON, filter table to only show High + Medium risk rows
- **NEW**: Filter state `showOnlyExceptions` defaults to `true` when red/yellow items exist
- Approve button: Move from outside dialog to **inside dialog header**, right aligned, prominent green

**Columns in dialog table** (already good — keep):
Item | Category | Pack Size | Stock (editable) | PAR | Risk | Suggested Order

---

## File 3: `src/pages/app/inventory/Approved.tsx`

The expandable table design from the previous implementation is already solid. Minor polish:

- Add the "Last 7 days" option to the filter (currently `EnterInventory.tsx` has this filter, not `Approved.tsx` which shows all time)
- Add an empty-state illustration if sessions.length === 0 that says "No approved sessions yet — approved inventory counts will appear here"
- Session header rows: Show a subtle item count badge next to session name when expanded

---

## Detailed Component Breakdown

### New helper: `ProgressBar` (inline, not a separate file)

```tsx
const ProgressBar = ({ counted, total }: { counted: number; total: number }) => {
  const pct = total > 0 ? Math.round((counted / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
        <span>{counted} / {total} counted</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-amber transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
```

### Landing Page Session Card (Today section)

```
┌─────────────────────────────────────────────────────────────┐
│  Monday AM Count              [In Progress]                  │
│  Main Kitchen List                                           │
│                                                              │
│  ████████████░░░░░░  14 / 32 counted  44%                   │
│                                                              │
│  [Continue Count ─────────────]  [Clear]  [🗑]              │
└─────────────────────────────────────────────────────────────┘
```

### Needs Review Row

```
┌─────────────────────────────────────────────────────────────┐
│  Weekly Count – Bar         Jan 20   12.5 cases  [Review]  ⋮│
└─────────────────────────────────────────────────────────────┘
```

### Count Entry Desktop Table

```
┌───────────────────────────────────────────────────────┐
│ Item               │ On Hand │ PAR │ Need │  Status   │
├───────────────────────────────────────────────────────┤
│ Chicken Breast     │  [3.5_] │  8  │  4.5 │ [🔴 High] │  ← red row bg
│ 6/10lb Case        │         │     │      │           │
├───────────────────────────────────────────────────────┤
│ Romaine Lettuce    │  [2.0_] │  3  │  1.0 │ [🟡 Med]  │  ← yellow row bg
│ 24ct              │         │     │      │           │
├───────────────────────────────────────────────────────┤
│ Canola Oil         │  [5.0_] │  4  │   —  │ [🟢 Low]  │  ← default
│ 4/1gal            │         │     │      │           │
└───────────────────────────────────────────────────────┘
```

### Review Dialog Header (after redesign)

```
┌──────────────────────────────────────────────────────────────┐
│ Monday AM Count — Review         [Approve ✓] [X close]       │
│                                                               │
│ [🔴 3 High] [🟡 2 Medium] [⬜ 1 No PAR]  Total Need: 18 cases│
│                                                               │
│ [Exceptions only ✓]  [Show all]                              │
└──────────────────────────────────────────────────────────────┘
```

---

## State Changes Needed

### `EnterInventory.tsx`

**Add to state**:
```typescript
const [showExceptionsOnly, setShowExceptionsOnly] = useState(false);
const [viewToggle, setViewToggle] = useState<"table" | "compact">("table"); // allows forcing compact on desktop
```

**Extend `sessionStats`**:
```typescript
// Change type:
const [sessionStats, setSessionStats] = useState<Record<string, { qty: number; totalValue: number; counted: number; total: number }>>({});

// In fetchSessions statsMap loop:
statsMap[row.session_id].total = (statsMap[row.session_id].total || 0) + 1;
if (row.current_stock !== null && Number(row.current_stock) > 0) {
  statsMap[row.session_id].counted = (statsMap[row.session_id].counted || 0) + 1;
}
```

**Remove clamp in `handleUpdateStock`**:
```typescript
// Current (line 318):
const clamped = Math.min(100, Math.max(0, stock));
// Change to:
const clamped = Math.max(0, stock); // no max cap
```

### `Review.tsx`

**Add to state**:
```typescript
const [showExceptionsOnly, setShowExceptionsOnly] = useState(true);
```

**Filtered items in dialog**:
```typescript
const displayedItems = showExceptionsOnly && viewItems
  ? viewItems.filter(item => {
      const risk = getRisk(Number(item.current_stock ?? 0), item.approved_par);
      return risk.label === "High" || risk.label === "Medium";
    })
  : viewItems;
// fallback: if no exceptions, show all
const effectiveItems = (showExceptionsOnly && displayedItems?.length === 0) ? viewItems : displayedItems;
```

---

## Summary of All Changes

| File | Section | Change Type |
|---|---|---|
| `EnterInventory.tsx` | `fetchSessions` | Extend stats to include `counted` + `total` |
| `EnterInventory.tsx` | `handleUpdateStock` | Remove `max(100)` clamp |
| `EnterInventory.tsx` | Landing render (lines 1230–1314) | Full redesign: Today card with progress bar, Needs Review (manager only) compact rows, History table with 3-dot menus |
| `EnterInventory.tsx` | Editor sticky header (lines 769–904) | Redesign into 2-layer sticky: identity bar + toolbar |
| `EnterInventory.tsx` | Desktop table (lines 981–1029) | Reduce to 4 columns (Item+packsize, On Hand, PAR, Need, Status), add row color tinting |
| `EnterInventory.tsx` | Mobile cards (lines 916–978) | Update labels "Count"→"On Hand", add Need display |
| `EnterInventory.tsx` | Add state | `viewToggle` + extend `sessionStats` type |
| `Review.tsx` | Session list (lines 207–253) | Compact rows with 3-dot menu for Approve/Reject |
| `Review.tsx` | View dialog (lines 255–343) | Add exceptions toggle, move Approve button into dialog header, add total suggested order metric card |
| `Review.tsx` | Add state | `showExceptionsOnly` defaulting to `true` |
| `Approved.tsx` | Empty state | Polish empty state message |

**No database changes. No new files. No route changes. All existing logic preserved.**
