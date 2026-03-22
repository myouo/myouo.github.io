#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

const COLLECTIONS = new Set(["blog", "projects"])
const STATUSES = new Set(["draft", "published", "archived"])

const COLLECTION_META = {
  blog: {
    rootDir: path.join(repoRoot, "src/content/blog"),
    label: "post",
  },
  projects: {
    rootDir: path.join(repoRoot, "src/content/projects"),
    label: "project",
  },
}

function printHelp() {
  console.log(`Usage:
  npm run content -- new <blog|projects> --title "My Title" [--summary "Short summary"] [--tags "Tag A,Tag B"] [--slug "my-title"] [--status draft]
  npm run content -- list [blog|projects|all] [--status published]
  npm run content -- set-status <blog|projects> <slug> <draft|published|archived>
  npm run content -- delete <blog|projects> <slug>
  npm run content -- submit-review <blog|projects> <slug> [--status published] [--push] [--create-pr] [--delete]

Notes:
  - Content is only public on the site when status is "published".
  - Review is handled through Git branches and pull requests.
  - submit-review only stages and commits the selected entry path.`)
}

function fail(message) {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const positionals = []
  const options = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith("--")) {
      positionals.push(token)
      continue
    }

    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith("--")) {
      options[key] = true
      continue
    }

    options[key] = next
    index += 1
  }

  return { positionals, options }
}

function wantsJson(options) {
  return options.json === true
}

function normalizeCollection(value) {
  if (!value || !COLLECTIONS.has(value)) {
    fail(`collection must be one of: ${Array.from(COLLECTIONS).join(", ")}`)
  }
  return value
}

function normalizeStatus(value) {
  if (!value || !STATUSES.has(value)) {
    fail(`status must be one of: ${Array.from(STATUSES).join(", ")}`)
  }
  return value
}

function slugify(input) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
}

function quoteString(value) {
  return JSON.stringify(value)
}

function splitTags(value) {
  if (!value) return []
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatTags(tags) {
  if (tags.length === 0) {
    return "tags:\n- Draft"
  }

  return `tags:\n${tags.map((tag) => `- ${tag}`).join("\n")}`
}

function currentIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function ensureInsideRepo(filePath) {
  const relative = path.relative(repoRoot, filePath)
  if (relative.startsWith("..")) {
    fail(`path escaped repository root: ${filePath}`)
  }
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8")
}

async function writeText(filePath, contents) {
  ensureInsideRepo(filePath)
  await fs.writeFile(filePath, contents, "utf8")
}

function extractFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) {
    fail("frontmatter block not found")
  }

  return {
    block: match[1],
    fullMatch: match[0],
  }
}

function parseScalar(value) {
  const trimmed = value.trim()

  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function parseFrontmatter(text) {
  const { block } = extractFrontmatter(text)
  const lines = block.split("\n")
  const data = {}
  let currentArrayKey = null

  for (const line of lines) {
    if (!line.trim()) continue

    if (line.startsWith("- ")) {
      if (!currentArrayKey) continue
      data[currentArrayKey].push(parseScalar(line.slice(2)))
      continue
    }

    currentArrayKey = null
    const separator = line.indexOf(":")
    if (separator === -1) continue

    const key = line.slice(0, separator).trim()
    const rawValue = line.slice(separator + 1).trim()
    if (!rawValue) {
      data[key] = []
      currentArrayKey = key
      continue
    }

    data[key] = parseScalar(rawValue)
  }

  return data
}

function upsertFrontmatterLine(text, key, renderedValue, afterKeys = []) {
  const { block, fullMatch } = extractFrontmatter(text)
  const lines = block.split("\n")
  const nextLines = []
  let replaced = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.startsWith(`${key}:`)) {
      nextLines.push(`${key}: ${renderedValue}`)
      replaced = true
      continue
    }
    nextLines.push(line)
  }

  if (!replaced) {
    const insertAfterIndex = Math.max(
      ...afterKeys
        .map((afterKey) => nextLines.findIndex((line) => line.startsWith(`${afterKey}:`)))
        .filter((index) => index >= 0),
      -1,
    )

    if (insertAfterIndex >= 0) {
      nextLines.splice(insertAfterIndex + 1, 0, `${key}: ${renderedValue}`)
    } else {
      nextLines.push(`${key}: ${renderedValue}`)
    }
  }

  return text.replace(fullMatch, `---\n${nextLines.join("\n")}\n---\n`)
}

