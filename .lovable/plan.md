
# Inventory Schedule — Settings Integration + Auto-Session Creation

## What This Builds

A fully automated inventory scheduling system that:
1. Lives in **Settings → Inventory Schedule** (OWNER/MANAGER only)
2. Shows a **"Next Scheduled Count" panel** on the Inventory Management landing page
3. **Auto-creates sessions** via the `process-notifications` Edge Function
4. Sends **lead-time + overdue notifications** using the existing `notifications` table

---

## Database Migration (4 columns on `reminders`)

The `reminders` table currently has: `id`, `restaurant_id`, `location_id`, `created_by`, `name`, `days_of_week`, `time_of_day`, `timezone`, `is_enabled`, `created_at`, `updated_at`, `recipients_mode`.

The migration adds:

```sql
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS inventory_list_id uuid REFERENCES public.inventory_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_create_session boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_lead_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS lock_after_hours integer;
```

No new tables. No RLS changes needed — existing `reminders` policies cover MANAGER+ for write, all members for read.

---

## Architecture Overview

```text
Settings → Inventory Schedule page
  │
  ├── Reads/writes: reminders (extended with 4 new cols)
  │                 reminder_targets (custom user assignment)
  │                 inventory_lists, locations (for dropdowns)
  │
EnterInventory.tsx
  │
  ├── Reads: reminders WHERE inventory_list_id IS NOT NULL
  ├── Computes: next occurrence (client-side, same computeNextOccurrence helper)
  └── Shows: "Next Scheduled Count" panel with countdown + status + action

process-notifications Edge Function (extended)
  │
  ├── Section 2 (existing reminders loop) — EXTENDED:
  │     At lead_time before session: fire SCHEDULE_REMINDER notification
  │     At session time:
  │       if auto_create_session: create inventory_session (IN_PROGRESS)
  │       fire SCHEDULE_READY notification to recipients
  │
  └── Section 4 (NEW — overdue check):
        For schedules with lock_after_hours set,
        find sessions that are still IN_PROGRESS past lock window,
        send SCHEDULE_OVERDUE notification to managers
```

---

## Files to Create / Modify

### New File: `src/pages/app/settings/InventorySchedule.tsx`

A self-contained component (default export + named export `InventoryScheduleSection`) that mirrors the pattern of `ReminderSettings.tsx`.

**Card list layout** — each schedule shows as a professional card:
```
┌─────────────────────────────────────────────────────────────────┐
│  Weekly Count – Main Kitchen                    [Active] badge  │
│  Main Kitchen List · Main Location                              │
│  Mon  Wed  Fri   ·   9:00 PM EST                               │
│  Auto-session ON · Remind 1 hr before                           │
│                             [Edit] [Pause/Resume] [Delete]      │
└─────────────────────────────────────────────────────────────────┘
```

**Create/Edit Dialog fields:**
- Schedule Name (text input)
- Inventory List (Select from `inventory_lists`)
- Location (Select from `locations`, optional)
- Recurrence type: `Weekly` / `Twice Weekly` / `Monthly`
  - Weekly → badge toggles for 1 day (only 1 can be selected)
  - Twice Weekly → badge toggles, up to 2 days
  - Monthly → number input 1–31 (stored as `days_of_week: ["DAY_1", "DAY_15"]` convention — we use a separate `recurrence_type` and `monthly_day` in the UI but store as `days_of_week` JSON for the edge function to parse)
- Time input (type="time") + Timezone select
- Recipients mode (Owners & Managers / All / Custom) + custom user checkboxes
- Auto-create session toggle (Switch)
- Reminder lead time (Select: 1 hr / 2 hr / 4 hr) — maps to `reminder_lead_minutes`: 60 / 120 / 240
- Lock session after X hours (optional number input, only shown when auto-create ON)

**Key implementation details:**
- `fetchAll` queries `reminders WHERE inventory_list_id IS NOT NULL` to distinguish inventory schedules from plain reminders
- `handleSave` writes to `reminders` including the 4 new columns
- Recurrence "Monthly" stores the day as `days_of_week: ["MONTHLY_${day}"]` — a string convention the edge function also reads

