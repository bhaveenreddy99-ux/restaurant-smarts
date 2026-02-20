
# Use Uploaded RestaurantIQ Logo as Static App Logo

## What the user wants
1. Remove the "Restaurant Logo" upload UI from Settings → Business Profile
2. Use the uploaded `image-2.png` (the RestaurantIQ circuit-tree logo) as a **static, hardcoded** app logo shown in:
   - Sidebar top-left (replacing the ChefHat icon + dynamic logo fetch)
   - Header profile avatar area (replacing the dynamic logo/initial)
   - Browser tab favicon (URL search bar)

## What changes

### 1. Copy the uploaded image into the project
- Copy `user-uploads://image-2.png` → `public/logo.png` (for favicon)
- Copy `user-uploads://image-2.png` → `src/assets/logo.png` (for React components)

### 2. Update `index.html` — Favicon
Change the favicon link to point to the new logo:
```html
<link rel="icon" type="image/png" href="/logo.png" />
```

### 3. Update `src/components/AppSidebar.tsx`
- Remove the `useEffect` that fetches `logo_url` from `restaurant_settings` and the `logoUrl` state
- Remove the `ChefHat` import (no longer needed)
- Replace the icon block with a static `<img src={logo} />` using the imported asset
- Keep the "RestaurantIQ" text beside it

Before:
```tsx
const [logoUrl, setLogoUrl] = useState<string | null>(null);
useEffect(() => { ...supabase fetch... }, [currentRestaurant?.id]);
// ...
{logoUrl ? <img src={logoUrl} /> : <ChefHat />}
```

After:
```tsx
import logo from "@/assets/logo.png";
// ...
<img src={logo} alt="RestaurantIQ" className="h-full w-full object-contain" />
```

### 4. Update `src/components/AppHeader.tsx`
- Remove the `useEffect` that fetches `logo_url` and the `logoUrl` state
- Replace the avatar/profile area with the static logo image

Before:
```tsx
const [logoUrl, setLogoUrl] = useState<string | null>(null);
useEffect(() => { ...supabase fetch... }, [currentRestaurant?.id]);
// ...
{logoUrl ? <img src={logoUrl} /> : <span>{initial}</span>}
```

After:
```tsx
import logo from "@/assets/logo.png";
// ...
<img src={logo} alt="RestaurantIQ" className="h-full w-full object-contain" />
```

### 5. Update `src/pages/app/Settings.tsx` — Remove logo upload UI
- Remove the `logoUrl`, `logoUploading` state variables from `GeneralSection`
- Remove `handleLogoUpload` and `handleRemoveLogo` functions
- Remove the "Restaurant Logo" section (lines ~185–210) from the rendered JSX
- Remove Supabase storage calls related to logo upload
- Keep all other Business Profile fields (name, email, phone, address, currency, timezone, date format) intact

## Files changed
| File | Change |
|------|--------|
| `public/logo.png` | New — copied from user upload (used for favicon) |
| `src/assets/logo.png` | New — copied from user upload (used in React components) |
| `index.html` | Update favicon href to `/logo.png` |
| `src/components/AppSidebar.tsx` | Remove dynamic logo fetch, use static import |
| `src/components/AppHeader.tsx` | Remove dynamic logo fetch, use static import |
| `src/pages/app/Settings.tsx` | Remove logo upload section from Business Profile |

## No functionality removed
All other Settings sections (locations, inventory, PAR, smart order, users, danger zone, etc.) remain completely untouched.
