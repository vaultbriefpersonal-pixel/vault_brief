import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendDiscordReportNotification,
  sendTelegramReportNotification,
} from "./chat-notify";

describe("sendDiscordReportNotification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the announcement text to the webhook URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 204 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await sendDiscordReportNotification("https://discord.com/api/webhooks/x", {
      projectName: "ENS DAO",
      reportUrl: "https://vaultbrief.io/r/abc",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/webhooks/x");
    const body = JSON.parse(opts.body);
    expect(body.content).toContain("ENS DAO");
    expect(body.content).toContain("https://vaultbrief.io/r/abc");
  });

  it("includes the period label when provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 204 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await sendDiscordReportNotification("https://discord.com/api/webhooks/x", {
      projectName: "ENS DAO",
      reportUrl: "https://vaultbrief.io/r/abc",
      periodLabel: "June 2026",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.content).toContain("June 2026");
  });

  it("throws when Discord returns a non-ok status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response)
    );

    await expect(
      sendDiscordReportNotification("https://discord.com/api/webhooks/bad", {
        projectName: "ENS DAO",
        reportUrl: "https://vaultbrief.io/r/abc",
      })
    ).rejects.toThrow("404");
  });
});

describe("sendTelegramReportNotification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to the Telegram sendMessage endpoint with chat_id and text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await sendTelegramReportNotification("bot123:TOKEN", "-100999", {
      projectName: "ENS DAO",
      reportUrl: "https://vaultbrief.io/r/abc",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botbot123:TOKEN/sendMessage");
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe("-100999");
    expect(body.text).toContain("ENS DAO");
  });

  it("throws when the HTTP response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response)
    );

    await expect(
      sendTelegramReportNotification("bad-token", "-100999", {
        projectName: "ENS DAO",
        reportUrl: "https://vaultbrief.io/r/abc",
      })
    ).rejects.toThrow("401");
  });

  it("throws when Telegram's own API reports ok: false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: false, description: "chat not found" }),
      } as unknown as Response)
    );

    await expect(
      sendTelegramReportNotification("bot123:TOKEN", "-999", {
        projectName: "ENS DAO",
        reportUrl: "https://vaultbrief.io/r/abc",
      })
    ).rejects.toThrow("chat not found");
  });
});
