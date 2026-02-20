
# Fix: Restaurant Dropdown Still Hidden + Sidebar Role Fallback

## What Happened

The approved plan had three fixes. Only **Fix 1** (RestaurantContext) was saved before the request was cancelled. The other two were never applied:

- `AppHeader.tsx` line 66 still reads `restaurants.length > 1` → dropdown hidden for single-restaurant users
- `AppSidebar.tsx` lines 70–74 still derive role only from `currentRestaurant?.role` with no fallback → Admin section disappears in portfolio mode

---

## Exact Changes Needed

### Fix A — `src/components/AppHeader.tsx` (line 66)

Change:
```tsx
{restaurants.length > 1 && (
```
To:
```tsx
{restaurants.length >= 1 && (
```

This makes the restaurant chip always visible, even for single-restaurant users. The dropdown still works — for a single restaurant it just shows that restaurant's name with a checkmark.

---

### Fix B — `src/components/AppSidebar.tsx` (lines 70–74)

Add `restaurants` to the destructured context and compute an effective role as a fallback:

Change:
```tsx
const { currentRestaurant } = useRestaurant();
// ...
const isOwner = currentRestaurant?.role === "OWNER";
const isManagerPlus = isOwner || currentRestaurant?.role === "MANAGER";
```

To:
```tsx
const { currentRestaurant, restaurants } = useRestaurant();
// ...
// Derive effective role — fall back to highest role across all restaurants
// when currentRestaurant is null (portfolio mode or stuck state)
const effectiveRole = currentRestaurant?.role
  ?? (restaurants.some(r => r.role === "OWNER") ? "OWNER"
    : restaurants.some(r => r.role === "MANAGER") ? "MANAGER"
    : "STAFF");

const isOwner = effectiveRole === "OWNER";
const isManagerPlus = isOwner || effectiveRole === "MANAGER";
```

This ensures the Admin section (Settings, Alert Settings, Reminders) remains visible even if the user is temporarily stuck in portfolio mode.

---

## Files Changed

| File | Line(s) | Change |
|------|---------|--------|
| `src/components/AppHeader.tsx` | 66 | `> 1` → `>= 1` |
| `src/components/AppSidebar.tsx` | 70–74 | Add role fallback from `restaurants` array |

---

## After These Fixes

- The restaurant name chip always shows in the header (even with 1 restaurant)
- Admin sidebar items (Settings, Alert Settings, Reminders, Staff) are always visible to OWNER/MANAGER users, regardless of portfolio mode state
- No database changes needed — purely frontend logic fixes
