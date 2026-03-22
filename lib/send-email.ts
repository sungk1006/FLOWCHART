
import { isEmailMockMode } from "@/lib/email-mode";

export const FLOWCHART_SEND_EMAIL_BUILD_ID =
  "send-email.ts:fetch-edge-compatible-v1";

export type FlowchartEmailKind = "mention" | "due_reminder";

export type SendFlowchartEmailResult = {
  ok: boolean;
  mock: boolean;
  error?: string;
};

function getFromAddress(): string | undefined {
  const v = process.env.EMAIL_FROM?.trim();
  return v || undefined;
}

function getResendApiKey(): string | undefined {
  const v = process.env.RESEND_API_KEY?.trim();
  return v || undefined;
}

export async function sendFlowchartEmail(options: {
  to: string;
  subject: string;
  text: string;
  kind: FlowchartEmailKind;
}): Promise<SendFlowchartEmailResult> {
  const to = options.to.trim();
  if (!to) {
    return { ok: false, mock: isEmailMockMode(), error: "empty recipient" };
  }

  if (isEmailMockMode()) {
    console.log(`[lib/send-email.ts][mock] ${FLOWCHART_SEND_EMAIL_BUILD_ID}`);
    console.log(`[FLOWCHART email:mock][${options.kind}]`);
    console.log("  to:", to);
    console.log("  from:", getFromAddress() ?? "(EMAIL_FROM - mock에서는 미사용)");
    console.log("  subject:", options.subject);
    console.log("  body:\n" + options.text);
    return { ok: true, mock: true };
  }

  const from = getFromAddress();
  const apiKey = getResendApiKey();

  if (!from) {
    return { ok: false, mock: false, error: "EMAIL_FROM is not set" };
  }

  if (!apiKey) {
    return { ok: false, mock: false, error: "RESEND_API_KEY is not set" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: options.subject,
        text: options.text,
      }),
    });

    const raw = await response.text();

    if (!response.ok) {
      console.log("[lib/send-email.ts][live] Resend API error:", raw);
      return {
        ok: false,
        mock: false,
        error: raw || `HTTP ${response.status}`,
      };
    }

    console.log("[lib/send-email.ts][live] Resend API OK");
    return { ok: true, mock: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Resend send failed";
    console.log("[lib/send-email.ts][live] exception:", msg);
    return {
      ok: false,
      mock: false,
      error: msg,
    };
  }
}