function applyStatusToText(text, status) {
  const normalizedStatus = normalizeStatus(status)
  let nextText = upsertFrontmatterLine(text, "status", normalizedStatus, ["date", "summary", "title"])
  const draftValue = normalizedStatus === "draft" ? "true" : "false"
  nextText = upsertFrontmatterLine(nextText, "draft", draftValue, ["status"])
  return nextText
}

async function collectEntryFiles(rootDir) {
  const files = []

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }

      if (entry.name === "index.md" || entry.name === "index.mdx") {
        files.push(fullPath)
      }
    }
  }

  await walk(rootDir)
  return files.sort()
}

function buildSlug(collection, filePath) {
  const { rootDir } = COLLECTION_META[collection]
  const relative = path.relative(rootDir, filePath)
  const dirname = path.dirname(relative)
  const basename = path.basename(relative)

  if (basename.startsWith("index.")) {
    return dirname === "." ? path.basename(path.dirname(filePath)) : dirname
  }

  return relative.replace(/\.(md|mdx)$/, "")
}

async function getEntries(collection) {
  const normalizedCollection = normalizeCollection(collection)
  const filePaths = await collectEntryFiles(COLLECTION_META[normalizedCollection].rootDir)

  return Promise.all(filePaths.map(async (filePath) => {
    const contents = await readText(filePath)
    const frontmatter = parseFrontmatter(contents)
    const slug = buildSlug(normalizedCollection, filePath)
    const stagePath = path.dirname(filePath)
    return {
      collection: normalizedCollection,
      slug,
      filePath,
      stagePath,
      frontmatter,
    }
  }))
}

async function findEntry(collection, slug) {
  const entries = await getEntries(collection)
  const entry = entries.find((item) => item.slug === slug)
  if (!entry) {
    fail(`entry not found: ${collection}/${slug}`)
  }
  return entry
}

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim()
}

function safeGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  })

  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  }
}

function getRemoteUrl(remote) {
  return runGit(["remote", "get-url", remote])
}

function normalizeRemoteUrl(remoteUrl) {
  if (remoteUrl.startsWith("git@github.com:")) {
    return `https://github.com/${remoteUrl.slice("git@github.com:".length).replace(/\.git$/, "")}`
  }

  if (remoteUrl.startsWith("https://github.com/")) {
    return remoteUrl.replace(/\.git$/, "")
  }

  return remoteUrl
}

function compareUrl(remoteUrl, base, branch) {
  const normalized = normalizeRemoteUrl(remoteUrl)
  if (!normalized.startsWith("https://github.com/")) {
    return null
  }
  return `${normalized}/compare/${base}...${branch}?expand=1`
}

function branchNameFor(collection, slug, status) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const statusPart = status ? `-${status}` : ""
  return `content/${collection}/${slug}${statusPart}-${stamp}`
}

function relativeRepoPath(targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join("/")
}

function dirtyPaths() {
  const raw = runGit(["status", "--porcelain", "--untracked-files=all"])
  if (!raw) return []

  return raw.split("\n").map((line) => {
    const candidate = line.slice(3).trim()
    if (candidate.includes(" -> ")) {
      return candidate.split(" -> ").at(-1)
    }
    return candidate
  })
}

