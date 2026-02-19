

## Add "Save" Button to My Categories Mode

### What will change
A "Save" button will be added to the My Categories toolbar (the bar that already has the "+ Create category" input). This button will explicitly save all current category assignments and ordering to the database, giving you visual confirmation that everything is persisted.

### How it will work
- The Save button appears next to the Create button in the My Categories bar
- Clicking it writes all current item-to-category mappings and sort orders to the database
- Shows a "Saving..." state while working, then confirms with a "Saved" toast
- The button is styled consistently with the existing "Save categories to list" button in Custom Categories mode

### Technical details
1. **Add a `handleSaveMyCategories` function** that:
   - Gets or creates the `user_manual` category set for the current list
   - Upserts all `list_item_category_map` entries for every item based on the current in-memory grouping and sort order
   - Updates `active_category_mode` to `my-categories`
   - Shows saving/saved status and a success toast

2. **Add a Save button** to the My Categories toolbar section (line ~1297), next to the existing Create button:
   - Icon: checkmark (matching the Custom Categories save button style)
   - Label: "Save"
   - Disabled while `saveStatus === "saving"`

No database changes needed -- this uses the existing `list_item_category_map` and `list_category_sets` tables.
