let mermaidReady = false
let katexPromise: Promise<typeof import("katex").default> | undefined
let mermaidPromise: Promise<typeof import("mermaid").default> | undefined

async function getKatex() {
  katexPromise ??= import("katex").then((module) => module.default)
  return katexPromise
}

async function getMermaid() {
  mermaidPromise ??= import("mermaid").then((module) => module.default)
  return mermaidPromise
}

async function ensureMermaid() {
  const mermaid = await getMermaid()
  if (mermaidReady) return mermaid

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
  })

  mermaidReady = true
  return mermaid
}

async function renderMath(root: ParentNode) {
  const nodes = root.querySelectorAll<HTMLElement>(".obsidian-math-inline, .obsidian-math-block")
  if (nodes.length === 0) return

  const katex = await getKatex()

  nodes.forEach((node) => {
    if (node.dataset.rendered === "true") return

    const latex = node.dataset.latex ?? ""
    const displayMode = node.classList.contains("obsidian-math-block")

    try {
      katex.render(latex, node, {
        displayMode,
        throwOnError: false,
        strict: "warn",
      })
      node.dataset.rendered = "true"
    } catch (error) {
      node.dataset.rendered = "error"
      console.error("Failed to render math", error)
    }
  })
}

async function renderMermaid(root: ParentNode) {
  const containers = Array.from(root.querySelectorAll<HTMLElement>(".obsidian-mermaid"))
    .filter((node) => node.dataset.rendered !== "true")

  if (containers.length === 0) return

  const mermaid = await ensureMermaid()

  for (const [index, node] of containers.entries()) {
    const source = node.dataset.source ?? ""

    try {
      const id = `mermaid-${Date.now()}-${index}`
      const { svg } = await mermaid.render(id, source)
      node.innerHTML = svg
      node.dataset.rendered = "true"
    } catch (error) {
      node.dataset.rendered = "error"
      console.error("Failed to render mermaid diagram", error)
    }
  }
}

async function enhanceRichText(root: ParentNode = document) {
  await Promise.all([renderMath(root), renderMermaid(root)])
}

document.addEventListener("DOMContentLoaded", () => {
  void enhanceRichText()
})

document.addEventListener("astro:after-swap", () => {
  mermaidReady = false
  void enhanceRichText()
})
