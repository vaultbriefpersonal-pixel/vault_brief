import type { NextRequest } from "next/server";
import OpenAI from "openai";
import { CHAT_SYSTEM_PROMPT } from "@/server/services/chat-prompt";
import { chatLimiter, checkLimit } from "@/server/lib/ratelimit";

/**
 * Marketing chat proxy. Streams an OpenRouter completion back to the
 * client as plain text — newline-delimited tokens, no SSE wrapper, since
 * the widget consumes the response with `getReader().read()` directly.
 *
 * The model is configurable via `CHAT_MODEL` env so we can swap between
 * `google/gemini-2.5-flash` (cheapest) and `anthropic/claude-3.5-sonnet`
 * (smarter) without redeploying.
 *
 * Hard caps:
 *   - 20 messages max per turn (prevents prompt-stuffing)
 *   - 8000 chars total input (~2000 tokens — sane upper bound)
 *   - 10 chats / hour / IP via chatLimiter (Upstash, fails open)
 */

const MAX_MESSAGES = 20;
const MAX_TOTAL_CHARS = 8000;
const DEFAULT_MODEL = "google/gemini-2.5-flash";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

let _openrouter: OpenAI | undefined;
function getOpenrouter(): OpenAI {
  if (!_openrouter) {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is not set");
    }
    _openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        // Required by OpenRouter for free-tier attribution. URL is the
        // canonical site so the request leaderboard tracks us, not a
        // preview deploy.
        "HTTP-Referer": "https://www.vaultbrief.io",
        "X-Title": "Vault Brief",
      },
    });
  }
  return _openrouter;
}

function clientIp(req: NextRequest): string {
  // Vercel sets x-forwarded-for; the leftmost entry is the real client.
  // Fall back to a constant so the limiter still buckets dev traffic.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json(
      { error: "Chat is not configured on this deployment." },
      { status: 503 }
    );
  }

  let body: { messages?: ChatMessage[] };
  try {
    body = (await req.json()) as { messages?: ChatMessage[] };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = body.messages ?? [];
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return Response.json(
      { error: `Max ${MAX_MESSAGES} messages per turn` },
      { status: 400 }
    );
  }
  const totalChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return Response.json(
      { error: `Conversation too long (${totalChars} chars; max ${MAX_TOTAL_CHARS})` },
      { status: 413 }
    );
  }
  const last = messages[messages.length - 1];
  if (last.role !== "user") {
    return Response.json(
      { error: "Last message must be from user" },
      { status: 400 }
    );
  }

  // Throttle anonymous traffic. Limiter fails open if Upstash isn't
  // configured, so dev/local doesn't 429 on every request.
  try {
    await checkLimit(chatLimiter, `chat:${clientIp(req)}`);
  } catch (err) {
    if (err instanceof Error && err.message.toLowerCase().includes("too many")) {
      return Response.json(
        { error: "Rate limit hit. Try again in an hour, or email hello@vaultbrief.io." },
        { status: 429 }
      );
    }
    throw err;
  }

  const stream = await getOpenrouter().chat.completions.create({
    model: process.env.CHAT_MODEL ?? DEFAULT_MODEL,
    stream: true,
    messages: [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    temperature: 0.4,
    max_tokens: 600,
  });

  // Stream raw text deltas. The widget reads them as they arrive and
  // appends to the assistant bubble. No SSE framing — keeps the client
  // logic ~5 lines.
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            "\n\n[stream interrupted — please retry or email hello@vaultbrief.io]"
          )
        );
        console.error("chat stream failed", err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
