import { createMarkdownProcessor, type MarkdownProcessor } from "@astrojs/markdown-remark"
import { type CollectionEntry, getCollection } from "astro:content"
import GithubSlugger from "github-slugger"
import { filterPublishedEntries, isPublishedContent } from "@lib/content"

type RichTextEntry =
  | CollectionEntry<"blog">
  | CollectionEntry<"projects">
  | CollectionEntry<"legal">
  | CollectionEntry<"work">

type PublishedEntry =
  | CollectionEntry<"blog">
  | CollectionEntry<"projects">
  | CollectionEntry<"legal">
  | CollectionEntry<"work">

type RenderContext = {
  currentEntry?: RichTextEntry
  depth: number
  visited: Set<string>
}

type LinkIndexEntry = {
  entry: PublishedEntry
  route: string
  title: string
  candidates: string[]
}

const MAX_EMBED_DEPTH = 3
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"])
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "wav"])
const VIDEO_EXTENSIONS = new Set(["mov", "mp4", "m4v", "ogv", "webm"])
const PDF_EXTENSIONS = new Set(["pdf"])

let processorPromise: Promise<MarkdownProcessor> | undefined
let linkIndexPromise: Promise<LinkIndexEntry[]> | undefined

function getMarkdownProcessor() {
  processorPromise ??= createMarkdownProcessor()
  return processorPromise
}

function getEntryVisitKey(entry: RichTextEntry, fragment = "") {
  return `${entry.collection}:${entry.id}#${fragment}`
}

function getEntryBaseName(entry: RichTextEntry | PublishedEntry) {
  return entry.id
    .replace(/\.[^.]+$/, "")
    .replace(/\/index$/i, "")
    .split("/")
    .filter(Boolean)
    .at(-1) ?? entry.slug
}

function getWorkEntryAnchor(entry: CollectionEntry<"work">) {
  return `journey-${normalizeLookupKey(getEntryBaseName(entry))}`
}

export function getEntryHref(entry: RichTextEntry | PublishedEntry) {
  if (entry.collection === "work") {
    return `/journey#${getWorkEntryAnchor(entry)}`
  }

  return `/${entry.collection}/${entry.slug}`
}

function getEntryTitle(entry: PublishedEntry) {
  if ("title" in entry.data) return entry.data.title
  return entry.data.company
}

function normalizeLookupKey(value: string) {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\.[^.]+$/, "")
    .replace(/\/index$/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
}

function getHeadingSlug(value: string) {
  const slugger = new GithubSlugger()
  return slugger.slug(value.trim())
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("'", "&#39;")
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function sanitizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("#")) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      return parsed.toString()
    }
  } catch {
    return null
  }

  return null
}

