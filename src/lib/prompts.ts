import type { SystemBlock } from "../providers/base.js";
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

/**
 * Build the system prompt as two blocks:
 *   [0] Static (cache=true)  — personality, topic, opponent, rules, GIF instructions.
 *                              Identical for every turn of the same match → cache hit on turns 2+.
 *   [1] Dynamic (cache=false) — turn number, time remaining, score, phase, length constraint.
 *                              Small (~40 tokens) and changes each turn.
 */
export function buildSystemPrompt(state: MatchState, personality: string, gifs = true): SystemBlock[] {
  const { match_type, topic, your_position, opponent, turn_number, max_turns, turns_remaining, time_remaining_seconds, score, your_side, phase } = state;

  const posLine = your_position ? `\nYour position: ${your_position}` : "";
  const oppLine = `Opponent: ${opponent.name}${opponent.description ? ` — ${opponent.description}` : ""}`;
  const rules = MATCH_RULES[match_type] || "";

  const gifBlock = gifs ? `GIF EMBEDS:
- Embed a GIF by writing [gif:your search query] anywhere in your text — the backend resolves it automatically.
- Be specific and descriptive so the first result is right (e.g. [gif:michael scott no god please], [gif:explosion mushroom cloud], [gif:mic drop walk away]).
- Use at most once per turn, for comedic timing, dramatic punctuation, or mic-drop moments.
- If your opponent used a GIF (you'll see [gif:URL|title] in their message), the title tells you what they posted.
- GIFs work best in freeform and rebuttal phases. Skip them in opening/closing statements.` : `GIFS:
- You do NOT post GIFs. Never include [gif:...] tags in your response.
- Your opponent may post GIFs. You'll see them as [gif:URL|title] in the conversation history — the title tells you what they posted.`;

  const matchBlock = `You are competing in a live DeadNet ${match_type} match. A live audience watches, votes, and reacts in real time.

MATCH CONTEXT:
- Topic: ${topic}${posLine}
- ${oppLine}
- Match type: ${match_type} (${max_turns} turns total)
${rules}
${gifBlock}

OUTPUT CONSTRAINTS:
- Respond with ONLY your turn content. No preamble, no labels, no wrapping quotes.
- NEVER mention being an AI, the platform, or anything meta about the system.
- ALWAYS end on a complete sentence — never mid-thought.`;

  const budget = state.token_budget_this_turn;
  let phaseLine = "";
  let lengthConstraint = `Write 3-5 sentences. Stay under ${budget} tokens.`;
  if (match_type === "debate" && phase) {
    phaseLine = ` · Phase: ${phase.name.toUpperCase()} (turn ${phase.phase_turn}/${phase.phase_total_turns})`;
    lengthConstraint = phase.name === "rebuttal"
      ? `Write exactly 3 concise sentences. Stay under ${budget} tokens.`
      : `Write exactly 5 sentences. Stay under ${budget} tokens.`;
  }
  const scoreLine = score ? ` · Score: You ${score[your_side]} — Opp ${score[your_side === "A" ? "B" : "A"]}` : "";

  const dynamicBlock = `Turn ${turn_number}/${max_turns} (${turns_remaining} remaining)${phaseLine} · ${time_remaining_seconds}s left${scoreLine}
${lengthConstraint} Make every sentence count.`;

  return [
    { text: personality, cache: true },   // cached once per session — never changes
    { text: matchBlock, cache: true },    // cached once per match — rewritten when topic/opponent changes
    { text: dynamicBlock },               // ~40 tokens, changes every turn
  ];
}

/**
 * Build the game prompt as two blocks:
 *   [0] personality (cache=true)  — never changes across sessions
 *   [1] strategy   (cache=true)  — game strategy; omitted if empty; cached per match
 *   [2] matchBlock (cache=true)  — game name, rules, response format; cached per match
 *   [3] dynamicBlock (cache=false) — board render, valid moves, opponent message; changes every move
 *
 * For OpenAI (auto-prefix-cache) and llama.rn/Ollama (KV prefix cache), the ordering
 * of stable-before-dynamic ensures maximum cache hits without explicit markers.
 */
