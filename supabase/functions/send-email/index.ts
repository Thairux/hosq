// Allow unauthenticated calls from the patient self-serve flow (mirrors send-sms).
export const config = {
  verify_jwt: false,
};

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, apikey",
};

interface EmailRequest {
  to: string;
  subject: string;
  message: string;
  patientId?: string;
  queueEntryId?: string;
}

function isEmailEnabled(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  const enabled = (value as Record<string, unknown>).enabled;
  return enabled !== false;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({
          error: "Supabase runtime credentials are missing",
          details:
            "Expected SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY).",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const gmailUser = Deno.env.get("GMAIL_USER")?.trim();
    const gmailAppPassword = Deno.env.get("GMAIL_APP_PASSWORD")?.trim();

    if (!gmailUser || !gmailAppPassword) {
      return new Response(
        JSON.stringify({
          error: "Gmail SMTP credentials not configured",
          details: "Please set GMAIL_USER and GMAIL_APP_PASSWORD environment variables",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const settingsResponse = await fetch(
      `${supabaseUrl}/rest/v1/system_settings?select=value&key=eq.email_enabled&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!settingsResponse.ok) {
      const details = await settingsResponse.text();
      console.error("Failed to read email_enabled setting via REST:", details);
    }

    const settingRows = settingsResponse.ok ? await settingsResponse.json() : [];
    const settingValue = Array.isArray(settingRows) && settingRows.length > 0 ? settingRows[0]?.value : null;

    if (!isEmailEnabled(settingValue)) {
      return new Response(
        JSON.stringify({
          error: "Email sending is currently disabled by administrator settings",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { to, subject, message, patientId, queueEntryId }: EmailRequest = await req.json();

    if (!to || !subject || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, subject, message" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!EMAIL_RE.test(to)) {
      return new Response(
        JSON.stringify({ error: "Invalid recipient email address" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: gmailUser,
        pass: gmailAppPassword.replace(/\s+/g, ""),
      },
    });

    let messageId: string | null = null;
    try {
      const info = await transporter.sendMail({
        from: `"HOSQ Queue" <${gmailUser}>`,
        to,
        subject,
        text: message,
      });
      messageId = info?.messageId ?? null;
    } catch (sendError) {
      const detail = sendError instanceof Error ? sendError.message : "Unknown error";
      console.error("Gmail SMTP send failed:", detail);

      await supabase.from("email_logs").insert({
        patient_id: patientId || null,
        queue_entry_id: queueEntryId || null,
        email: to,
        subject,
        message,
        status: "failed",
        error: detail,
      });

      return new Response(
        JSON.stringify({
          error: "Failed to send email",
          details: detail,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    await supabase.from("email_logs").insert({
      patient_id: patientId || null,
      queue_entry_id: queueEntryId || null,
      email: to,
      subject,
      message,
      status: "sent",
      provider_id: messageId,
    });

    return new Response(
      JSON.stringify({
        success: true,
        messageId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error sending email:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
