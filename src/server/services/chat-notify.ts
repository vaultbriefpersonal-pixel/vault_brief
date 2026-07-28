// Best-effort Discord/Telegram delivery for "new report available" pings.
// Additive alongside investor email — never a replacement, and a failure
// here must never block or fail the email send path (see investors.ts).

interface ReportAnnouncement {
  projectName: string;
  reportUrl: string;
  periodLabel?: string;
}

function announcementText({
  projectName,
  reportUrl,
  periodLabel,
}: ReportAnnouncement): string {
  const period = periodLabel ? ` (${periodLabel})` : "";
  return `📊 New investor report for ${projectName}${period} is available: ${reportUrl}`;
}

export async function sendDiscordReportNotification(
  webhookUrl: string,
  announcement: ReportAnnouncement
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: announcementText(announcement) }),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook returned ${res.status}`);
  }
}

export async function sendTelegramReportNotification(
  botToken: string,
  chatId: string,
  announcement: ReportAnnouncement
): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: announcementText(announcement),
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Telegram sendMessage returned ${res.status}`);
  }
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description ?? "unknown"}`);
  }
}
