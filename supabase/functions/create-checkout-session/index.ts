// Supabase Edge Function: creates a Stripe Checkout Session (recurring
// price) for the calling user and returns its redirect URL.
//
// Secrets this function needs (set via `supabase secrets set`, never in
// frontend code):
//   STRIPE_SECRET_KEY   - Stripe's secret key (test or live)
//   STRIPE_PRICE_ID     - the recurring Price id to subscribe the user to
//   APP_URL             - where to send the user back after checkout,
//                         e.g. https://your-app.example.com
//
// Deploy: supabase functions deploy create-checkout-session

import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2023-10-16" });

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Missing Authorization header", { status: 401 });

    // Verify the caller's session token against the same project, using the
    // anon key + the caller's own JWT — this never touches the service role.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return new Response("Unauthorized", { status: 401 });
    const user = userData.user;

    // Reuse an existing Stripe customer id if we already have one on file.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: sub } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    const customerId = sub?.stripe_customer_id ?? undefined;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: Deno.env.get("STRIPE_PRICE_ID")!, quantity: 1 }],
      success_url: `${Deno.env.get("APP_URL")}?checkout=success`,
      cancel_url: `${Deno.env.get("APP_URL")}?checkout=cancelled`,
      client_reference_id: user.id,
      metadata: { supabase_user_id: user.id },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
