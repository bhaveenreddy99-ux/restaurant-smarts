

## Clean Slate: Delete All Users and Data

This will remove all 3 user accounts and their associated restaurant data so you can sign up fresh and test from scratch.

### What Gets Deleted

- **3 user accounts**: bhaveenreddy99@gmail.com, testuser12345@test.com, bhaveen.msba@gmail.com
- **5 restaurants**: schlotz1, Test Direct Insert, 3x Demo Restaurant
- **All related data**: inventory lists, catalog items, PAR guides, sessions, orders, purchase history, smart order runs, settings, notifications, and invitations

### Execution Steps

1. **Delete restaurant data** using the existing `delete_restaurant_cascade` RPC for each of the 5 restaurants (executed via direct SQL since we need service-role-level access)
2. **Delete profiles** from the `profiles` table
3. **Delete auth users** from `auth.users`

### Technical Details

The cleanup will run in this order to respect foreign key constraints:
1. Delete all restaurant-scoped data (cascade function handles inventory, sessions, orders, PAR, etc.)
2. Delete `restaurant_members` and `restaurants`
3. Delete `profiles`
4. Delete `auth.users` entries

No code changes are needed -- this is purely a data cleanup operation.

