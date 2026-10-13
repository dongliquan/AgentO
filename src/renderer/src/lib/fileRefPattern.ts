/** An inline-code text that names a file: a path or a file name with a known extension, optionally ":line(-line)". */
const FILE_RE =
  /^(?:[A-Za-z]:[\\/])?[^\s`'"<>|*?]*?[^\s`'"<>|*?\\/]\.(md|markdown|ts|tsx|mts|js|jsx|mjs|cjs|vue|json|jsonc|py|java|kt|kts|groovy|gradle|go|rs|cs|c|h|cpp|css|scss|less|html|htm|xml|yml|yaml|toml|ini|properties|env|sql|txt|log|csv|tsv|xlsx|xls|docx|pptx|pdf|sh|ps1|bat|cmd|png|jpg|jpeg|gif|svg|webp)(?::\d+(?:[-~]\d+)?)?$/i;

export function isFileRef(text: string): boolean {
  return text.length <= 260 && FILE_RE.test(text.trim());
}