**State shape:**
```typescript
const [form, setForm] = useState({
  name: "",
  inventory_list_id: "",
  location_id: "",
  recurrence_type: "weekly" as "weekly" | "twice_weekly" | "monthly",
  days_of_week: [] as string[],
  monthly_day: 1,
  time_of_day: "09:00",
  timezone: "America/New_York",
  is_enabled: true,
  recipients_mode: "OWNERS_MANAGERS" as "OWNERS_MANAGERS" | "ALL" | "CUSTOM",
  target_user_ids: [] as string[],
  auto_create_session: false,
  reminder_lead_minutes: 60,
  lock_after_hours: null as number | null,
});
```

---

### Modified File: `src/pages/app/Settings.tsx`

Add "Inventory Schedule" to `NAV_ITEMS` — only for managers:

```typescript
import { CalendarClock } from "lucide-react";

// In NAV_ITEMS array, after "imports":
{ key: "schedule", label: "Inventory Schedule", icon: CalendarClock },
```

Render the section with role guard:
```typescript
{section === "schedule" && isManager && (
  <InventoryScheduleSection restaurantId={currentRestaurant?.id} isManager={isManager} />
)}
```

The `InventoryScheduleSection` is the named export from the new file. The nav item is only rendered for managers via:
```typescript
// In the left nav map:
{NAV_ITEMS.filter(item => {
  if (item.key === "schedule") return isManager;
  if (item.key === "danger") return true; // already shows for all
  return true;
}).map(item => ...)}
```

---

### Modified File: `src/pages/app/inventory/EnterInventory.tsx`

**New state:**
```typescript
const [schedules, setSchedules] = useState<any[]>([]);
const [locations, setLocations] = useState<any[]>([]);
```

**New `fetchSchedules` function** (called once at mount alongside `fetchSessions`):
```typescript
const fetchSchedules = useCallback(async () => {
  if (!currentRestaurant) return;
  const { data } = await supabase
    .from("reminders")
    .select("*, inventory_lists(name), locations(name)")
    .eq("restaurant_id", currentRestaurant.id)
    .eq("is_enabled", true)
    .not("inventory_list_id", "is", null);
  if (data) setSchedules(data);
}, [currentRestaurant]);
```

**`computeNextOccurrence` helper** (pure function at file top):
```typescript
function computeNextOccurrence(schedule: any): Date | null {
  const dayMap: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  const tzOffsets: Record<string, number> = {
    "America/New_York": -5, "America/Chicago": -6,
    "America/Denver": -7, "America/Los_Angeles": -8,
  };
  const days: string[] = schedule.days_of_week || [];
  const [h, m] = (schedule.time_of_day || "09:00").split(":").map(Number);
  const offset = tzOffsets[schedule.timezone] ?? -5;
  const now = new Date();

  // Monthly schedule
  const monthlyDay = days.find(d => d.startsWith("MONTHLY_"));
  if (monthlyDay) {
    const day = parseInt(monthlyDay.split("_")[1]);
    const candidate = new Date(now.getFullYear(), now.getMonth(), day, h - offset, m);
    if (candidate <= now) candidate.setMonth(candidate.getMonth() + 1);
    return candidate;
  }

  // Weekly / Twice Weekly
  for (let i = 0; i <= 7; i++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + i);
    const candidateDay = Object.keys(dayMap).find(k => dayMap[k] === candidate.getDay());
    if (candidateDay && days.includes(candidateDay)) {
      candidate.setHours(h, m, 0, 0); // local hours
      if (candidate > now) return candidate;
    }
  }
  return null;
}
```

**`nextSchedule` computed value** (via `useMemo`):
```typescript
const nextSchedule = useMemo(() => {
  if (!schedules.length) return null;
  let closest: any = null;
  let closestDate: Date | null = null;
  for (const s of schedules) {
    const d = computeNextOccurrence(s);
    if (d && (!closestDate || d < closestDate)) {
      closestDate = d;
      closest = { ...s, nextDate: d };
    }
  }
  return closest;
}, [schedules]);
```

**Status logic:**
```typescript
function getScheduleStatus(nextDate: Date): "upcoming" | "ready" | "overdue" {
  const diffMs = nextDate.getTime() - Date.now();
  if (diffMs < 0) return "overdue";
  if (diffMs < 60 * 60 * 1000) return "ready"; // within 1 hour
  return "upcoming";
}

function formatCountdown(nextDate: Date): string {
  const diffMs = nextDate.getTime() - Date.now();
  if (diffMs <= 0) return "Now";
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
```

