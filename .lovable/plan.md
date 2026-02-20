
# Fix: Missing Sidebar Items & Restaurant Dropdown

## Root Cause Identified

The user has **one restaurant** (`schlotz1`, role: `OWNER`) but their saved UI state has `selected_restaurant_id: null`. This puts the app into **Portfolio mode** even though there is only one restaurant.

This single state cascades into two broken behaviors:

**Bug 1 — Restaurant dropdown not visible**
`AppHeader.tsx` line 66:
```tsx
{restaurants.length > 1 && (  // ← only shows if MORE than 1 restaurant
```
With 1 restaurant, the switcher never renders — the user has no way to exit portfolio mode.

**Bug 2 — Admin section (Settings, Staff, Alerts, Reminders) disappears**
`AppSidebar.tsx` lines 73–74:
```tsx
const isOwner = currentRestaurant?.role === "OWNER";         // null?.role → undefined → false
const isManagerPlus = isOwner || currentRestaurant?.role === "MANAGER"; // false
```
When `currentRestaurant` is `null` (portfolio mode), both flags are `false` → entire Admin section is hidden.

---

## Three Fixes to Apply

### Fix 1 — `RestaurantContext.tsx`: Auto-select when only 1 restaurant

When loading the persisted UI state, if `selected_restaurant_id` is `null` but there is only one restaurant, automatically select that restaurant instead of entering portfolio mode. Portfolio mode only makes sense when there are 2+ restaurants.

```tsx
if (uiState) {
  if (uiState.selected_restaurant_id === null && mapped.length > 1) {
    // Portfolio mode — only valid with multiple restaurants
    setCurrentRestaurantState(null);
  } else {
    const found = mapped.find(r => r.id === uiState.selected_restaurant_id);
    setCurrentRestaurantState(found || (mapped.length > 0 ? mapped[0] : null));
  }
}
```
This also clears the stale `null` state by auto-selecting and persisting the correct restaurant on next interaction.

---

### Fix 2 — `AppHeader.tsx`: Show restaurant name chip for single-restaurant users

Change `restaurants.length > 1` to `restaurants.length >= 1` so the restaurant switcher/chip is always visible. For single-restaurant users, display it as a non-interactive label (or a dropdown that shows the current restaurant name without other options). This gives the user visibility into which restaurant is active and allows escaping a stuck state.

```tsx
{restaurants.length >= 1 && (
  <DropdownMenu ...>
    // single restaurant: show name as non-interactive or show dropdown anyway
  </DropdownMenu>
)}
```

---

### Fix 3 — `AppSidebar.tsx`: Derive role from `restaurants` array as fallback

When `currentRestaurant` is `null` (portfolio mode), check the highest role across all restaurants:

```tsx
const effectiveRole = currentRestaurant?.role 
  ?? (restaurants.some(r => r.role === "OWNER") ? "OWNER"
    : restaurants.some(r => r.role === "MANAGER") ? "MANAGER"
    : "STAFF");

const isOwner = effectiveRole === "OWNER";
const isManagerPlus = isOwner || effectiveRole === "MANAGER";
```

This ensures that even if a user is stuck in portfolio mode, they still see the Admin section they are entitled to.

---

## Files to Change

| File | Change |
|------|--------|
| `src/contexts/RestaurantContext.tsx` | Auto-select single restaurant when persisted state is null |
| `src/components/AppHeader.tsx` | Show restaurant display for `length >= 1` (not `> 1`) |
| `src/components/AppSidebar.tsx` | Derive effective role from `restaurants` array as fallback when `currentRestaurant` is null |

---

## What the User Will See After Fix

- Dashboard loads → restaurant `schlotz1` is **auto-selected** (not portfolio mode)
- Restaurant name appears in the header
- Admin section (Settings, Alert Settings, Reminders, Staff) **visible** in sidebar
- The stale `null` UI state gets corrected automatically on next restaurant switch
