export const runtime = 'edge';
import { NextResponse } from "next/server";

import {
  buildDueReminderEmailBody,
  buildDueReminderEmailSubject,
  formatDueForEmail,
  isInDueReminderWindow,
  type DueReminderJobResult,
  type DueReminderProcessRequest,
} from "@/lib/due-reminder-email";
import { isEmailMockMode } from "@/lib/email-mode";
import { sendFlowchartEmail } from "@/lib/send-email";

export const runtime = "nodejs";

export async function POST(req: Request) {
  console.log("[app/api/due-reminders/route.ts] POST — Due 24h 알림 검사(API) 버튼이 이 핸들러를 호출합니다.");

  let body: DueReminderProcessRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.projects || !Array.isArray(body.projects)) {
    return NextResponse.json({ error: "projects required" }, { status: 400 });
  }
  if (!body.members || !Array.isArray(body.members)) {
    return NextResponse.json({ error: "members required" }, { status: 400 });
  }

  const memberById = new Map(body.members.map((m) => [m.id, m]));
  const mock = isEmailMockMode();
  const nowMs = Date.now();
  const processed: DueReminderJobResult[] = [];

  for (const project of body.projects) {
    if (!project?.id || typeof project.code !== "string") continue;

    for (const phase of project.phases ?? []) {
      if (!phase?.id) continue;

      for (const step of phase.steps ?? []) {
        if (!step?.id) continue;
        if (step.checked) continue;
        if (!step.dueDate?.trim()) continue;
        if (!step.assigneeMemberId?.trim()) continue;
        if (step.dueReminderSentAt?.trim()) continue;

        if (!isInDueReminderWindow(step.dueDate, nowMs)) continue;

        const assignee = memberById.get(step.assigneeMemberId);
        const email = assignee?.email?.trim();
        if (!email) continue;

        const assigneeName = assignee?.name?.trim() || email;
        const subject = buildDueReminderEmailSubject(project.code, step.label);
        const emailBody = buildDueReminderEmailBody({
          projectCode: project.code,
          phaseTitle: phase.title ?? "",
          stepLabel: step.label ?? "",
          dueDateRaw: step.dueDate,
          dueDisplay: formatDueForEmail(step.dueDate),
          assigneeName,
        });

        const sentAt = new Date().toISOString();

        console.log(
          "[app/api/due-reminders/route.ts] 메일 발송 직전 → import sendFlowchartEmail from @/lib/send-email"
        );

        const out = await sendFlowchartEmail({
          to: email,
          subject,
          text: emailBody,
          kind: "due_reminder",
        });

        processed.push({
          projectId: project.id,
          phaseId: phase.id,
          stepId: step.id,
          sentAt,
          ok: out.ok,
          error: out.error,
        });
      }
    }
  }

  return NextResponse.json({ mock, processed } satisfies {
    mock: boolean;
    processed: DueReminderJobResult[];
  });
}
