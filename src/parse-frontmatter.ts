/**
 * Minimal frontmatter parser.
 *
 * Supports a deliberate YAML subset only — enough for atomic sheets, small
 * enough to stay deterministic and dependency-free:
 *   - scalars: strings (optionally quoted), numbers, booleans
 *   - inline arrays: [a, b, "c d"]
 *   - multiline strings: `key: |` (indented block, joined with \n)
 *   - `#` comment lines
 * Unknown syntax is a hard error with file + line context.
 *
 * Why not a YAML library: the contract only needs this subset, and a hard
 * error on anything else is a feature — it keeps atoms uniform and machine
 * round-trippable. See LIMITATIONS.md before reaching for js-yaml.
 */

export interface FrontmatterResult {
  data: Record<string, unknown>
  body: string
}

const ARRAY_PATTERN = /^\[(.*)]$/

function parseScalar(raw: string): unknown {
  const value = raw.trim()
  if (value === '') return ''
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
    return value.slice(1, -1)
  }
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return value
}

function parseInlineArray(raw: string): unknown[] {
  const inner = raw.trim().slice(1, -1)
  if (!inner.trim()) return []
  const items: Array<{ text: string, quoted: boolean }> = []
  let current = ''
  let quoted = false
  let quote: string | null = null
  const pushItem = () => {
    if (current.trim() === '' && !quoted) return
    items.push({ text: current, quoted })
    current = ''
    quoted = false
  }
  for (const char of inner) {
    if (quote) {
      // Quotes only guard commas and force string typing — they are stripped.
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === '\'') {
      quote = char
      quoted = true
      continue
    }
    if (char === ',') {
      pushItem()
      continue
    }
    current += char
  }
  pushItem()
  return items.map((item) => (item.quoted ? item.text.trim() : parseScalar(item.text)))
}

/**
 * Parse `---\nfrontmatter\n---\nbody` markdown.
 * @throws Error with line context when delimiters or entries are malformed.
 */
export function parseFrontmatter(fileContent: string, filePath?: string): FrontmatterResult {
  const fail = (message: string, line?: number): never => {
    throw new Error(`${filePath ?? 'file'}${line ? `:${line}` : ''}: ${message}`)
  }

  // Strip a UTF-8 BOM and a leading HTML comment banner (generated files carry
  // a "do not hand-edit" marker above the frontmatter).
  let normalized = fileContent.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const banner = /^<!--[\s\S]*?-->\n/.exec(normalized)
  if (banner) normalized = normalized.slice(banner[0].length)

  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') {
    fail('missing frontmatter — must start with "---" on line 1')
  }

  const closeLine = lines.slice(1).findIndex((line) => line.trim() === '---')
  if (closeLine === -1) {
    fail('unterminated frontmatter — no closing "---"')
  }
  const closeIndex = closeLine + 1

  const data: Record<string, unknown> = {}
  let index = 1
  while (index < closeIndex) {
    const line = lines[index]!
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      index++
      continue
    }
    const separator = line.indexOf(':')
    if (separator === -1 || line.startsWith(' ') || line.startsWith('\t')) {
      fail(`malformed frontmatter entry "${trimmed}" (expected "key: value")`, index + 1)
    }
    const key = line.slice(0, separator).trim()
    const rest = line.slice(separator + 1).trim()

    if (rest === '|' || rest === '|-') {
      const blockLines: string[] = []
      index++
      while (index < closeIndex) {
        const blockLine = lines[index]!
        if (blockLine.trim() !== '' && !blockLine.startsWith(' ')) break
        blockLines.push(blockLine.replace(/^ {2}/, ''))
        index++
      }
      while (blockLines.length > 0 && blockLines.at(-1)!.trim() === '') blockLines.pop()
      data[key] = blockLines.join('\n')
      continue
    }

    if (ARRAY_PATTERN.test(rest)) {
      data[key] = parseInlineArray(rest)
    } else {
      data[key] = parseScalar(rest)
    }
    index++
  }

  const body = lines.slice(closeIndex + 1).join('\n').trim()
  return { data, body }
}
