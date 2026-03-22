import { createMarkdownProcessor } from "@astrojs/markdown-remark"
import { pathToFileURL } from "node:url"

let processorPromise

function getMarkdownProcessor() {
  processorPromise ??= createMarkdownProcessor()
  return processorPromise
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;")
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function sanitizeUrl(value) {
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

function sanitizeColor(value) {
  const trimmed = value.trim()
  return /^[#(),.%\-\sA-Za-z0-9]+$/.test(trimmed) ? trimmed : null
}

function sanitizeSize(value) {
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return `${trimmed}px`
  if (/^\d+(\.\d+)?(px|em|rem|%|vh|vw)$/.test(trimmed)) return trimmed
  return null
}

function sanitizeFontFamily(value) {
  const trimmed = value.trim()
  return /^[\w\s",-]+$/.test(trimmed) ? trimmed : null
}

function wrapCodeFence(content, language) {
  const normalized = content.replace(/^\n+|\n+$/g, "")
  const longestFence = Math.max(...Array.from(normalized.matchAll(/`+/g), (match) => match[0].length), 2)
  const fence = "`".repeat(longestFence + 1)
  const lang = language?.trim().replace(/[^\w#+.-]/g, "") ?? ""
  return `\n${fence}${lang}\n${normalized}\n${fence}\n`
}

function replaceUntilStable(input, replacer) {
  let output = input

  while (true) {
    const next = replacer(output)
    if (next === output) return output
    output = next
  }
}

function replaceTagPair(input, tag, render) {
  const pattern = new RegExp(`\\[${tag}(?:=([^\\]]+))?\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "gi")
  return replaceUntilStable(input, (value) =>
    value.replace(pattern, (_, option, content) => render(content, option)),
  )
}

function replaceSimpleTag(input, tag, htmlTag) {
  return replaceTagPair(input, tag, (content) => `<${htmlTag}>${normalizeBbcode(content)}</${htmlTag}>`)
}

function renderList(content, option) {
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

function normalizeBbcode(input) {
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

function replaceInlineHighlights(input) {
  return input.replace(/==([^=\n][\s\S]*?[^=\n])==/g, "<mark>$1</mark>")
}

function stripComments(input) {
  return input.replace(/%%[\s\S]*?%%/g, "")
}

function appendInlineFootnotes(input) {
  const definitions = []
  let counter = 1

  const output = input.replace(/\^\[([\s\S]*?)\]/g, (_, content) => {
    const id = `studio-inline-${counter}`
    counter += 1
    definitions.push(`[^${id}]: ${content.trim()}`)
    return `[^${id}]`
  })

  if (definitions.length === 0) return output
  return `${output}\n\n${definitions.join("\n")}`
}

function injectBlockAnchors(input) {
  return input
    .replace(/^(\^([A-Za-z0-9-]+))\s*$/gm, (_, _whole, id) => `<span id="${id}" class="obsidian-block-anchor"></span>`)
    .replace(/([^\n]+?)\s+\^([A-Za-z0-9-]+)\s*$/gm, (_, content, id) => `${content} <span id="${id}" class="obsidian-block-anchor"></span>`)
}

function createPlaceholderStore(prefix) {
  const values = []

  return {
    token(index) {
      return `${prefix}${index}ZZ`
    },
    create(value) {
      const token = `${prefix}${values.length}ZZ`
      values.push(value)
      return token
    },
    restore(input) {
      return input.replace(new RegExp(`${escapeRegExp(prefix)}(\\d+)ZZ`, "g"), (_, index) => values[Number(index)] ?? "")
    },
    values,
  }
}

function restoreHtmlPlaceholders(input, store) {
  return store.values.reduce((html, value, index) => {
    const token = store.token(index)
    return html
      .replace(new RegExp(`<p>${escapeRegExp(token)}</p>`, "g"), value)
      .replaceAll(token, value)
  }, input)
}

function renderCalloutHtml(type, title, bodyHtml, fold) {
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

function renderMathBlockHtml(source) {
  return `<div class="obsidian-math-block" data-latex="${escapeAttribute(source)}">${escapeHtml(source)}</div>`
}

function renderMathInlineHtml(source) {
  return `<span class="obsidian-math-inline" data-latex="${escapeAttribute(source)}">${escapeHtml(source)}</span>`
}

function renderMermaidHtml(source) {
  return `
    <div class="obsidian-mermaid" data-source="${escapeAttribute(source)}">
      <pre class="obsidian-mermaid-fallback">${escapeHtml(source)}</pre>
    </div>
  `.trim()
}

async function replaceCallouts(input, htmlStore, renderContent) {
  const lines = input.split("\n")
  const output = []

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
    const title = rawTitle?.trim() || type.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
    const bodyMarkdown = stripped.slice(1).join("\n").trim()
    const bodyHtml = bodyMarkdown ? await renderContent(bodyMarkdown) : ""

    output.push(`\n${htmlStore.create(renderCalloutHtml(type.toLowerCase(), title, bodyHtml, fold))}\n`)
  }

  return output.join("\n")
}

function replaceMath(input, htmlStore) {
  let output = input.replace(/\$\$([\s\S]+?)\$\$/g, (_, content) => `\n${htmlStore.create(renderMathBlockHtml(content.trim()))}\n`)
  output = output.replace(/(?<!\\)\$([^$\n]+?)(?<!\\)\$(?!\$)/g, (_, content) => htmlStore.create(renderMathInlineHtml(content.trim())))
  return output
}

function replaceMermaidCodeBlocks(input, codeStore, htmlStore) {
  return input.replace(/(^|\n)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\2[^\n]*(?=\n|$)/g, (match, prefix, _fence, rawLanguage, content) => {
    const language = rawLanguage.trim().split(/\s+/)[0]?.toLowerCase()
    if (language === "mermaid") {
      return `${prefix}${htmlStore.create(renderMermaidHtml(content.trim()))}`
    }

    return `${prefix}${codeStore.create(match.trimStart())}`
  })
}

function protectInlineCode(input, codeStore) {
  return input.replace(/`[^`\n]+`/g, (match) => codeStore.create(match))
}

async function normalizePreviewRichText(input, renderContent) {
  const htmlStore = createPlaceholderStore("STUDIOHTMLTOKEN")
  const codeStore = createPlaceholderStore("STUDIOCODETOKEN")

  let output = input
  output = replaceMermaidCodeBlocks(output, codeStore, htmlStore)
  output = protectInlineCode(output, codeStore)
  output = stripComments(output)
  output = await replaceCallouts(output, htmlStore, renderContent)
  output = replaceMath(output, htmlStore)
  output = normalizeBbcode(output)
  output = replaceInlineHighlights(output)
  output = appendInlineFootnotes(output)
  output = injectBlockAnchors(output)
  output = codeStore.restore(output)

  return {
    markdown: output.trim(),
    htmlStore,
  }
}

async function renderStudioPreviewContent(source, options = {}) {
  const processor = await getMarkdownProcessor()
  const normalized = await normalizePreviewRichText(source, (content) => renderStudioPreviewContent(content, options))

  const renderOptions = {}
  if (options.filePath) {
    renderOptions.fileURL = pathToFileURL(options.filePath)
  }
  if (options.frontmatter) {
    renderOptions.frontmatter = options.frontmatter
  }

  const { code } = await processor.render(normalized.markdown, Object.keys(renderOptions).length > 0 ? renderOptions : undefined)
  return restoreHtmlPlaceholders(code, normalized.htmlStore)
}

export async function renderStudioPreview(source, options = {}) {
  const html = await renderStudioPreviewContent(source, options)
  return { html }
}
