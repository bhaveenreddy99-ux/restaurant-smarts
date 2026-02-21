

# Redesign List Management Page

## Overview
A UI-only redesign of `src/pages/app/ListManagement.tsx` to create a clean, structured, modern SaaS inventory builder. No business logic changes -- only visual/layout updates.

## Changes (Single File: `src/pages/app/ListManagement.tsx`)

### 1. New State: Collapsible Categories
- Add `collapsedCategories` state (`Set<string>`) and a `toggleCategoryCollapse` helper
- Add `Settings` icon import from lucide-react

### 2. Detail View Header (lines 1214-1276)
- Add a large rounded avatar block showing the list's first letter (orange gradient)
- Larger list name (`text-2xl font-bold`)
- Subtitle: "147 items -- Updated Feb 20, 2026" with better date formatting
- Right side: `[ Import ]` `[ Export ]` `[ Manage List (gear icon) ]` buttons with increased spacing (`gap-2.5`, `h-9`)
- Replace `MoreVertical` icon on Manage List button with `Settings` icon

### 3. Controls Bar (lines 1290-1360)
- Larger search input (`min-w-[240px] max-w-md`, `h-10`, `pl-10`)
- Category/view mode dropdown and Add Item button pushed to the right with `ml-auto`
- Orange Add Item button with larger sizing (`h-10 px-5`)
- Wider spacing between controls (`gap-4`)

### 4. Category Blocks (lines 1433-1542)
- Category header: darker gray background (`bg-muted/40`), bold uppercase text, item count badge, collapse toggle (`ChevronDown` that rotates)
- Clickable header toggles collapse
- Collapsed categories hide their item table
- Empty category: centered "No items in this category" with subtle `[ + Add Item ]` button
- Rounded borders on category blocks (`rounded-t-lg` header, `rounded-b-lg` table)

### 5. Item Table Restructure (lines 1443-1538)
- New column order: Checkbox (conditional) | Drag Handle (always visible, subtle) | Item Name | Unit | Pack Size | Product # | Unit Cost (right-aligned) | Actions
- Remove Sr# column
- Item name: `text-sm font-medium text-foreground` (slightly larger, primary)
- Product #: `font-mono text-muted-foreground/60` (muted gray)
- Unit Cost: `text-right tabular-nums font-mono`
- Softer row separators (`border-border/40`)
- Row uses `group/row` class for hover targeting

### 6. Row Hover Actions (lines 1518-1527)
- Actions hidden by default (`opacity-0`)
- Shown on hover (`group-hover/row:opacity-100`)
- Three icons: Edit, Duplicate, Delete (currently missing Duplicate action on rows -- will add)
- Drag handle also subtler by default, brighter on hover

### 7. Empty State (when category has no items)
- Clean centered message: "No items in this category" with `[ + Add Item ]` below
- Also improved global empty state with icon + message + CTA

### 8. List Cards Grid View (lines 1828-1901)
- Cards: `rounded-xl`, `shadow-sm`, `hover:shadow-md`
- Each card shows: avatar block with initial letter, list name, item count badge, last updated date, "Open" button at bottom
- Create card: rounded, dashed border, circle icon
- Purchase History card: icon in colored container, improved spacing
- Grid gap increased to `gap-5`
- Page spacing increased to `space-y-8`
- Search input enlarged to `h-10`

### 9. Issues Tab (lines 1547-1586)
- Replace Card wrapper with plain `border rounded-lg` for consistency
- Cleaner empty state with larger icon

## Technical Details
- All changes are CSS/className and minor JSX restructuring
- No database, API, or business logic changes
- No new dependencies needed
- File stays as single component (~1950 lines)
- `Settings` icon added to lucide imports
- `Copy` icon reused for duplicate action on item rows

