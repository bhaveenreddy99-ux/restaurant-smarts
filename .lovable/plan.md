

# Fix "Start Inventory" Button Navigation

## Problem
The "Start Inventory" button on the dashboard navigates to `/app/inventory`, which is not a defined route. This causes a 404 error.

## Solution
Update all references to `/app/inventory` in the Dashboard to point to `/app/inventory/enter` instead, which is the inventory Command Center page where users start and manage counts.

## Technical Details

**File to change:** `src/pages/app/Dashboard.tsx`

Replace every occurrence of `"/app/inventory"` with `"/app/inventory/enter"` (approximately 4 instances):

1. The "Start Inventory" button in the command bar
2. The "Start Your First Count" empty-state button
3. The "Missing Weekly Inventory" action item link
4. The portfolio-mode "Start Inventory" button

This is a one-line-per-instance fix with no database or backend changes needed.
