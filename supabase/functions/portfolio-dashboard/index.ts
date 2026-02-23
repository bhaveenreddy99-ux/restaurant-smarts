import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

    // Get all restaurants user belongs to
    const { data: memberships } = await supabase
      .from("restaurant_members")
      .select("restaurant_id, role, restaurants(id, name)")
      .eq("user_id", userId);

    if (!memberships?.length) {
      return new Response(JSON.stringify({ restaurants: [], totals: { red: 0, yellow: 0, green: 0 } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result: any[] = [];
    let totalRed = 0, totalYellow = 0, totalGreen = 0;
    let totalWasteExposure = 0;
    let totalSpendMonth = 0;

    for (const membership of memberships) {
      const rid = (membership as any).restaurants.id;
      const rname = (membership as any).restaurants.name;

      // Get all locations for this restaurant
      const { data: locations } = await supabase
        .from("locations")
        .select("id, name")
        .eq("restaurant_id", rid)
        .eq("is_active", true);

      const locationResults: any[] = [];

      // Process per-location if locations exist, otherwise process restaurant-level
      const locationIds = locations?.map(l => l.id) || [];
      const processTargets = locationIds.length > 0 
        ? locationIds.map(lid => ({ locationId: lid, locationName: locations!.find(l => l.id === lid)?.name || "" }))
        : [{ locationId: null as string | null, locationName: null as string | null }];

      let restRed = 0, restYellow = 0, restGreen = 0;
      let restWaste = 0;

      for (const target of processTargets) {
        // Latest approved session for this location
        let sessionQuery = supabase
          .from("inventory_sessions")
          .select("id, approved_at")
          .eq("restaurant_id", rid)
          .eq("status", "APPROVED")
          .order("approved_at", { ascending: false })
          .limit(1);

        if (target.locationId) {
          sessionQuery = sessionQuery.eq("location_id", target.locationId);
        }

        const { data: sessions } = await sessionQuery;

        let locRed = 0, locYellow = 0, locGreen = 0;
        let locWaste = 0;
        let topItems: any[] = [];

        if (sessions?.length) {
          const { data: items } = await supabase
            .from("inventory_session_items")
            .select("item_name, current_stock, par_level, unit, unit_cost")
            .eq("session_id", sessions[0].id);

          if (items) {
            items.forEach((i: any) => {
              const stock = Number(i.current_stock ?? 0);
              const par = Number(i.par_level ?? 0);
              const ratio = par > 0 ? stock / par : 1;
              if (ratio < 0.5) locRed++;
              else if (ratio < 1) locYellow++;
              else locGreen++;
              // Waste exposure
              if (par > 0 && stock > par && i.unit_cost) {
                locWaste += (stock - par) * Number(i.unit_cost);
              }
            });
            topItems = items
              .map((i: any) => ({ ...i, suggested: Math.max(Number(i.par_level) - Number(i.current_stock), 0), ratio: Number(i.current_stock) / Math.max(Number(i.par_level), 1) }))
              .sort((a: any, b: any) => b.suggested - a.suggested)
              .slice(0, 5);
          }
        }

        restRed += locRed;
        restYellow += locYellow;
        restGreen += locGreen;
        restWaste += locWaste;

        if (target.locationId) {
          locationResults.push({
            locationId: target.locationId,
            locationName: target.locationName,
            red: locRed,
            yellow: locYellow,
            green: locGreen,
            wasteExposure: locWaste,
            lastApproved: sessions?.[0]?.approved_at || null,
          });
        }
      }

      // Spend this month
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const { data: recentPH } = await supabase
        .from("purchase_history")
        .select("id")
        .eq("restaurant_id", rid)
        .in("invoice_status", ["COMPLETE", "POSTED"])
        .gte("created_at", monthStart.toISOString());

      let spendMonth = 0;
      if (recentPH?.length) {
        const phIds = recentPH.map(p => p.id);
        const { data: phItems } = await supabase
          .from("purchase_history_items")
          .select("total_cost")
          .in("purchase_history_id", phIds);
        if (phItems) {
          spendMonth = phItems.reduce((sum, i) => sum + Number(i.total_cost || 0), 0);
        }
      }

      // Recent orders count
      const { count: orderCount } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", rid);

      // Unread notifications
      const { count: unreadAlerts } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("restaurant_id", rid)
        .is("read_at", null);

      totalRed += restRed;
      totalYellow += restYellow;
      totalGreen += restGreen;
      totalWasteExposure += restWaste;
      totalSpendMonth += spendMonth;

      result.push({
        id: rid,
        name: rname,
        role: membership.role,
        red: restRed,
        yellow: restYellow,
        green: restGreen,
        wasteExposure: restWaste,
        spendMonth,
        locations: locationResults,
        recentOrders: orderCount || 0,
        unreadAlerts: unreadAlerts || 0,
        lastApproved: null, // computed per-location
      });
    }

    return new Response(JSON.stringify({
      restaurants: result,
      totals: { red: totalRed, yellow: totalYellow, green: totalGreen, wasteExposure: totalWasteExposure, spendMonth: totalSpendMonth },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Portfolio dashboard error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
