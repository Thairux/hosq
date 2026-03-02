// Diagnostics for SMS configuration (no secrets returned).
export const config = {
  verify_jwt: false,
};

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const required = ["BULKSMS_TOKEN_ID", "BULKSMS_TOKEN_SECRET", "SUPABASE_URL"];
    const missing = required.filter((key) => !Deno.env.get(key));
    const hasServiceRoleKey =
      Boolean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ||
      Boolean(Deno.env.get("SERVICE_ROLE_KEY"));

    if (!hasServiceRoleKey) {
      missing.push("SUPABASE_SERVICE_ROLE_KEY");
    }

    return new Response(
      JSON.stringify({
        ok: missing.length === 0,
        missing,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
