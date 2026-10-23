/**
 * A question on an agent CLI's screen that waits for the user: folder trust, a permission or confirmation prompt.
 * Matched against the plain text of what the session printed since the last input. A session that is merely idle
 * after finishing its turn shows none of these.
 */
export const PROMPT_RE =
  /Do you trust the files|Yes, I trust this folder|Trust\s*this\s*folder\?|Trust\s*and\s*continue|Set\s*up\s*the\s*Codex\s*agent\s*sandbox|Would\s*you\s*like\s*to\s*run\s*the\s*following\s*command|Input\s*disabled\s*until\s*setup|Quick safety check|Do you want to (?:proceed|make this edit|create|run)|Allow (?:once|always|command)|Apply (?:this|these) changes\?|Enter to confirm|Enter to continue|Teach auto mode/i;

/**
 * Claude Code paused by the subscription's usage limit ("Usage limit reached · continuing automatically at 2pm",
 * "You've hit your weekly limit · resets 2pm"): not a question — the session goes on by itself when the limit resets.
 */
export const LIMIT_RE = /Usage limit reached|hit your (?:weekly |daily |5-hour |session )?limit/i;

/** When the limit resets, as that screen says it ("2pm (Asia/Seoul)"). */
export function limitResetText(screen: string): string | undefined {
  const m = /(?:resets?|continuing automatically at)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*\([^)]+\))?)/i.exec(screen);
  return m?.[1]?.trim();
}
