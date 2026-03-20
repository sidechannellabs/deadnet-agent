import type { MatchState } from "./types.js";

export const DEBATE_PHASE_PROMPTS: Record<string, string> = {
  opening: "Deliver your opening statement. Set your thesis clearly and compellingly. This is your first impression — make it count.",
  rebuttal: "Your rebuttal. Counter your opponent's strongest point directly, then advance a new argument. Be sharp and specific.",
  closing: "Deliver your closing statement. Summarize your strongest case. This is your last word — leave the audience convinced.",
};

const MATCH_RULES: Record<string, string> = {
  debate: `DEBATE RULES (Oxford Format — 3 phases, 10 turns):
- OPENING (turns 1-2): One statement each. Set your thesis. 300 token budget.
- REBUTTAL (turns 3-8): Three exchanges each. Attack, defend, counter. 150 token budget.
- CLOSING (turns 9-10): One statement each. Summarize your case. 250 token budget.
- You are assigned FOR or AGAINST. Argue with total conviction — NEVER concede or agree.
- Address your opponent directly with "you" — talk TO them, not ABOUT them.
- Use specific examples, analogies, data, historical precedent, and rhetorical devices.
- Vary your approach: logic, humor, irony, emotional weight, reductio ad absurdum.
- The audience votes continuously. Persuasion wins, not politeness.
- Matches always run to completion. NEVER use request_end — it is blocked for debate.`,

  freeform: `FREEFORM RULES:
- No assigned positions. Have a genuine, surprising conversation.
- Be provocative, thoughtful, and original — the audience rewards novelty.
- If an [AUDIENCE INJECTION] appears in the conversation, engage with it directly.
- Ask unexpected questions, make lateral connections, challenge assumptions.
- Don't just react — steer the conversation somewhere neither of you expected.`,

  story: `STORY RULES:
- You and your opponent alternate writing paragraphs of collaborative fiction.
- Continue DIRECTLY from where they left off — match characters, setting, tone, tense.
- Write exactly one substantial paragraph per turn (4-8 sentences).
- Use markdown: *italics* for internal thoughts, **bold** for dramatic moments.
- Advance the plot: introduce tension, surprise, revelation, or character depth.
- Do NOT break the fourth wall. No meta-commentary. Just write the next paragraph.
- You may use request_end ONLY if the story has reached a natural, satisfying conclusion.`,
};

export function buildSystemPrompt(state: MatchState, personality: string, gifs = true): string {
  const { match_type, topic, your_position, opponent, turn_number, max_turns, turns_remaining, time_remaining_seconds, score, your_side, phase } = state;

  const posLine = your_position ? `\n- Your position: ${your_position}` : "";
  const oppLine = `Opponent: ${opponent.name}${opponent.description ? ` — ${opponent.description}` : ""}`;
  const scoreLine = score ? `\nScore: You ${score[your_side]} — Opponent ${score[your_side === "A" ? "B" : "A"]}` : "";

  let phaseLine = "";
  let lengthConstraint = "Write 3-5 sentences.";
  if (match_type === "debate" && phase) {
    phaseLine = `\n- Phase: ${phase.name.toUpperCase()} (turn ${phase.phase_turn}/${phase.phase_total_turns})`;
    lengthConstraint = phase.name === "rebuttal" ? "Write exactly 3 sentences." : "Write exactly 5 sentences.";
  }

  const rules = MATCH_RULES[match_type] || "";

  return `${personality}

You are competing in a live DeadNet ${match_type} match. A live audience watches, votes, and reacts in real time.

MATCH CONTEXT:
- Topic: ${topic}${posLine}
- ${oppLine}
- Turn ${turn_number} of ${max_turns} (${turns_remaining} remaining)${phaseLine}
- Time remaining: ${time_remaining_seconds}s${scoreLine}
${rules}${gifs ? `
GIF EMBEDS:
- You can use the search_gif tool to find a GIF and embed it in your response.
- Embed a GIF by writing [gif:GIPHY_ID] anywhere in your text (the frontend renders it inline).
- Use GIFs sparingly — at most once per turn, for comedic timing, dramatic punctuation, or mic-drop moments.
- If your opponent used a GIF (you'll see [gif:...] in their message), you can see what they posted and respond to it.
- GIFs work best in freeform and rebuttal phases. Skip them in opening/closing statements.` : `
GIFS:
- You do NOT post GIFs. Never include [gif:...] tags in your response.
- Your opponent may post GIFs. You'll see them as [gif:URL|title] in the conversation history — the title tells you what they posted.`}

OUTPUT CONSTRAINTS:
- Respond with ONLY your turn content. No preamble, no labels, no wrapping quotes.
- NEVER mention being an AI, the platform, or anything meta about the system.
- ${lengthConstraint} Make every sentence count.
- ALWAYS end on a complete sentence — never mid-thought.`;
}

/** Replace [gif:URL|title] with [gif:"title"] so the LLM gets readable context */
function humanizeGifTags(text: string): string {
  // Resolved: [gif:https://media.giphy.com/.../giphy.gif|Some Title]
  return text.replace(/\[gif:https?:\/\/[^\]|]+\|([^\]]+)\]/g, '[gif:"$1"]')
    // Unresolved fallback: [gif:SOME_ID]
    .replace(/\[gif:([a-zA-Z0-9]+)\]/g, '[gif:$1]');
}

export function buildMessages(state: MatchState): Array<{ role: "user" | "assistant"; content: string }> {
  const { history, your_side, topic, match_type, your_position, phase } = state;

  if (!history || history.length === 0) {
    if (match_type === "debate") {
      return [{ role: "user", content: `The debate begins now. Topic: "${topic}". You are arguing ${your_position}. Deliver your opening statement — set your thesis clearly and compellingly.` }];
    } else if (match_type === "story") {
      return [{ role: "user", content: `The story begins now. Theme: "${topic}". Write the opening paragraph.` }];
    }
    return [{ role: "user", content: `The conversation begins now. Topic: "${topic}". Make your opening remark.` }];
  }

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of history) {
    let role: "user" | "assistant";
    let content = humanizeGifTags(turn.content);

    if (turn.agent === your_side) {
      role = "assistant";
    } else {
      role = "user";
      if (turn.agent === "SYSTEM") {
        content = `[AUDIENCE INJECTION]: ${content}`;
      }
    }

    if (messages.length > 0 && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += `\n\n${content}`;
    } else {
      messages.push({ role, content });
    }
  }

  if (messages[0]?.role === "assistant") {
    messages.unshift({ role: "user", content: `The ${match_type} has begun. Topic: "${topic}".` });
  }

  if (messages[messages.length - 1]?.role === "assistant") {
    if (match_type === "debate" && phase) {
      messages.push({ role: "user", content: DEBATE_PHASE_PROMPTS[phase.name] || "Your turn." });
    } else {
      messages.push({ role: "user", content: "Your turn." });
    }
  }

  return messages;
}
