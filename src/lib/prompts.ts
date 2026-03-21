import type { MatchState } from "./types.js";

export const DEBATE_PHASE_PROMPTS: Record<string, string> = {
  opening: "Deliver your opening statement. Set your thesis clearly and compellingly. This is your first impression — make it count.",
  rebuttal: "Your rebuttal. Counter your opponent's strongest point directly, then advance a new argument. Be sharp and specific.",
  closing: "Deliver your closing statement. Summarize your strongest case. This is your last word — leave the audience convinced.",
};

const MATCH_RULES: Record<string, string> = {
  debate: `DEBATE RULES (Oxford Format — 3 phases, 10 turns):
- OPENING (turns 1-2): One statement each. Set your thesis. 150 token budget.
- REBUTTAL (turns 3-8): Three exchanges each. Attack, defend, counter. 100 token budget.
- CLOSING (turns 9-10): One statement each. Summarize your case. 150 token budget.
- You are assigned FOR or AGAINST. Argue with total conviction — NEVER concede or agree.
- Address your opponent directly with "you" — talk TO them, not ABOUT them.
- Use specific examples, analogies, data, historical precedent, and rhetorical devices.
- Vary your approach: logic, humor, irony, emotional weight, reductio ad absurdum.
- The audience votes continuously. Persuasion wins, not politeness.
- Matches always run to completion. NEVER use request_end — it is blocked for debate.`,

  freeform: `FREEFORM RULES:
- No assigned positions. Have a genuine, surprising conversation.
- 100 token budget per turn — one sharp idea per response. Quality over quantity.
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

  const budget = state.token_budget_this_turn;

  let phaseLine = "";
  let lengthConstraint = `Write 3-5 sentences. Stay under ${budget} tokens.`;
  if (match_type === "debate" && phase) {
    phaseLine = `\n- Phase: ${phase.name.toUpperCase()} (turn ${phase.phase_turn}/${phase.phase_total_turns})`;
    lengthConstraint = phase.name === "rebuttal"
      ? `Write exactly 3 concise sentences. Stay under ${budget} tokens.`
      : `Write exactly 5 sentences. Stay under ${budget} tokens.`;
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
- Embed a GIF by writing [gif:your search query] anywhere in your text — the backend resolves it automatically.
- Be specific and descriptive so the first result is right (e.g. [gif:michael scott no god please], [gif:explosion mushroom cloud], [gif:mic drop walk away]).
- Use at most once per turn, for comedic timing, dramatic punctuation, or mic-drop moments.
- If your opponent used a GIF (you'll see [gif:URL|title] in their message), the title tells you what they posted.
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

export function buildGamePrompt(gameState: any, personality: string, yourSide: string, opponentName: string): string {
  const boardRender: string = gameState.board_render || "(board unavailable)";
  const validMoves: number[] = gameState.valid_moves || [];
  const moveNumber: number = gameState.move_number || 1;

  return `${personality}

You are playing Drop4 (Connect Four) in a live DeadNet match. A live audience watches.

DROP4 RULES:
- 6 rows × 7 columns grid. Pieces fall to the lowest empty row in the chosen column.
- First to connect 4 in a row (horizontal, vertical, or diagonal) wins.
- You are Player ${yourSide}. Opponent: ${opponentName}.
- Move ${moveNumber}.

CURRENT BOARD:
${boardRender}
Valid columns: ${validMoves.join(", ")}

RESPONSE FORMAT:
Respond with ONLY a JSON object on a single line.
Without a message: {"column": N}
With a message (optional, max 20 words, shown to the audience): {"column": N, "message": "..."}

Make the message dramatic, taunting, or witty if you include one.
Pick the strategically best column. Respond with ONLY the JSON — no other text.`;
}

/** Replace [gif:URL|title] with [gif:"title"] so the LLM gets readable context */
function humanizeGifTags(text: string): string {
  // Resolved: [gif:https://media.giphy.com/.../giphy.gif|Some Title]
  return text.replace(/\[gif:https?:\/\/[^\]|]+\|([^\]]+)\]/g, '[gif:"$1"]')
    // Unresolved fallback: [gif:SOME_ID]
    .replace(/\[gif:([a-zA-Z0-9]+)\]/g, '[gif:$1]');
}

export function buildMessages(
  state: MatchState,
  options?: { contextWindow?: number },
): Array<{ role: "user" | "assistant"; content: string }> {
  const { history, your_side, topic, match_type, your_position, phase } = state;

  if (!history || history.length === 0) {
    if (match_type === "debate") {
      return [{ role: "user", content: `The debate begins now. Topic: "${topic}". You are arguing ${your_position}. Deliver your opening statement — set your thesis clearly and compellingly.` }];
    } else if (match_type === "story") {
      return [{ role: "user", content: `The story begins now. Theme: "${topic}". Write the opening paragraph.` }];
    }
    return [{ role: "user", content: `The conversation begins now. Topic: "${topic}". Make your opening remark.` }];
  }

  // Trim history to the most recent N entries when a window is set.
  // We still anchor the first user message so Claude always has match context.
  const window = options?.contextWindow;
  const trimmedHistory = window && history.length > window ? history.slice(-window) : history;
  const isTrimmed = trimmedHistory !== history;

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  // When we've trimmed, inject a short anchor so the model knows what came before.
  if (isTrimmed) {
    messages.push({ role: "user", content: `The ${match_type} is underway. Topic: "${topic}". Earlier turns have been omitted — focus on what follows.` });
  }

  for (const turn of trimmedHistory) {
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
