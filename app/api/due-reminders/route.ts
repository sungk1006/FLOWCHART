export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  buildDueReminderEmailBody,
  buildDueReminderEmailBodyHtml,
  buildDueReminderEmailSubject,
  formatDueForEmail,
  getCalendarDaysUntilDue,
  isDueDateOverdue,
  offsetToLabel,
  type DueReminderJobResult,
  type DueReminderOffset,
  type DueReminderProcessRequest,
} from "@/lib/due-reminder-email";
import { buildFlowchartStepLink, resolveFlowchartAppBaseUrl } from "@/lib/flowchart-step-link";
import { isEmailMockMode } from "@/lib/email-mode";
import { sendFlowchartEmail } from "@/lib/send-email";

const OFFSETS: DueReminderOffset[] = ["3", "2", "1"];

export async function POST(req: Request) {
  console.log("[app/api/due-reminders/route.ts] POST — Due Reminder D-3/D-2/D-1 검사(API).");

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

        if (isDueDateOverdue(step.dueDate, nowMs)) continue;

        const rawWire = step as {
          assigneeMemberIds?: unknown;
          assigneeMemberId?: string;
          dueReminderSentMap?: unknown;
        };
        let assigneeIds: string[] = [];
        if (Array.isArray(rawWire.assigneeMemberIds) && rawWire.assigneeMemberIds.length > 0) {
          assigneeIds = rawWire.assigneeMemberIds.filter(
            (x): x is string => typeof x === "string" && x.trim().length > 0
          );
        } else if (typeof rawWire.assigneeMemberId === "string" && rawWire.assigneeMemberId.trim()) {
          assigneeIds = [rawWire.assigneeMemberId.trim()];
        }
        if (!assigneeIds.length) continue;

        const map =
          rawWire.dueReminderSentMap && typeof rawWire.dueReminderSentMap === "object" && !Array.isArray(rawWire.dueReminderSentMap)
            ? (rawWire.dueReminderSentMap as Record<string, string>)
            : {};

        const days = getCalendarDaysUntilDue(step.dueDate, nowMs);
        if (days === null) continue;

        for (const offset of OFFSETS) {
          const wantDays = offset === "3" ? 3 : offset === "2" ? 2 : 1;
          if (days !== wantDays) continue;
          const key = offset as string;
          if (map[key]?.trim()) continue;

          for (const memberId of assigneeIds) {
            const assignee = memberById.get(memberId);
            const email = assignee?.email?.trim();
            if (!email) continue;

            const assigneeName = assignee?.name?.trim() || email;
            const reminderLabel = offsetToLabel(offset);
            const baseFromBody = typeof body.appBaseUrl === "string" ? body.appBaseUrl.trim() : "";
            const base = baseFromBody || resolveFlowchartAppBaseUrl(req);
            const stepLink =
              base && project.id && step.id ? buildFlowchartStepLink(base, project.id, step.id) : undefined;
            const subject = buildDueReminderEmailSubject(project.code, step.label ?? "", reminderLabel);
            const emailPayload = {
              projectCode: project.code,
              phaseTitle: phase.title ?? "",
              stepLabel: step.label ?? "",
              dueDateRaw: step.dueDate,
              dueDisplay: formatDueForEmail(step.dueDate),
              assigneeName,
              reminderLabel,
              stepLink,
            };
            const emailText = buildDueReminderEmailBody(emailPayload);
            const emailHtml = buildDueReminderEmailBodyHtml(emailPayload);

            const sentAt = new Date().toISOString();

            const out = await sendFlowchartEmail({
              to: email,
              subject,
              text: emailText,
              html: emailHtml,
              kind: "due_reminder",
            });

            processed.push({
              projectId: project.id,
              phaseId: phase.id,
              stepId: step.id,
              reminderOffset: offset,
              sentAt,
              ok: out.ok,
              error: out.error,
              recipientMemberId: memberId,
            });
          }
        }
      }
    }
  }

  return NextResponse.json({ mock, processed } satisfies {
    mock: boolean;
    processed: DueReminderJobResult[];
  });
}