function isPathInside(parentPath, candidatePath) {
  const normalizedParent = parentPath.split(path.sep).join("/")
  const normalizedCandidate = candidatePath.split(path.sep).join("/")
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`)
}

function ensureOnlyTargetChanges(stagePath) {
  const relativeStagePath = relativeRepoPath(stagePath)
  const unrelated = dirtyPaths().filter((candidate) => !isPathInside(relativeStagePath, candidate))
  if (unrelated.length > 0) {
    fail(`working tree contains unrelated changes:\n- ${unrelated.join("\n- ")}`)
  }
}

async function commandNew(collection, options) {
  const normalizedCollection = normalizeCollection(collection)
  const title = String(options.title ?? "").trim()
  if (!title) fail("--title is required")

  const slug = String(options.slug ?? slugify(title)).trim()
  if (!slug) fail("generated slug was empty; provide --slug explicitly")

  const summary = String(options.summary ?? "TODO: add summary").trim()
  const status = normalizeStatus(String(options.status ?? "draft"))
  const tags = splitTags(options.tags)
  const date = String(options.date ?? currentIsoDate())

  const targetDir = path.join(COLLECTION_META[normalizedCollection].rootDir, slug)
  const targetFile = path.join(targetDir, "index.md")

  try {
    await fs.access(targetFile)
    fail(`entry already exists: ${relativeRepoPath(targetFile)}`)
  } catch {
    // continue
  }

  await fs.mkdir(targetDir, { recursive: true })

  const frontmatterLines = [
    "---",
    `title: ${quoteString(title)}`,
    `summary: ${quoteString(summary)}`,
    `date: ${quoteString(date)}`,
    `status: ${status}`,
    `draft: ${status === "draft" ? "true" : "false"}`,
    formatTags(tags),
  ]

  if (normalizedCollection === "projects") {
    if (options["demo-url"]) {
      frontmatterLines.push(`demoUrl: ${quoteString(String(options["demo-url"]))}`)
    }
    if (options["repo-url"]) {
      frontmatterLines.push(`repoUrl: ${quoteString(String(options["repo-url"]))}`)
    }
  }

  const body = [
    "---",
    "",
    `${title} ${normalizedCollection === "blog" ? "的正文待补充。" : "的项目说明待补充。"}`,
    "",
    "## What I Built",
    "",
    "- TODO",
    "",
    "## Why It Matters",
    "",
    "- TODO",
    "",
  ].join("\n")

  await writeText(targetFile, `${frontmatterLines.join("\n")}\n${body}`)

  const result = {
    collection: normalizedCollection,
    slug,
    filePath: relativeRepoPath(targetFile),
    status,
    title,
    summary,
    tags,
    date,
  }

  if (!wantsJson(options)) {
    console.log(`Created ${COLLECTION_META[normalizedCollection].label}: ${result.filePath}`)
    console.log(`Status: ${status}`)
  }

  return result
}

async function commandList(collectionOrAll, options) {
  const selectedCollections = !collectionOrAll || collectionOrAll === "all"
    ? Array.from(COLLECTIONS)
    : [normalizeCollection(collectionOrAll)]

  const entries = []
  for (const collection of selectedCollections) {
    entries.push(...await getEntries(collection))
  }

  const statusFilter = options.status ? normalizeStatus(String(options.status)) : null

  const rows = entries
    .map((entry) => ({
      collection: entry.collection,
      slug: entry.slug,
      status: String(entry.frontmatter.status ?? (entry.frontmatter.draft ? "draft" : "published")),
      date: String(entry.frontmatter.date ?? ""),
      title: String(entry.frontmatter.title ?? ""),
      summary: String(entry.frontmatter.summary ?? ""),
      tags: Array.isArray(entry.frontmatter.tags) ? entry.frontmatter.tags.map((tag) => String(tag)) : [],
      filePath: relativeRepoPath(entry.filePath),
    }))
    .filter((entry) => !statusFilter || entry.status === statusFilter)
    .sort((left, right) => {
      const leftTime = Date.parse(left.date) || 0
      const rightTime = Date.parse(right.date) || 0
      return rightTime - leftTime
    })

  if (rows.length === 0 && !wantsJson(options)) {
    console.log("No entries found.")
    return []
  }

  if (!wantsJson(options)) {
    for (const row of rows) {
      console.log(`[${row.collection}] ${row.status.padEnd(9)} ${row.date} ${row.slug} :: ${row.title}`)
    }
  }

  return rows
}

async function commandSetStatus(collection, slug, status, options = {}) {
  const normalizedCollection = normalizeCollection(collection)
  const normalizedStatus = normalizeStatus(status)
  const entry = await findEntry(normalizedCollection, slug)
  const currentText = await readText(entry.filePath)
  const nextText = applyStatusToText(currentText, normalizedStatus)

  if (nextText === currentText) {
    const unchanged = {
      collection: normalizedCollection,
      slug,
      status: normalizedStatus,
      changed: false,
    }
    if (!wantsJson(options)) {
      console.log(`No changes needed for ${normalizedCollection}/${slug}.`)
    }
    return unchanged
  }

  await writeText(entry.filePath, nextText)

  const result = {
    collection: normalizedCollection,
    slug,
    status: normalizedStatus,
    changed: true,
    filePath: relativeRepoPath(entry.filePath),
  }

  if (!wantsJson(options)) {
    console.log(`Updated ${normalizedCollection}/${slug} -> ${normalizedStatus}`)
  }
  return result
}

async function commandDelete(collection, slug, options = {}) {
  const normalizedCollection = normalizeCollection(collection)
  const entry = await findEntry(normalizedCollection, slug)

  await fs.rm(entry.stagePath, { recursive: true, force: true })

  const result = {
    collection: normalizedCollection,
    slug,
    deleted: true,
    stagePath: relativeRepoPath(entry.stagePath),
  }

  if (!wantsJson(options)) {
    console.log(`Deleted ${normalizedCollection}/${slug}`)
  }

  return result
}

async function commandSubmitReview(collection, slug, options) {
  const normalizedCollection = normalizeCollection(collection)
  const entry = await findEntry(normalizedCollection, slug)
  const isDeleteReview = options.delete === true

  if (isDeleteReview && options.status) {
    fail("--delete cannot be combined with --status")
  }

  if (!isDeleteReview && options.status) {
    const currentText = await readText(entry.filePath)
    const nextText = applyStatusToText(currentText, String(options.status))
    if (nextText !== currentText) {
      await writeText(entry.filePath, nextText)
    }
  }

  ensureOnlyTargetChanges(entry.stagePath)

  if (isDeleteReview) {
    await fs.rm(entry.stagePath, { recursive: true, force: true })
  }

  const relativeStagePath = relativeRepoPath(entry.stagePath)
  const changed = runGit(["status", "--porcelain", "--", relativeStagePath])
  if (!changed) {
    fail(`no changes detected under ${relativeStagePath}`)
  }

  const branch = String(options.branch ?? branchNameFor(
    normalizedCollection,
    slug,
    options.status ? String(options.status) : null,
  ))
  const remote = String(options.remote ?? "origin")
  const base = String(options.base ?? "main")
  const commitMessage = String(
    options["commit-message"]
      ?? (isDeleteReview
        ? `content(${normalizedCollection}): delete ${slug}`
        : `content(${normalizedCollection}): update ${slug}${options.status ? ` -> ${options.status}` : ""}`),
  )

  const existingBranch = safeGit(["rev-parse", "--verify", branch])
  if (existingBranch.status === 0) {
    fail(`branch already exists: ${branch}`)
  }

  runGit(["switch", "-c", branch])
  runGit(["add", "-A", "--", relativeStagePath])

  const staged = safeGit(["diff", "--cached", "--quiet", "--", relativeStagePath])
  if (staged.status === 0) {
    fail(`nothing staged for ${relativeStagePath}`)
  }

  runGit(["commit", "-m", commitMessage])

  if (options.push) {
    runGit(["push", "-u", remote, branch])
  }

  const remoteUrl = getRemoteUrl(remote)
  const prUrl = compareUrl(remoteUrl, base, branch)

  const result = {
    collection: normalizedCollection,
    slug,
    branch,
    base,
    prUrl,
    deleteReview: isDeleteReview,
    pushed: Boolean(options.push),
    targetStatus: options.status ? String(options.status) : null,
  }

  if (!wantsJson(options)) {
    console.log(`Review branch ready: ${branch}`)
    console.log(`Base branch: ${base}`)
    if (prUrl) {
      console.log(`Create PR: ${prUrl}`)
    }
  }

  if (options["create-pr"]) {
    const ghCheck = spawnSync("gh", ["--version"], { cwd: repoRoot, encoding: "utf8" })
    if (ghCheck.status === 0) {
      const prTitle = String(options.title ?? `Review ${normalizedCollection}/${slug}`)
      const prBody = String(
        options.body
          ?? `## Summary\n- review ${normalizedCollection}/${slug}\n- target status: ${options.status ?? "unchanged"}\n`,
      )

      const ghArgs = ["pr", "create", "--base", base, "--head", branch, "--title", prTitle, "--body", prBody]
      const ghResult = spawnSync("gh", ghArgs, {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: wantsJson(options) ? ["ignore", "pipe", "pipe"] : "inherit",
      })
      if (wantsJson(options)) {
        result.createdPr = ghResult.status === 0
        result.ghStdout = (ghResult.stdout ?? "").trim()
        result.ghStderr = (ghResult.stderr ?? "").trim()
      }
    } else {
      const message = "GitHub CLI not found. Open the compare URL above to create the PR manually."
      if (!wantsJson(options)) {
        console.log(message)
      }
      result.warning = message
    }
  }

  return result
}

async function main() {
  const { positionals, options } = parseArgs(process.argv.slice(2))
  const [command, firstArg, secondArg, thirdArg] = positionals

  let result

  switch (command) {
    case undefined:
    case "help":
    case "--help":
      printHelp()
      return
    case "new":
      result = await commandNew(firstArg, options)
      break
    case "list":
      result = await commandList(firstArg, options)
      break
    case "set-status":
      result = await commandSetStatus(firstArg, secondArg, thirdArg, options)
      break
    case "delete":
      result = await commandDelete(firstArg, secondArg, options)
      break
    case "submit-review":
      result = await commandSubmitReview(firstArg, secondArg, options)
      break
    default:
      fail(`unknown command: ${command}`)
  }

  if (wantsJson(options)) {
    console.log(JSON.stringify(result))
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