function sanitizeColor(value: string) {
  const trimmed = value.trim()
  return /^[#(),.%\-\sA-Za-z0-9]+$/.test(trimmed) ? trimmed : null
}

function sanitizeSize(value: string) {
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return `${trimmed}px`
  if (/^\d+(\.\d+)?(px|em|rem|%|vh|vw)$/.test(trimmed)) return trimmed
  return null
}

function sanitizeFontFamily(value: string) {
  const trimmed = value.trim()
  return /^[\w\s",-]+$/.test(trimmed) ? trimmed : null
}

function sanitizeBlockId(value: string) {
  const trimmed = value.trim()
  return /^[A-Za-z0-9-]+$/.test(trimmed) ? trimmed : null
}

function normalizeAssetPath(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  const hashIndex = trimmed.indexOf("#")
  const pathPart = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed
  const hashPart = hashIndex >= 0 ? trimmed.slice(hashIndex) : ""

  if (sanitizeUrl(trimmed)) return trimmed
  if (!pathPart) return null

  const normalized = pathPart.replace(/^\/+/, "")
  return `/${encodeURI(normalized)}${hashPart}`
}

function getFileExtension(value: string) {
  const cleaned = value.replace(/[#?].*$/, "")
  const extension = cleaned.split(".").at(-1)?.toLowerCase()
  return extension ?? ""
}

function isMediaTarget(value: string) {
  const extension = getFileExtension(value)
  return IMAGE_EXTENSIONS.has(extension) || AUDIO_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension) || PDF_EXTENSIONS.has(extension)
}

function parseEmbedSize(raw?: string) {
  if (!raw) return {}

  const trimmed = raw.trim()
  if (!trimmed) return {}

  const match = /^(\d+)(?:x(\d+))?$/.exec(trimmed)
  if (!match) return {}

  const width = match[1]
  const height = match[2]
  return {
    width: width ? Number(width) : undefined,
    height: height ? Number(height) : undefined,
  }
}

function styleFromDimensions(dimensions: { width?: number, height?: number }) {
  const parts = [
    dimensions.width ? `width:${dimensions.width}px` : "",
    dimensions.height ? `height:${dimensions.height}px` : "",
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(";") : null
}

function getEmbedTargetParts(value: string) {
  const [pathPart, ...fragmentParts] = value.split("#")
  return {
    note: pathPart.trim(),
    fragment: fragmentParts.join("#").trim(),
  }
}

function getFragmentAnchor(fragment: string) {
  if (!fragment) return ""
  if (fragment.startsWith("^")) {
    const blockId = sanitizeBlockId(fragment.slice(1))
    return blockId ? blockId : ""
  }

  const heading = fragment.split("#").filter(Boolean).at(-1) ?? fragment
  return getHeadingSlug(heading)
}

function formatFragmentTitle(fragment: string) {
  if (!fragment) return ""
  if (fragment.startsWith("^")) return `Block ${fragment}`
  return fragment.split("#").filter(Boolean).at(-1) ?? fragment
}

function createPlaceholderStore(prefix: string) {
  const values: string[] = []

  return {
    token(index: number) {
      return `${prefix}${index}ZZ`
    },
    create(value: string) {
      const token = `${prefix}${values.length}ZZ`
      values.push(value)
      return token
    },
    restore(input: string) {
      return input.replace(new RegExp(`${escapeRegExp(prefix)}(\\d+)ZZ`, "g"), (_, index) => values[Number(index)] ?? "")
    },
    values,
  }
}

function restoreHtmlPlaceholders(input: string, store: ReturnType<typeof createPlaceholderStore>) {
  return store.values.reduce((html, value, index) => {
    const token = store.token(index)
    return html
      .replace(new RegExp(`<p>${escapeRegExp(token)}</p>`, "g"), value)
      .replaceAll(token, value)
  }, input)
}

function wrapCodeFence(content: string, language?: string) {
  const normalized = content.replace(/^\n+|\n+$/g, "")
  const longestFence = Math.max(...Array.from(normalized.matchAll(/`+/g), (match) => match[0].length), 2)
  const fence = "`".repeat(longestFence + 1)
  const lang = language?.trim().replace(/[^\w#+.-]/g, "") ?? ""
  return `\n${fence}${lang}\n${normalized}\n${fence}\n`
}

function replaceUntilStable(input: string, replacer: (value: string) => string) {
  let output = input

  while (true) {
    const next = replacer(output)
    if (next === output) return output
    output = next
  }
}

function replaceTagPair(
  input: string,
  tag: string,
  render: (content: string, option?: string) => string,
) {
  const pattern = new RegExp(`\\[${tag}(?:=([^\\]]+))?\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "gi")
  return replaceUntilStable(input, (value) =>
    value.replace(pattern, (_, option: string | undefined, content: string) => render(content, option)),
  )
}

function replaceSimpleTag(input: string, tag: string, htmlTag: string) {
  return replaceTagPair(input, tag, (content) => `<${htmlTag}>${normalizeBbcode(content)}</${htmlTag}>`)
}

function renderList(content: string, option?: string) {
  const rawItems = content
    .split(/\[\*\]/i)
    .map((item) => item.trim())
    .filter(Boolean)

  const items = rawItems.length > 0 ? rawItems : [content.trim()].filter(Boolean)
  const type = option?.trim()

  if (items.length === 0) return ""

  if (type && ["1", "a", "A", "i", "I"].includes(type)) {
    return `<ol type="${type}">${items.map((item) => `<li>${normalizeBbcode(item)}</li>`).join("")}</ol>`
  }

  return `<ul>${items.map((item) => `<li>${normalizeBbcode(item)}</li>`).join("")}</ul>`
}

function normalizeBbcode(input: string): string {
  let output = input

  output = replaceTagPair(output, "code", (content, option) => wrapCodeFence(content, option))
  output = replaceTagPair(output, "quote", (content, option) => {
    const author = option?.trim()
    const heading = author ? `<p><strong>${escapeHtml(author)} wrote:</strong></p>\n` : ""
    return `\n<blockquote>\n${heading}${normalizeBbcode(content).trim()}\n</blockquote>\n`
  })
  output = replaceTagPair(output, "list", (content, option) => `\n${renderList(content, option)}\n`)
  output = replaceTagPair(output, "center", (content) => `\n<div class="bbcode-align-center">\n${normalizeBbcode(content).trim()}\n</div>\n`)
  output = replaceTagPair(output, "left", (content) => `\n<div class="bbcode-align-left">\n${normalizeBbcode(content).trim()}\n</div>\n`)
  output = replaceTagPair(output, "right", (content) => `\n<div class="bbcode-align-right">\n${normalizeBbcode(content).trim()}\n</div>\n`)

  for (const level of [1, 2, 3, 4, 5, 6]) {
    output = replaceTagPair(output, `h${level}`, (content) => `<h${level}>${normalizeBbcode(content)}</h${level}>`)
  }

  output = output
    .replace(/\[hr\s*\/?\]/gi, "\n<hr />\n")
    .replace(/\[br\s*\/?\]/gi, "<br />")

  output = replaceTagPair(output, "url", (content, option) => {
    const href = sanitizeUrl(option ?? content)
    const label = normalizeBbcode(content).trim() || escapeHtml(content.trim())
    if (!href) return label
    return `<a href="${escapeHtml(href)}">${label}</a>`
  })

  output = replaceTagPair(output, "email", (content, option) => {
    const email = (option ?? content).trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return escapeHtml(content.trim())
    const label = normalizeBbcode(content).trim() || escapeHtml(email)
    return `<a href="mailto:${escapeHtml(email)}">${label}</a>`
  })

  output = replaceTagPair(output, "img", (content) => {
    const src = sanitizeUrl(content)
    return src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" />` : escapeHtml(content.trim())
  })

  output = replaceSimpleTag(output, "b", "strong")
  output = replaceSimpleTag(output, "i", "em")
  output = replaceSimpleTag(output, "u", "u")
  output = replaceSimpleTag(output, "s", "del")
  output = replaceSimpleTag(output, "strike", "del")
  output = replaceSimpleTag(output, "sup", "sup")
  output = replaceSimpleTag(output, "sub", "sub")
  output = replaceTagPair(output, "spoiler", (content) => `<span class="bbcode-spoiler">${normalizeBbcode(content)}</span>`)
  output = replaceTagPair(output, "color", (content, option) => {
    const color = option ? sanitizeColor(option) : null
    return color
      ? `<span style="color:${escapeHtml(color)}">${normalizeBbcode(content)}</span>`
      : normalizeBbcode(content)
  })
  output = replaceTagPair(output, "size", (content, option) => {
    const size = option ? sanitizeSize(option) : null
    return size
      ? `<span style="font-size:${escapeHtml(size)}">${normalizeBbcode(content)}</span>`
      : normalizeBbcode(content)
  })
  output = replaceTagPair(output, "font", (content, option) => {
    const family = option ? sanitizeFontFamily(option) : null
    return family
      ? `<span style="font-family:${escapeHtml(family)}">${normalizeBbcode(content)}</span>`
      : normalizeBbcode(content)
  })

  return output
    .replace(/\[table\]/gi, "<table>")
    .replace(/\[\/table\]/gi, "</table>")
    .replace(/\[tr\]/gi, "<tr>")
    .replace(/\[\/tr\]/gi, "</tr>")
    .replace(/\[th\]/gi, "<th>")
    .replace(/\[\/th\]/gi, "</th>")
    .replace(/\[td\]/gi, "<td>")
    .replace(/\[\/td\]/gi, "</td>")
}

function replaceInlineHighlights(input: string) {
  return input.replace(/==([^=\n][\s\S]*?[^=\n])==/g, "<mark>$1</mark>")
}

function stripComments(input: string) {
  return input.replace(/%%[\s\S]*?%%/g, "")
}

function extractBlockMarkdown(source: string, blockId: string) {
  const lines = source.split("\n")
  const inlinePattern = new RegExp(`(?:^|\\s)\\^${escapeRegExp(blockId)}\\s*$`)
  const linePattern = new RegExp(`^\\^${escapeRegExp(blockId)}\\s*$`)

  for (let index = 0; index < lines.length; index += 1) {
    if (!inlinePattern.test(lines[index]) && !linePattern.test(lines[index].trim())) continue

    let start = index
    while (start > 0 && lines[start - 1].trim() !== "") {
      start -= 1
    }

    let end = index
    while (end + 1 < lines.length && lines[end + 1].trim() !== "") {
      end += 1
    }

    return lines
      .slice(start, end + 1)
      .join("\n")
      .replace(new RegExp(`\\s*\\^${escapeRegExp(blockId)}\\s*$`, "gm"), "")
      .trim()
  }

  return null
}

function extractHeadingMarkdown(source: string, heading: string) {
  const lines = source.split("\n")
  const target = heading.split("#").filter(Boolean).at(-1)?.trim()
  if (!target) return null

  let inFence = false
  let start = -1
  let level = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (/^(```|~~~)/.test(line.trim())) {
      inFence = !inFence
      continue
    }

    if (inFence) continue

    const match = /^(#{1,6})\s+(.*?)\s*$/.exec(line)
    if (!match) continue

    const headingText = match[2].replace(/\s+#+\s*$/, "").trim()
    if (start === -1 && headingText === target) {
      start = index + 1
      level = match[1].length
      continue
    }

    if (start !== -1 && match[1].length <= level) {
      return lines.slice(start, index).join("\n").trim()
    }
  }

  if (start !== -1) {
    return lines.slice(start).join("\n").trim()
  }

  return null
}

async function getLinkIndex() {
  if (linkIndexPromise) return linkIndexPromise

  linkIndexPromise = (async () => {
    const [blog, projects, legal, work] = await Promise.all([
      getCollection("blog"),
      getCollection("projects"),
      getCollection("legal"),
      getCollection("work"),
    ])

    const publishedEntries: PublishedEntry[] = [
      ...filterPublishedEntries(blog),
      ...filterPublishedEntries(projects),
      ...legal,
      ...work,
    ]

    return publishedEntries.map((entry) => {
      const title = getEntryTitle(entry)
      const baseName = getEntryBaseName(entry)
      const route = getEntryHref(entry)

      return {
        entry,
        route,
        title,
        candidates: [
          normalizeLookupKey(entry.id),
          normalizeLookupKey(baseName),
          normalizeLookupKey(entry.slug),
          normalizeLookupKey(`${entry.collection}/${entry.slug}`),
          normalizeLookupKey(title),
          normalizeLookupKey(`${entry.collection}/${title}`),
        ],
      }
    })
  })()

  return linkIndexPromise
}

async function resolveInternalEntry(target: string, currentEntry?: RichTextEntry) {
  if (!target && currentEntry) {
    return {
      entry: currentEntry,
      href: getEntryHref(currentEntry),
      title: "title" in currentEntry.data ? currentEntry.data.title : currentEntry.data.company,
    }
  }

  const lookup = normalizeLookupKey(decodeURIComponent(target))
  if (!lookup) return null

  const entries = await getLinkIndex()
  const match = entries.find((entry) => entry.candidates.includes(lookup))
  if (!match) return null

  if ("status" in match.entry.data && !isPublishedContent(match.entry.data)) {
    return null
  }

  return {
    entry: match.entry,
    href: match.route,
    title: match.title,
  }
}

function renderCalloutHtml(type: string, title: string, bodyHtml: string, fold: string) {
  const titleHtml = `
    <div class="obsidian-callout-title">
      <span class="obsidian-callout-icon" aria-hidden="true"></span>
      <span class="obsidian-callout-label">${escapeHtml(title)}</span>
    </div>
  `.trim()

  if (fold === "+" || fold === "-") {
    const open = fold === "+" ? " open" : ""
    return `
      <details class="obsidian-callout" data-callout="${escapeAttribute(type)}"${open}>
        <summary>${titleHtml}</summary>
        <div class="obsidian-callout-content">${bodyHtml}</div>
      </details>
    `.trim()
  }

  return `
    <aside class="obsidian-callout" data-callout="${escapeAttribute(type)}">
      ${titleHtml}
      <div class="obsidian-callout-content">${bodyHtml}</div>
    </aside>
  `.trim()
}

function renderUnresolvedLink(label: string) {
  return `<span class="obsidian-unresolved">${escapeHtml(label)}</span>`
}

function renderMediaEmbedHtml(target: string, size?: string, label?: string) {
  const extension = getFileExtension(target)
  const source = normalizeAssetPath(target)
  if (!source) return renderUnresolvedLink(target)

  const dimensions = parseEmbedSize(size)
  const style = styleFromDimensions(dimensions)
  const styleAttr = style ? ` style="${escapeAttribute(style)}"` : ""

  if (IMAGE_EXTENSIONS.has(extension)) {
    return `<img class="obsidian-embed-media obsidian-embed-image" src="${escapeAttribute(source)}" alt="${escapeAttribute(label ?? "")}" loading="lazy"${styleAttr} />`
  }

  if (AUDIO_EXTENSIONS.has(extension)) {
    return `<audio class="obsidian-embed-media obsidian-embed-audio" controls src="${escapeAttribute(source)}"></audio>`
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return `<video class="obsidian-embed-media obsidian-embed-video" controls src="${escapeAttribute(source)}"${styleAttr}></video>`
  }

  if (PDF_EXTENSIONS.has(extension)) {
    const height = dimensions.height ?? 480
    return `<iframe class="obsidian-embed-media obsidian-embed-pdf" src="${escapeAttribute(source)}" loading="lazy" style="height:${height}px"></iframe>`
  }

  return `<a href="${escapeAttribute(source)}">${escapeHtml(label ?? target)}</a>`
}

function renderMathBlockHtml(source: string) {
  return `<div class="obsidian-math-block" data-latex="${escapeAttribute(source)}">${escapeHtml(source)}</div>`
}

function renderMathInlineHtml(source: string) {
  return `<span class="obsidian-math-inline" data-latex="${escapeAttribute(source)}">${escapeHtml(source)}</span>`
}

function renderMermaidHtml(source: string) {
  return `
    <div class="obsidian-mermaid" data-source="${escapeAttribute(source)}">
      <pre class="obsidian-mermaid-fallback">${escapeHtml(source)}</pre>
    </div>
  `.trim()
}

function renderNoteEmbedHtml(title: string, href: string, bodyHtml: string) {
  return `
    <figure class="obsidian-embed obsidian-embed-note">
      <figcaption><a href="${escapeAttribute(href)}">${escapeHtml(title)}</a></figcaption>
      <div class="obsidian-embed-content">${bodyHtml}</div>
    </figure>
  `.trim()
}

function appendInlineFootnotes(input: string) {
  const definitions: string[] = []
  let counter = 1

  const output = input.replace(/\^\[([\s\S]*?)\]/g, (_, content: string) => {
    const id = `ofm-inline-${counter}`
    counter += 1
    definitions.push(`[^${id}]: ${content.trim()}`)
    return `[^${id}]`
  })

  if (definitions.length === 0) return output
  return `${output}\n\n${definitions.join("\n")}`
}

async function replaceCallouts(
  input: string,
  context: RenderContext,
  htmlStore: ReturnType<typeof createPlaceholderStore>,
) {
  const lines = input.split("\n")
  const output: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const start = /^>\s*\[!([A-Za-z0-9-]+)\]([+-]?)(?:\s+(.*))?$/.exec(lines[index])
    if (!start) {
      output.push(lines[index])
      continue
    }

    const blockLines = [lines[index]]
    while (index + 1 < lines.length && (lines[index + 1].startsWith(">") || lines[index + 1].trim() === "")) {
      index += 1
      blockLines.push(lines[index])
    }

    const stripped = blockLines.map((line) => {
      if (line.trim() === "") return ""
      return line.replace(/^>\s?/, "")
    })

    const [, type, fold, rawTitle] = start
    const title = rawTitle?.trim() || titleCase(type)
    const bodyMarkdown = stripped.slice(1).join("\n").trim()
    const bodyHtml = bodyMarkdown
      ? await renderRichTextContent(bodyMarkdown, {
          currentEntry: context.currentEntry,
          depth: context.depth,
          visited: new Set(context.visited),
        })
      : ""

    output.push(`\n${htmlStore.create(renderCalloutHtml(type.toLowerCase(), title, bodyHtml, fold))}\n`)
  }

  return output.join("\n")
}

async function replaceWikiSyntax(
  input: string,
  context: RenderContext,
  htmlStore: ReturnType<typeof createPlaceholderStore>,
) {
  const pattern = /(!)?\[\[([\s\S]*?)\]\]/g
  let output = ""
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(input)) !== null) {
    output += input.slice(lastIndex, match.index)

    const isEmbed = Boolean(match[1])
    const rawValue = match[2].trim()
    const [targetPart, optionPart] = rawValue.split("|")
    const { note, fragment } = getEmbedTargetParts(targetPart ?? "")
    const anchor = getFragmentAnchor(fragment)
    const resolved = note || fragment ? await resolveInternalEntry(note, context.currentEntry) : null

    if (isEmbed) {
      if (note && isMediaTarget(note)) {
        const trimmedOption = optionPart?.trim()
        const mediaLabel = trimmedOption && /^\d+(?:x\d+)?$/.test(trimmedOption) ? undefined : trimmedOption
        output += htmlStore.create(renderMediaEmbedHtml(targetPart.trim(), trimmedOption, mediaLabel))
      } else if (resolved?.entry) {
        const targetKey = getEntryVisitKey(resolved.entry, fragment)
        const embedTitle = optionPart?.trim() || (fragment ? `${resolved.title} · ${formatFragmentTitle(fragment)}` : resolved.title)

        if (context.depth >= MAX_EMBED_DEPTH || context.visited.has(targetKey)) {
          const href = `${resolved.href}${anchor ? `#${anchor}` : ""}`
          output += htmlStore.create(renderNoteEmbedHtml(embedTitle, href, `<p><a href="${escapeAttribute(href)}">Open embedded note</a></p>`))
        } else {
          const snippet = fragment.startsWith("^")
            ? extractBlockMarkdown(resolved.entry.body, fragment.slice(1))
            : fragment
              ? extractHeadingMarkdown(resolved.entry.body, fragment)
              : resolved.entry.body

          const bodyHtml = await renderRichTextContent(snippet ?? resolved.entry.body, {
            currentEntry: resolved.entry,
            depth: context.depth + 1,
            visited: new Set([...context.visited, targetKey]),
          })

          const href = `${resolved.href}${anchor ? `#${anchor}` : ""}`
          output += htmlStore.create(renderNoteEmbedHtml(embedTitle, href, bodyHtml))
        }
      } else {
        output += htmlStore.create(renderUnresolvedLink(rawValue))
      }
    } else if (resolved?.entry) {
      const label = optionPart?.trim() || (fragment ? formatFragmentTitle(fragment) : resolved.title)
      const href = `${resolved.href}${anchor ? `#${anchor}` : ""}`
      output += `<a href="${escapeAttribute(href)}">${escapeHtml(label)}</a>`
    } else if (!note && fragment && context.currentEntry) {
      const href = `#${anchor}`
      const label = optionPart?.trim() || formatFragmentTitle(fragment)
      output += `<a href="${escapeAttribute(href)}">${escapeHtml(label)}</a>`
    } else {
      output += renderUnresolvedLink(rawValue)
    }

    lastIndex = pattern.lastIndex
  }

  output += input.slice(lastIndex)
  return output
}

function replaceMarkdownInternalLinks(input: string) {
  return input.replace(/(!)?\[([^\]]*?)\]\((<)?([^)\n>]+?)(>)?\)/g, (match, bang: string | undefined, label: string, _open, rawTarget: string) => {
    if (bang) {
      const [alt, size] = label.split("|")
      if (size && isMediaTarget(rawTarget)) {
        return renderMediaEmbedHtml(rawTarget, size, alt)
      }
      return match
    }

    const target = rawTarget.trim()
    if (sanitizeUrl(target) || target.startsWith("/")) return match
    if (!target.endsWith(".md")) return match

    const [pathPart, ...fragmentParts] = target.split("#")
    const fragment = fragmentParts.join("#")
    const lookup = normalizeLookupKey(pathPart)

    return `[[${lookup}${fragment ? `#${fragment}` : ""}${label ? `|${label}` : ""}]]`
  }).replace(/!\[([^\]]*?)\|(\d+(?:x\d+)?)\]\(([^)\n]+)\)/g, (_, alt: string, size: string, target: string) => {
    return renderMediaEmbedHtml(target, size, alt)
  })
}

function injectBlockAnchors(input: string) {
  return input
    .replace(/^(\^([A-Za-z0-9-]+))\s*$/gm, (_, _whole: string, id: string) => `<span id="${id}" class="obsidian-block-anchor"></span>`)
    .replace(/([^\n]+?)\s+\^([A-Za-z0-9-]+)\s*$/gm, (_, content: string, id: string) => `${content} <span id="${id}" class="obsidian-block-anchor"></span>`)
}

function replaceMath(input: string, htmlStore: ReturnType<typeof createPlaceholderStore>) {
  let output = input.replace(/\$\$([\s\S]+?)\$\$/g, (_, content: string) => `\n${htmlStore.create(renderMathBlockHtml(content.trim()))}\n`)
  output = output.replace(/(?<!\\)\$([^$\n]+?)(?<!\\)\$(?!\$)/g, (_, content: string) => htmlStore.create(renderMathInlineHtml(content.trim())))
  return output
}

function replaceMermaidCodeBlocks(
  input: string,
  codeStore: ReturnType<typeof createPlaceholderStore>,
  htmlStore: ReturnType<typeof createPlaceholderStore>,
) {
  return input.replace(/(^|\n)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\2[^\n]*(?=\n|$)/g, (match, prefix: string, _fence: string, rawLanguage: string, content: string) => {
    const language = rawLanguage.trim().split(/\s+/)[0]?.toLowerCase()
    if (language === "mermaid") {
      return `${prefix}${htmlStore.create(renderMermaidHtml(content.trim()))}`
    }

    return `${prefix}${codeStore.create(match.trimStart())}`
  })
}

function protectInlineCode(input: string, codeStore: ReturnType<typeof createPlaceholderStore>) {
  return input.replace(/`[^`\n]+`/g, (match) => codeStore.create(match))
}

function restoreProtectedCode(input: string, codeStore: ReturnType<typeof createPlaceholderStore>) {
  return codeStore.restore(input)
}

async function normalizeRichText(input: string, context: RenderContext) {
  const htmlStore = createPlaceholderStore("RICHHTMLTOKEN")
  const codeStore = createPlaceholderStore("RICHCODETOKEN")

  let output = input
  output = replaceMermaidCodeBlocks(output, codeStore, htmlStore)
  output = protectInlineCode(output, codeStore)
  output = stripComments(output)
  output = await replaceCallouts(output, context, htmlStore)
  output = replaceMarkdownInternalLinks(output)
  output = replaceMath(output, htmlStore)
  output = normalizeBbcode(output)
  output = replaceInlineHighlights(output)
  output = appendInlineFootnotes(output)
  output = injectBlockAnchors(output)
  output = await replaceWikiSyntax(output, context, htmlStore)
  output = restoreProtectedCode(output, codeStore)

  return {
    markdown: output.trim(),
    htmlStore,
  }
}

async function renderRichTextContent(source: string, context: RenderContext, entry?: RichTextEntry) {
  const processor = await getMarkdownProcessor()
  const normalized = await normalizeRichText(source, context)
  const renderOptions = entry
    ? ({
        fileURL: new URL(`../content/${entry.collection}/${entry.id}`, import.meta.url),
        frontmatter: entry.data,
      } as Parameters<MarkdownProcessor["render"]>[1] & { fileURL: URL })
    : undefined

  const { code } = await processor.render(normalized.markdown, renderOptions)
  return restoreHtmlPlaceholders(code, normalized.htmlStore)
}

export async function renderEntryRichText(entry: RichTextEntry) {
  const html = await renderRichTextContent(entry.body, {
    currentEntry: entry,
    depth: 0,
    visited: new Set([getEntryVisitKey(entry)]),
  }, entry)

  return { html }
}

export { getWorkEntryAnchor }
