import { createFileRoute } from "@tanstack/react-router";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type ModelMessage } from "ai";
import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "@/lib/ai/run-id.server";

type Mode = "scam" | "simplify" | "navigate";
type Upload = { name: string; type: string; data: string }; // data = base64 (no prefix)

const BASE = "You are a patient, kind helper for older adults. Use short sentences, plain everyday words, and no jargon. Use markdown headings and bullet lists. Never ask for passwords, bank details, or personal info.";

const PROMPTS: Record<Mode, string> = {
  scam: `${BASE}
The user shares screenshot(s) of text messages, emails or calls. Decide if it is a scam.
Start with exactly one heading line: "## Verdict: Likely a scam", "## Verdict: Be careful", or "## Verdict: Looks safe".
Then "### Why" with 2-5 simple bullet points naming the warning signs (or reassuring signs) you see.
Then "### What to do" with clear steps (e.g. don't click links, don't reply, call the company using the number on your card, ask a family member). Keep it calm and reassuring.`,
  simplify: `${BASE}
The user shares bills, letters, or forms. Explain them very simply.
Sections: "## What this is" (one or two sentences), "### The important parts" (amounts owed, due dates, account names — bold the key numbers and dates), "### What you need to do" (numbered steps, or say nothing is needed), "### Words explained" (only if there are confusing terms). If several documents, cover each briefly. If anything looks suspicious, say so.`,
  navigate: `${BASE}
The user shares a screenshot of an app or website and tells you what they want to do.
Section "## Where you are" (one sentence describing the screen).
Then "### Steps" as a numbered list. For each step, describe exactly what to tap: its words, its shape/color, and where it is on the screen (e.g. "the blue button at the bottom right that says Send"). If the goal isn't reachable from this screen, say what to tap first and ask them to take a new screenshot after.`,
};

export const Route = createFileRoute("/api/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("The helper is not set up yet.", { status: 500 });
        const body = (await request.json()) as { mode: Mode; files: Upload[]; question?: string };
        if (!PROMPTS[body.mode] || !body.files?.length)
          return new Response("Please add at least one picture.", { status: 400 });
        if (body.files.length > 10) return new Response("Please add 10 pictures or fewer.", { status: 400 });

        const content: Exclude<ModelMessage["content"], string> = [];
        const q = body.question?.trim();
        content.push({
          type: "text",
          text: q ? `My question / what I want to do: ${q}` : "Please help me with these.",
        } as never);
        for (const f of body.files) {
          if (!f.data) continue;
          if (f.type === "application/pdf") {
            content.push({ type: "file", filename: f.name, data: f.data, mediaType: "application/pdf" } as never);
          } else if (f.type.startsWith("image/")) {
            content.push({ type: "image", image: new URL(`data:${f.type};base64,${f.data}`) } as never);
          }
        }

        const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
        const provider = createOpenAI({
          baseURL: "https://ai.gateway.lovable.dev/v1",
          apiKey,
          headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
          fetch: runIdFetch.fetch,
        });
        let upstreamError: string | null = null;
        const result = streamText({
          model: provider.responses("openai/gpt-6-astra"),
          instructions: PROMPTS[body.mode],
          messages: [{ role: "user", content } as ModelMessage],
          abortSignal: request.signal,
          onError: ({ error }) => {
            upstreamError = error instanceof Error ? error.message : String(error);
            console.error("analyze error", error);
          },
          providerOptions: {
            openai: {
              store: false,
              forceReasoning: true,
              reasoningEffort: "low",
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            },
          },
        } as never);
        void upstreamError;
        return withLovableAiGatewayRunIdHeader(result.toTextStreamResponse(), runIdFetch);
      },
    },
  },
});