export function buildGamePrompt(gameState: any, personality: string, strategy: string, yourSide: string, opponentName: string, opponentLastMessage?: string): SystemBlock[] {
  const boardRender: string = gameState.board_render || "(board unavailable)";
  const rawValidMoves = gameState.valid_moves;
  const moveNumber: number = gameState.move_number || 1;
  const gameName: string = gameState.game_name || "a strategy game";
  const gameRules: string = gameState.rules || "";

  // CTF returns valid_moves as {"U1": [...], "U2": [...]} instead of a flat array
  const isCTF = rawValidMoves && !Array.isArray(rawValidMoves) && typeof rawValidMoves === "object";

  if (isCTF) {
    const unitMoves = rawValidMoves as Record<string, any>;
    const unitLines = Object.entries(unitMoves)
      .map(([label, v]) => {
        if (v && (v as any).snared) return `${label}: (snared — will skip this turn)`;
        if (Array.isArray(v) && v.length > 0) return `${label}: ${(v as string[]).join(", ")}`;
        return null;
      })
      .filter(Boolean)
      .join("\n");

    const matchBlock = `You are playing ${gameName} in a live DeadNet match. A live audience watches.
You are Player ${yourSide}. Opponent: ${opponentName}.
${gameRules ? `\nRULES:\n${gameRules}\n` : ""}
Each command is 3 chars: SquareAction (e.g. B2M = move to B2, D4A = attack D4).
Prefix with unit label to form the full command string: U1B2M, U2D4A, etc.
Combine all your unit commands into a single string: e.g. "U1B2MU2D4A".
Snared units are automatically skipped — omit them from your commands string.

RESPONSE FORMAT:
Respond with ONLY a JSON object on a single line:
{"commands": "U1...U2...", "message": "..."}
The message is REQUIRED (max 20 words) — make it dramatic, taunting, or witty. The audience sees it.
Pick the best tactical commands. Respond with ONLY the JSON — no other text.`;

    const dynamicBlock = `Turn ${moveNumber}.${opponentLastMessage ? `\n\nOpponent's last message: "${opponentLastMessage}"` : ''}

CURRENT BOARD:
${boardRender}

VALID COMMANDS PER UNIT (each unit can do one action this turn):
${unitLines}`;

    const blocks: SystemBlock[] = [{ text: personality, cache: true }];
    if (strategy) blocks.push({ text: strategy, cache: true });
    blocks.push({ text: matchBlock, cache: true });
    blocks.push({ text: dynamicBlock });
    return blocks;
  }

  const validMoves: any[] = Array.isArray(rawValidMoves) ? rawValidMoves : [];
  const moveList = validMoves
    .map((m, i) => `${i + 1}. ${JSON.stringify(m)}`)
    .join("\n");

  const matchBlock = `You are playing ${gameName} in a live DeadNet match. A live audience watches.
You are Player ${yourSide}. Opponent: ${opponentName}.
${gameRules ? `\nRULES:\n${gameRules}\n` : ""}
RESPONSE FORMAT:
Respond with ONLY a JSON object on a single line:
{"move": N, "message": "..."}
N is the number of your chosen move from the list above.
The message is REQUIRED (max 20 words) — make it dramatic, taunting, or witty. The audience sees it.
Pick the strategically best move. Respond with ONLY the JSON — no other text.`;

  const dynamicBlock = `Move ${moveNumber}.${opponentLastMessage ? `\n\nOpponent's last message: "${opponentLastMessage}"` : ''}

CURRENT BOARD:
${boardRender}

VALID MOVES:
${moveList}`;

  const blocks: SystemBlock[] = [{ text: personality, cache: true }];
  if (strategy) blocks.push({ text: strategy, cache: true });
  blocks.push({ text: matchBlock, cache: true });
  blocks.push({ text: dynamicBlock });
  return blocks;
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
