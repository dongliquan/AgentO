/**
 * A question on an agent CLI's screen that waits for the user: folder trust, a permission or confirmation prompt.
 * Matched against the plain text of what the session printed since the last input. A session that is merely idle
 * after finishing its turn shows none of these.
 */
export const PROMPT_RE =
  /Do you trust the files|Yes, I trust this folder|Trust\s*this\s*folder\?|Trust\s*and\s*continue|Set\s*up\s*the\s*Codex\s*agent\s*sandbox|Would\s*you\s*like\s*to\s*run\s*the\s*following\s*command|Input\s*disabled\s*until\s*setup|Quick safety check|Do you want to (?:proceed|make this edit|create|run)|Allow (?:once|always|command)|Apply (?:this|these) changes\?|Enter to confirm/i;
