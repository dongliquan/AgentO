/**
 * File type badges as in ReadO (the same table): a short label outlined in the type's color, `·` for the rest.
 * Shown before file names in the Files tree, the file card and the file window's tabs.
 */
const FILE_BADGES: [re: RegExp, label: string, color: string][] = [
  [/\.(java)$/i, 'J', '#b07219'], [/\.(kt|kts)$/i, 'K', '#a97bff'], [/\.(scala|sc)$/i, 'SC', '#c22d40'], [/\.(groovy|gradle)$/i, 'G', '#4298b8'],
  [/\.(tsx)$/i, 'TSX', '#3178c6'], [/\.(ts|mts|cts)$/i, 'TS', '#3178c6'], [/\.(jsx)$/i, 'JSX', '#d4a72c'], [/\.(js|mjs|cjs)$/i, 'JS', '#d4a72c'],
  [/\.(vue)$/i, 'V', '#41b883'], [/\.(svelte)$/i, 'S', '#ff3e00'], [/\.(astro)$/i, 'A', '#ff5d01'],
  [/\.(py|pyi)$/i, 'PY', '#3572a5'], [/\.(go)$/i, 'GO', '#00add8'], [/\.(rs)$/i, 'RS', '#dea584'], [/\.(rb|rake)$/i, 'RB', '#cc342d'],
  [/\.(php)$/i, 'PHP', '#4f5d95'], [/\.(cs)$/i, 'C#', '#178600'], [/\.(c)$/i, 'C', '#555d6b'], [/\.(cpp|cc|cxx|hpp|hh|hxx)$/i, 'C++', '#f34b7d'],
  [/\.(h)$/i, 'H', '#6c7a89'], [/\.(swift)$/i, 'SW', '#f05138'], [/\.(dart)$/i, 'DT', '#00b4ab'],
  [/\.(html?|xhtml|jsp)$/i, '<>', '#e34c26'], [/\.(xml|xsd|xsl|svg)$/i, '<>', '#0060ac'], [/\.(css)$/i, '#', '#563d7c'],
  [/\.(scss|sass)$/i, '#', '#c6538c'], [/\.(less)$/i, '#', '#1d365d'],
  [/\.(json|jsonc)$/i, '{}', '#c9a227'], [/\.(ya?ml)$/i, 'Y', '#cb171e'], [/\.(toml|ini|cfg|conf|properties|env)$/i, 'CF', '#6d8086'],
  [/\.(md|markdown|mdx)$/i, 'M', '#519aba'], [/\.(sql)$/i, 'DB', '#e38c00'], [/\.(sh|bash|zsh)$/i, '$', '#4eaa25'],
  [/\.(bat|cmd|ps1|psm1)$/i, '>', '#3f8bd1'], [/\.(log)$/i, 'LG', '#8b949e'], [/\.(txt|text)$/i, 'TX', '#8b949e'],
  [/\.(csv|tsv)$/i, 'CS', '#2ea043'], [/\.(xlsx?|xlsm)$/i, 'XL', '#1d6f42'], [/\.(docx?)$/i, 'W', '#2b579a'], [/\.(pptx?)$/i, 'PP', '#d24726'],
  [/\.(lock)$/i, 'LK', '#8b949e'], [/(^|\/)dockerfile$/i, 'DK', '#2496ed'],
  [/(^|\/)(makefile|cmakelists\.txt)$/i, 'MK', '#6d8086'], [/(^|\/)\.git(ignore|attributes|modules)$/i, 'GT', '#f14e32'],
  [/\.(png|jpe?g|gif|bmp|ico|webp)$/i, 'IM', '#a074c4'], [/\.(pdf|zip|jar|war|exe|dll|class|so)$/i, 'BN', '#8b949e']
];

export function FileIcon({ name }: { name: string }): JSX.Element {
  for (const [re, label, color] of FILE_BADGES) {
    if (re.test(name)) {
      return (
        <span className="ficon fbadge" style={{ '--c': color } as React.CSSProperties} aria-hidden="true">
          {label}
        </span>
      );
    }
  }
  return (
    <span className="ficon fbadge plain" style={{ '--c': '#8b949e' } as React.CSSProperties} aria-hidden="true">
      ·
    </span>
  );
}
