

## Fix Brand Name Typo: "RestarentIQ" to "RestaurantIQ"

The brand name is misspelled as **"RestarentIQ"** (missing "u" and "a") in multiple files across the app. This plan fixes every occurrence while preserving the styled rendering (e.g., gradient spans).

---

### Files to Update

**Frontend Pages (6 files)**

| File | Current | Fixed |
|------|---------|-------|
| `src/pages/Login.tsx` | `Resta<span>rentIQ</span>` | `Restau<span>rantIQ</span>` |
| `src/pages/Signup.tsx` | `Resta<span>rentIQ</span>` | `Restau<span>rantIQ</span>` |
| `src/pages/ForgotPassword.tsx` | `Resta<span>rentIQ</span>` | `Restau<span>rantIQ</span>` |
| `src/pages/ResetPassword.tsx` | `Resta<span>rentIQ</span>` | `Restau<span>rantIQ</span>` |
| `src/pages/Demo.tsx` | `Resta<span>rentIQ</span>` | `Restau<span>rantIQ</span>` |
| `src/pages/onboarding/CreateRestaurant.tsx` | `RestarentIQ` | `RestaurantIQ` |

**Sidebar (1 file)**

| File | Current | Fixed |
|------|---------|-------|
| `src/components/AppSidebar.tsx` | `Resta<span>rentIQ</span>` | `Restau<span>rantIQ</span>` |

**Backend Functions (2 files)**

| File | Current | Fixed |
|------|---------|-------|
| `supabase/functions/send-email/index.ts` | `RestarentIQ <onboarding@resend.dev>` | `RestaurantIQ <onboarding@resend.dev>` |
| `supabase/functions/process-notifications/index.ts` | `RestarentIQ` (3 occurrences) | `RestaurantIQ` |

**Utilities (1 file)**

| File | Current | Fixed |
|------|---------|-------|
| `src/lib/export-utils.ts` | `RestarentIQ Export` | `RestaurantIQ Export` |

---

### Total: 10 files, ~12 string replacements

No logic changes. No database changes. Pure find-and-replace of the misspelled brand name.

