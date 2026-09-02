// Supabase Edge Function: receives Stripe webhook events and updates the
// `subscriptions` table using the service-role key (bypasses RLS — this
// is the only place that's meant to write status/stripe_* columns).
//
// Secrets this function needs (set via `supabase secrets set`):
//   STRIPE_SECRET_KEY     - same as create-checkout-session
//   STRIPE_WEBHOOK_SECRET - from the Stripe Dashboard webhook endpoint
//   SUPABASE_SECRET_KEYS  - Project Settings -> API Keys -> Secret keys,
//                           already present in every Edge Function
//                           environment automatically; the "backend_key"
//                           entry within it is what's actually read, see
//                           _shared/serviceRoleKey.ts
//                           (never put a raw key in frontend code or .env.local)
//
// After deploying, register this function's URL as a webhook endpoint in
// the Stripe Dashboard, subscribed to:
//   checkout.session.completed, customer.subscription.updated,
//   customer.subscription.deleted
//
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt

import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";
import { getBackendKey } from "../_shared/serviceRoleKey.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2023-10-16" });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, getBackendKey());

function statusFromStripe(stripeStatus) {
  if (stripeStatus === "active" || stripeStatus === "trialing") return "active";
  if (stripeStatus === "past_due" || stripeStatus === "unpaid") return "past_due";
  return "canceled";
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
    );
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.supabase_user_id || session.client_reference_id;
      if (userId) {
        await admin.from("subscriptions").update({
          status: "active",
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          updated_at: new Date().toISOString(),
        }).eq("user_id", userId);
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      await admin.from("subscriptions").update({
        status: event.type === "customer.subscription.deleted" ? "canceled" : statusFromStripe(sub.status),
        updated_at: new Date().toISOString(),
      }).eq("stripe_customer_id", sub.customer);
    }

    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
