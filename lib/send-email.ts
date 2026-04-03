import { isEmailLiveMode, isEmailMockMode } from "@/lib/email-mode";

export const FLOWCHART_SEND_EMAIL_BUILD_ID =
  "send-email.ts:fetch-edge-compatible-v1";

export type FlowchartEmailKind = "mention" | "due_reminder";

export type SendFlowchartEmailResult = {
  ok: boolean;
  mock: boolean;
  error?: string;
};

function getResendApiKey(): string | undefined {
  const v = process.env.RESEND_API_KEY?.trim();
  return v || undefined;
}

/**
 * 운영(live): 항상 intended 그대로 발송.
 * draft/test(비-live): TEST_EMAIL 이 있으면 수신만 오버라이드(Resend mock 구간에서는 미사용).
 */
function resolveEmailDelivery(intendedTo: string): {
  intendedTo: string;
  deliveryTo: string;
} {
  const intended = intendedTo.trim();
  if (isEmailLiveMode()) {
    return { intendedTo: intended, deliveryTo: intended };
  }
  const test = process.env.TEST_EMAIL?.trim();
  if (test && test.length > 0) {
    return { intendedTo: intended, deliveryTo: test };
  }
  return { intendedTo: intended, deliveryTo: intended };
}

function subjectForSend(optionsSubject: string): string {
  if (isEmailLiveMode()) {
    return optionsSubject;
  }
  return `[DRAFT] ${optionsSubject}`;
}

export async function sendFlowchartEmail(options: {
  to: string;
  subject: string;
  text: string;
  kind: FlowchartEmailKind;
}): Promise<SendFlowchartEmailResult> {
  const { intendedTo, deliveryTo } = resolveEmailDelivery(options.to);
  if (!intendedTo) {
    return { ok: false, mock: isEmailMockMode(), error: "empty recipient" };
  }

  if (isEmailMockMode()) {
    console.log(`[lib/send-email.ts][mock] ${FLOWCHART_SEND_EMAIL_BUILD_ID}`);
    console.log(`[FLOWCHART email:mock][${options.kind}]`);
    console.log("  intended recipient:", intendedTo);
    console.log("  delivery recipient (actual send):", deliveryTo);
    console.log("  from:", process.env.EMAIL_FROM?.trim() ?? "(EMAIL_FROM - mock에서는 미사용)");
    console.log("  subject:", subjectForSend(options.subject));
    console.log("  body:\n" + options.text);
    return { ok: true, mock: true };
  }

  const apiKey = getResendApiKey();

  if (!process.env.EMAIL_FROM?.trim()) {
    return { ok: false, mock: false, error: "EMAIL_FROM is not set" };
  }

  if (!apiKey) {
    return { ok: false, mock: false, error: "RESEND_API_KEY is not set" };
  }

  console.log(
    `[lib/send-email.ts][live][${options.kind}] intended recipient: ${intendedTo} → delivery recipient: ${deliveryTo}`
  );

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM!.trim(),
        to: [deliveryTo],
        subject: subjectForSend(options.subject),
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
