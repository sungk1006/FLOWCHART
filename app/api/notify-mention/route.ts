import { NextResponse } from "next/server";

import { isEmailMockMode } from "@/lib/email-mode";
import {
  buildMentionEmailBody,
  buildMentionEmailSubject,
  type MentionNotifyRequest,
  type MentionNotifyRecipientResult,
} from "@/lib/mention-email";
import { sendFlowchartEmail } from "@/lib/send-email";

export const runtime = "nodejs";

export async function POST(req: Request) {
  console.log("[app/api/notify-mention/route.ts] POST — Save Comment 멘션 알림이 이 핸들러를 호출합니다.");

  let body: MentionNotifyRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.recipients || !Array.isArray(body.recipients)) {
    return NextResponse.json({ error: "recipients required" }, { status: 400 });
  }

  if (!body.projectCode || !body.stepLabel) {
    return NextResponse.json({ error: "projectCode and stepLabel required" }, { status: 400 });
  }

  const subject = buildMentionEmailSubject(body.projectCode, body.stepLabel);
  const emailBody = buildMentionEmailBody(body);
  const mock = isEmailMockMode();

  const results: MentionNotifyRecipientResult[] = [];

  for (const r of body.recipients) {
    if (!r.email?.trim()) {
      results.push({
        email: r.email ?? "",
        name: r.name ?? "",
        ok: false,
        error: "empty email",
      });
      continue;
    }

    const out = await sendFlowchartEmail({
      to: r.email.trim(),
      subject,
      text: emailBody,
      kind: "mention",
    });

    results.push({
      email: r.email.trim(),
      name: r.name ?? "",
      ok: out.ok,
      error: out.error,
    });
  }

  return NextResponse.json({ mock, results } satisfies {
    mock: boolean;
    results: MentionNotifyRecipientResult[];
  });
}
