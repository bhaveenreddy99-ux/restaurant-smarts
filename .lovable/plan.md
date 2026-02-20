
# Full Audit: Login → PAR Management — Issues Found & Fixes

## Issues Identified

After tracing the full flow from login page → AuthContext → RestaurantContext → ProtectedRoute → AppLayout → PARManagement, here are the confirmed issues:

---

### Issue 1 — ACTIVE BUG (Console Error): `Skeleton` getting a `ref` in PARManagement

**Severity:** Warning (renders but produces React errors in console)

**Root cause:** In `PARManagement.tsx` lines 208–216, the loading skeleton uses:
```tsx
{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
```
The `Skeleton` component in `src/components/ui/skeleton.tsx` is a plain function component (`function Skeleton(...)`) — it does **not** use `React.forwardRef`. However, it spreads `...props` onto a `<div>`, which is fine. The actual error says: "Check the render method of PARManagementPage... at Skeleton."

The problem is that somewhere in the render tree, a `ref` is being passed to `<Skeleton>` without forwardRef. The `skeleton.tsx` component needs to be wrapped in `React.forwardRef` to accept refs properly.

**Fix:** Wrap the `Skeleton` component with `React.forwardRef`.

---

### Issue 2 — LOGIC BUG: `AuthContext` calls `getSession` AND `onAuthStateChange` in sequence — potential double state update

**Severity:** Minor but causes unnecessary double re-renders on load

**Root cause:** In `AuthContext.tsx`, both `onAuthStateChange` AND `getSession` are called. If `getSession` resolves first, it sets session + loading=false. Then `onAuthStateChange` fires and sets it again. The listener should be set up first (which it is), but `setLoading(false)` is called twice — once from the listener and once from `getSession`. This can cause a flicker on the loading screen.

**Fix:** Only rely on `onAuthStateChange` for both the initial session and subsequent changes. Remove the redundant `getSession` call, or ensure loading is only set false once.

---

### Issue 3 — UX BUG: `ProtectedRoute` redirects to `/demo` if restaurants array is empty — but this happens briefly during loading

**Severity:** Low but can cause brief flash/redirect for real users

**Root cause:** The `ProtectedRoute` checks `if (restaurants.length === 0) return <Navigate to="/demo" replace />`. If `restLoading` is false but `restaurants` hasn't been populated yet (e.g., due to a race condition during fetch), the user gets incorrectly redirected to `/demo` before their data loads.

The memory note confirms: "a synchronous loading state reset (implemented via useRef tracking the previous user ID)" was added. This mitigates but doesn't fully eliminate the race. The `refetch` from RestaurantContext doesn't reset `loading` back to true before fetching, so there's a brief window where `loading=false` and `restaurants=[]`.

**Fix:** Add a guard in `RestaurantContext.fetchRestaurants` that resets `loading = true` at the start of the fetch call, and ensures the `ProtectedRoute` check for empty restaurants only runs after `uiStateLoaded.current === true`.

---

### Issue 4 — FEATURE GAP: PAR Management — No empty state when user has no inventory lists

**Severity:** Medium — confusing for new users

**Root cause:** When `lists.length === 0` and loading is done, the page shows just the header + an empty Select dropdown with no explanation. There's no empty state UI.

**Fix:** Add an empty state card when `!loading && lists.length === 0`.

---

### Issue 5 — UX BUG: Admin sidebar items (Alert Settings, Reminders) visible to non-managers when in portfolio mode

**Severity:** Low

**Root cause:** In `AppSidebar.tsx`:
```tsx
{isManagerPlus && renderGroup("Admin", isOwner ? adminNav : adminNav.filter(n => n.url === "/app/settings"))}
```
`isManagerPlus` is derived from `currentRestaurant?.role`. When `currentRestaurant` is `null` (portfolio mode), both `isOwner` and `isManagerPlus` are `false`, so the Admin group is hidden. However, **STAFF** users who only have one restaurant still see the sidebar without the admin group being restricted properly — the `currentRestaurant?.role` could be `STAFF` and the filter still shows `/app/settings`. Staff should not see the Settings link at all.

**Fix:** The `adminNav` filter should only show Settings to managers, not all members. Also hide Alert Settings and Reminders from staff.

---

