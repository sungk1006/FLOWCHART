import * as https from "node:https";
import { URL } from "node:url";

import { isEmailMockMode } from "@/lib/email-mode";

/** 번들 식별용 — 터미널에 이 문자열이 보이면 이 파일의 최신 코드가 실행 중 */
export const FLOWCHART_SEND_EMAIL_BUILD_ID = "send-email.ts:https-native-v2-no-fetch-no-resend-sdk";

export type FlowchartEmailKind = "mention" | "due_reminder";

export type SendFlowchartEmailResult = {
  ok: boolean;
  /** true면 콘솔 mock만 수행 */
  mock: boolean;
  error?: string;
};

const RESEND_API_URL = "https://api.resend.com/emails";

function getFromAddress(): string | undefined {
  const v = process.env.EMAIL_FROM?.trim();
  return v || undefined;
}

function getResendApiKey(): string | undefined {
  const v = process.env.RESEND_API_KEY?.trim();
  return v || undefined;
}

type ResendSendPayload = {
  from: string;
  to: string;
  subject: string;
  text: string;
};

/**
 * Node `https.request`만 사용 — `fetch` / undici / Next patchFetch / Resend SDK 미사용.
 * 본문은 UTF-8 Buffer, 헤더 값은 ASCII만.
 */
function sendViaResendHttps(
  payload: ResendSendPayload,
  apiKey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const bodyUtf8 = JSON.stringify(payload);
  const bodyBuf = Buffer.from(bodyUtf8, "utf8");

  const target = new URL(RESEND_API_URL);

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: target.hostname,
        port: 443,
        path: target.pathname,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": String(bodyBuf.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
        });
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            try {
              const j = JSON.parse(raw) as { message?: string; name?: string };
              const msg = [j.message, j.name].filter(Boolean).join(" — ") || raw;
              resolve({ ok: false, error: msg || `HTTP ${status}` });
            } catch {
              resolve({ ok: false, error: raw || `HTTP ${status}` });
            }
            return;
          }
          resolve({ ok: true });
        });
      }
    );

    req.on("error", (err) => {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });

    req.write(bodyBuf);
    req.end();
  });
}

/**
 * FLOWCHART 앱 공용 발송: mock이면 터미널만, live면 Resend REST를 https.request로 호출.
 * Resend npm 패키지 미사용. live 경로에서 fetch 미사용.
 */
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
    console.log("  from:", getFromAddress() ?? "(EMAIL_FROM — mock에서는 미사용)");
    console.log("  subject:", options.subject);
    console.log("  body:\n" + options.text);
    return { ok: true, mock: true };
  }

  console.log(`[lib/send-email.ts][live] ${FLOWCHART_SEND_EMAIL_BUILD_ID}`);
  console.log("[lib/send-email.ts][live] transport=node:https.request (no fetch, no Resend SDK)");
  console.log("[lib/send-email.ts][live] kind=", options.kind, "to=", to);
  console.log("[lib/send-email.ts][live] subject length=", options.subject.length, "(UTF-16 code units)");

  const from = getFromAddress();
  const apiKey = getResendApiKey();
  if (!from) {
    return { ok: false, mock: false, error: "EMAIL_FROM is not set" };
  }
  if (!apiKey) {
    return { ok: false, mock: false, error: "RESEND_API_KEY is not set" };
  }

  try {
    const result = await sendViaResendHttps(
      {
        from,
        to,
        subject: options.subject,
        text: options.text,
      },
      apiKey
    );

    if (!result.ok) {
      console.log("[lib/send-email.ts][live] Resend API error:", result.error);
      return { ok: false, mock: false, error: result.error };
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