**"Next Scheduled Count" panel** — placed directly above the "Today's count" section label in the landing page render:

```tsx
{nextSchedule && (() => {
  const status = getScheduleStatus(nextSchedule.nextDate);
  const statusConfig = {
    upcoming: { label: "Upcoming", badgeClass: "bg-blue-500/10 text-blue-600 border-blue-200" },
    ready:    { label: "Ready to Start", badgeClass: "bg-success/10 text-success border-success/30" },
    overdue:  { label: "Overdue", badgeClass: "bg-destructive/10 text-destructive border-destructive/30" },
  }[status];

  // Check if there's already a session for this list today
  const todayStr = new Date().toDateString();
  const existingSession = inProgressSessions.find(s =>
    s.inventory_list_id === nextSchedule.inventory_list_id
  );

  return (
    <div className={`rounded-lg border p-4 ${
      status === "overdue" ? "border-destructive/30 bg-destructive/5" :
      status === "ready" ? "border-success/30 bg-success/5" :
      "border-border bg-card"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Next Scheduled Count</p>
            <Badge className={`text-[10px] border ${statusConfig.badgeClass}`}>{statusConfig.label}</Badge>
          </div>
          <p className="font-semibold text-sm">{nextSchedule.name}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {nextSchedule.inventory_lists?.name}
            {nextSchedule.locations?.name ? ` · ${nextSchedule.locations.name}` : ""}
            {" · "}
            {nextSchedule.nextDate.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
            {" at "}
            {nextSchedule.nextDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {status === "overdue" ? "This count is past due" : `Starts in ${formatCountdown(nextSchedule.nextDate)}`}
          </p>
        </div>
        <Button
          size="sm"
          className={`shrink-0 h-8 text-xs gap-1.5 ${
            existingSession ? "bg-gradient-amber shadow-amber" : "bg-gradient-amber shadow-amber"
          }`}
          onClick={() => existingSession ? openEditor(existingSession) : setStartOpen(true)}
        >
          {existingSession ? (
            <><ChevronRight className="h-3.5 w-3.5" />Continue Count</>
          ) : (
            <><Play className="h-3.5 w-3.5" />Start Now</>
          )}
        </Button>
      </div>
    </div>
  );
})()}
```

A `useEffect` adds a 60-second interval to force a re-render and update the countdown display.

---

### Modified File: `supabase/functions/process-notifications/index.ts`

**Section 2 — Existing reminders loop — EXTEND:**

After the current reminder fires notifications to recipients, add auto-session logic:

```typescript
// --- Auto-create session if this is an inventory schedule ---
if (reminder.inventory_list_id && reminder.auto_create_session) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { data: existingSession } = await supabase
    .from("inventory_sessions")
    .select("id")
    .eq("restaurant_id", reminder.restaurant_id)
    .eq("inventory_list_id", reminder.inventory_list_id)
    .gte("created_at", todayStart.toISOString())
    .limit(1);

  if (!existingSession?.length) {
    const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    await supabase.from("inventory_sessions").insert({
      restaurant_id: reminder.restaurant_id,
      inventory_list_id: reminder.inventory_list_id,
      location_id: reminder.location_id || null,
      name: `${reminder.name} – ${dateStr}`,
      status: "IN_PROGRESS",
      created_by: null, // system-created
    });
    results.push(`Auto-created session: ${reminder.name} – ${dateStr}`);
  }
}
```

**Lead-time reminder** — at `now - lead_minutes` matching the schedule time, fire a SCHEDULE_REMINDER notification. This uses a second time match check with the lead offset applied:
```typescript
// Check lead-time window
const leadMin = reminder.reminder_lead_minutes ?? 60;
const leadUtcHour = ((targetHour - offset - Math.floor(leadMin / 60)) + 48) % 24;
const leadTargetMin = (targetMin - (leadMin % 60) + 60) % 60;