### Issue 6 — POTENTIAL BUG: `PARManagement` doesn't reset `items` or `guides` when `currentRestaurant` changes

**Severity:** Medium — stale data visible briefly when switching restaurants

**Root cause:** The PAR page's `useEffect` on `currentRestaurant` resets `loading=true` and fetches lists, but `items`, `guides`, `selectedGuide`, and `selectedList` states are not cleared. When a user switches restaurants from the header switcher, the previous restaurant's guides/items briefly show before the new data loads.

**Fix:** Reset all derived state when `currentRestaurant` changes.

---

## What Will Be Fixed

| # | Issue | File |
|---|---|---|
| 1 | `Skeleton` needs `React.forwardRef` | `src/components/ui/skeleton.tsx` |
| 2 | Double loading state in AuthContext | `src/contexts/AuthContext.tsx` |
| 3 | ProtectedRoute race condition guard | `src/contexts/RestaurantContext.tsx` |
| 4 | Empty state for PAR with no lists | `src/pages/app/PARManagement.tsx` |
| 5 | Admin nav visible to STAFF | `src/components/AppSidebar.tsx` |
| 6 | Stale data on restaurant switch in PAR | `src/pages/app/PARManagement.tsx` |

---

## Technical Details

### Fix 1 — `skeleton.tsx`

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />
  )
);
Skeleton.displayName = "Skeleton";

export { Skeleton };
```

### Fix 2 — `AuthContext.tsx`

Remove the `getSession` call that races with `onAuthStateChange`. The auth state change listener fires immediately with the current session, so `getSession` is redundant:

```tsx
useEffect(() => {
  // onAuthStateChange fires with INITIAL_SESSION event immediately,
  // carrying the current session — no need for a separate getSession call
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (_event, session) => {
      setSession(session);
      setLoading(false);
    }
  );
  return () => subscription.unsubscribe();
}, []);
```

### Fix 3 — `RestaurantContext.tsx`

Ensure `fetchRestaurants` always sets `loading = true` at the top before async work, so ProtectedRoute waits properly:

```tsx
const fetchRestaurants = async () => {
  setLoading(true);  // ← ADD THIS at the top
  if (!user) { ... setLoading(false); return; }
  // rest of fetch ...
};
```

### Fix 4 — `PARManagement.tsx` — Empty state for no lists

After the loading check, add:
```tsx
if (!loading && lists.length === 0) {
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">PAR Management</h1>
        ...
      </div>
      <Card>
        <CardContent className="empty-state py-16">
          <BookOpen className="empty-state-icon" />
          <p className="empty-state-title">No inventory lists yet</p>
          <p className="empty-state-description">Create an inventory list first before setting PAR levels.</p>
          <Button onClick={() => navigate("/app/inventory/lists")} ...>
            Go to List Management
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

### Fix 5 — `AppSidebar.tsx` — Admin nav for staff

Currently staff see a partial admin nav (just Settings). Fix:
```tsx
// Only show Admin section to manager+
{isManagerPlus && renderGroup("Admin", isOwner 
  ? adminNav 
  : adminNav.filter(n => n.url === "/app/settings" || n.url === "/app/staff")
)}
// STAFF sees nothing in Admin → hide the whole group if not isManagerPlus
```

Actually the fix is simpler: `isManagerPlus` being false already hides the Admin section for STAFF, but the current code shows `/app/settings` even for managers who aren't owners. Alert Settings and Reminders should be MANAGER+ not owner-only. Fix the filter:

```tsx
{isManagerPlus && renderGroup("Admin", adminNav.filter(n => {
  if (n.url === "/app/staff") return isOwner;
  return true; // Settings, Alert Settings, Reminders visible to all managers
}))}
```

### Fix 6 — `PARManagement.tsx` — Reset stale state on restaurant change

In the first `useEffect` that watches `currentRestaurant`:

```tsx
useEffect(() => {
  if (!currentRestaurant) return;
  // Reset all derived state first
  setSelectedList("");
  setSelectedGuide(null);
  setGuides([]);
  setItems([]);
  setFilterCategory("all");
  setSearch("");
  setLoading(true);
  supabase.from("inventory_lists").select("*")
    .eq("restaurant_id", currentRestaurant.id)
    .then(({ data }) => { if (data) setLists(data); setLoading(false); });
}, [currentRestaurant]);
```