if (nowUTC === leadUtcHour && Math.abs(nowMin - leadTargetMin) <= 4 && reminder.inventory_list_id) {
  // Fire lead-time notifications with type "SCHEDULE_REMINDER"
  for (const userId of recipientUserIds) {
    await supabase.from("notifications").insert({
      restaurant_id: reminder.restaurant_id,
      location_id: reminder.location_id,
      user_id: userId,
      type: "SCHEDULE_REMINDER",
      title: `Inventory starts in ${leadMin >= 60 ? Math.floor(leadMin/60) + " hour" : leadMin + " min"}`,
      message: `${reminder.name} – ${reminder.restaurants?.name}`,
      severity: "INFO",
      data: { reminder_id: reminder.id, lead_minutes: leadMin },
    });
  }
}
```

**NEW Section 4 — Overdue detection:**
```typescript
// ─── 4) Process Overdue Inventory Schedules ───
const { data: schedules } = await supabase
  .from("reminders")
  .select("*, restaurants(name)")
  .eq("is_enabled", true)
  .not("inventory_list_id", "is", null)
  .not("lock_after_hours", "is", null);

for (const schedule of schedules || []) {
  const lockAfterHours = schedule.lock_after_hours;
  const cutoffTime = new Date(now.getTime() - lockAfterHours * 60 * 60 * 1000);

  const { data: overdueSessions } = await supabase
    .from("inventory_sessions")
    .select("id, name, created_at")
    .eq("restaurant_id", schedule.restaurant_id)
    .eq("inventory_list_id", schedule.inventory_list_id)
    .eq("status", "IN_PROGRESS")
    .lt("created_at", cutoffTime.toISOString());

  for (const session of overdueSessions || []) {
    // Check if already sent overdue notification for this session
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("restaurant_id", schedule.restaurant_id)
      .eq("type", "SCHEDULE_OVERDUE")
      .contains("data", { session_id: session.id })
      .limit(1);
    if (existing?.length) continue;

    // Notify managers
    const managerIds = await resolveRecipients(supabase, schedule.restaurant_id, "OWNERS_MANAGERS", []);
    for (const userId of managerIds) {
      await supabase.from("notifications").insert({
        restaurant_id: schedule.restaurant_id,
        user_id: userId,
        type: "SCHEDULE_OVERDUE",
        title: "Inventory overdue",
        message: `${session.name} has been in progress for over ${lockAfterHours} hours`,
        severity: "WARNING",
        data: { session_id: session.id, reminder_id: schedule.id },
      });
    }
    results.push(`Sent overdue notification for session: ${session.name}`);
  }
}
```

---

## File Summary

| File | Type | What Changes |
|---|---|---|
| DB migration | SQL | Add 4 columns to `reminders` |
| `src/pages/app/settings/InventorySchedule.tsx` | **New** | Full schedule management page with card UI and create/edit dialog |
| `src/pages/app/Settings.tsx` | Modified | Add "Inventory Schedule" nav item (manager-only) + render section |
| `src/pages/app/inventory/EnterInventory.tsx` | Modified | Add `fetchSchedules`, `computeNextOccurrence`, `nextSchedule` useMemo, countdown panel above Today's Count section |
| `supabase/functions/process-notifications/index.ts` | Modified | Extend Section 2 (auto-create session + lead-time reminder) + add Section 4 (overdue detection) |

**No new routes. No sidebar changes. No new auth providers. All existing RLS policies remain unchanged.**

---

## Recurrence Storage Convention

Weekly schedules use day codes: `["MON"]`, `["FRI"]`
Twice Weekly: `["MON", "THU"]`
Monthly: `["MONTHLY_15"]` — the Edge Function and `computeNextOccurrence` both parse this prefix

This keeps all recurrence data inside the existing `days_of_week jsonb` column without any schema additions beyond the 4 already listed.

---

## UI Design for the New Settings Section

The `InventoryScheduleSection` renders inside the existing Settings right panel, consistent with every other section:

**Empty state:**
```
[CalendarClock icon]
No inventory schedules
Create a schedule to automate recurring inventory counts for your team.
[Create Schedule button]
```

**Populated state — cards grid (2-col on desktop, 1-col mobile):**
```
┌─────────────────────────────────────────────────┐
│  Weekly Count – Main Kitchen        [Active]     │
│  Main Kitchen List · Downtown                   │
│  MON  WED  FRI  ·  9:00 PM Eastern             │
│  Auto-session: ON  ·  Remind 1 hr before        │
│                        [Edit] [Pause] [Delete]   │
└─────────────────────────────────────────────────┘
```

**Dialog — responsive max-w-lg, clean form groups:**
- Section 1: Name + List + Location
- Section 2: Recurrence (type toggle + day chips/month input)
- Section 3: Time + Timezone
- Section 4: Recipients
- Section 5: Automation toggles (auto-session switch, lead time select, lock hours input)
