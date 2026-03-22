#!/usr/bin/env node

import http from "node:http"
import { execFileSync, spawnSync } from "node:child_process"
import { URL } from "node:url"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { renderStudioPreview } from "./studio-preview-renderer.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const workflowScript = path.join(repoRoot, "scripts", "content-workflow.mjs")
const port = Number(process.env.STUDIO_PORT ?? 4111)

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  })
  response.end(JSON.stringify(payload))
}

function sendError(response, status, message, details = undefined) {
  sendJson(response, status, {
    ok: false,
    error: message,
    details,
  })
}

function runWorkflow(args) {
  const result = spawnSync(process.execPath, [workflowScript, ...args, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  })

  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim()
    const stdout = (result.stdout ?? "").trim()
    throw new Error(stderr || stdout || `workflow exited with code ${result.status ?? 1}`)
  }

  const stdout = (result.stdout ?? "").trim()
  if (!stdout) return null
  return JSON.parse(stdout)
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function runGitRaw(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).replace(/\n+$/, "")
}

function parseDirtyPath(line) {
  if (!line) return ""

  if (line.startsWith("?? ") || line.startsWith("!! ")) {
    return line.slice(3).trim()
  }

  const candidate = line.length > 3 ? line.slice(3).trim() : line.trim()
  if (candidate.includes(" -> ")) {
    return candidate.split(" -> ").at(-1)?.trim() ?? candidate
  }

  return candidate
}

function getRepoState() {
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"])
  const dirty = runGitRaw(["status", "--porcelain", "--untracked-files=all"])
  return {
    branch,
    dirty: Boolean(dirty),
    dirtyPaths: dirty
      ? dirty
        .split("\n")
        .map((line) => parseDirtyPath(line))
        .filter(Boolean)
      : [],
  }
}

async function readJsonBody(request) {
  const chunks = []

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return {}
  }

  const raw = Buffer.concat(chunks).toString("utf8")
  return raw ? JSON.parse(raw) : {}
}

function buildCliArgsFromCreate(body) {
  const args = [
    "new",
    String(body.collection ?? ""),
    "--title", String(body.title ?? ""),
  ]

  if (body.summary) args.push("--summary", String(body.summary))
  if (body.tags) args.push("--tags", Array.isArray(body.tags) ? body.tags.join(",") : String(body.tags))
  if (body.slug) args.push("--slug", String(body.slug))
  if (body.status) args.push("--status", String(body.status))
  if (body.date) args.push("--date", String(body.date))
  if (body.demoUrl) args.push("--demo-url", String(body.demoUrl))
  if (body.repoUrl) args.push("--repo-url", String(body.repoUrl))

  return args
}

function buildCliArgsFromReview(collection, slug, body) {
  const args = ["submit-review", collection, slug]

  if (body.status) args.push("--status", String(body.status))
  if (body.delete === true) args.push("--delete")
  if (body.push) args.push("--push")
  if (body.remote) args.push("--remote", String(body.remote))
  if (body.base) args.push("--base", String(body.base))

  return args
}

function buildCliArgsFromUpdate(collection, slug, body) {
  const args = ["update-entry", collection, slug]

  if (body.title !== undefined) args.push("--title", String(body.title))
  if (body.summary !== undefined) args.push("--summary", String(body.summary))
  if (body.date !== undefined) args.push("--date", String(body.date))
  if (body.tags !== undefined) args.push("--tags", Array.isArray(body.tags) ? body.tags.join(",") : String(body.tags))
  if (body.body !== undefined) args.push("--body", String(body.body))
  if (body.status !== undefined) args.push("--status", String(body.status))
  if (body.demoUrl !== undefined) args.push("--demo-url", String(body.demoUrl))
  if (body.repoUrl !== undefined) args.push("--repo-url", String(body.repoUrl))

  return args
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendError(response, 400, "missing request URL")
    return
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    })
    response.end()
    return
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`)
  const pathParts = url.pathname.split("/").filter(Boolean)

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, data: { status: "ok", port } })
      return
    }

    if (request.method === "GET" && url.pathname === "/repo-state") {
      sendJson(response, 200, { ok: true, data: getRepoState() })
      return
    }

    if (request.method === "GET" && url.pathname === "/entries") {
      const collection = url.searchParams.get("collection") ?? "all"
      const status = url.searchParams.get("status")
      const args = ["list", collection]
      if (status) args.push("--status", status)
      const data = runWorkflow(args)
      sendJson(response, 200, { ok: true, data })
      return
    }

    if (request.method === "POST" && url.pathname === "/entries") {
      const body = await readJsonBody(request)
      const data = runWorkflow(buildCliArgsFromCreate(body))
      sendJson(response, 201, { ok: true, data })
      return
    }

    if (request.method === "POST" && url.pathname === "/preview") {
      const body = await readJsonBody(request)
      const data = await renderStudioPreview(String(body.body ?? ""), {
        filePath: typeof body.filePath === "string" ? body.filePath : undefined,
        frontmatter: body.frontmatter && typeof body.frontmatter === "object" ? body.frontmatter : undefined,
      })
      sendJson(response, 200, { ok: true, data })
      return
    }

    if (pathParts.length === 3 && pathParts[0] === "entries" && request.method === "GET") {
      const [, collection, slug] = pathParts
      const data = runWorkflow(["get-entry", collection, decodeURIComponent(slug)])
      sendJson(response, 200, { ok: true, data })
      return
    }

    if (pathParts.length === 3 && pathParts[0] === "entries" && request.method === "PUT") {
      const [, collection, slug] = pathParts
      const body = await readJsonBody(request)
      const data = runWorkflow(buildCliArgsFromUpdate(collection, decodeURIComponent(slug), body))
      sendJson(response, 200, { ok: true, data })
      return
    }

    if (pathParts.length === 4 && pathParts[0] === "entries" && pathParts[3] === "status" && request.method === "PATCH") {
      const [, collection, slug] = pathParts
      const body = await readJsonBody(request)
      const data = runWorkflow(["set-status", collection, decodeURIComponent(slug), String(body.status ?? "")])
      sendJson(response, 200, { ok: true, data })
      return
    }

    if (pathParts.length === 4 && pathParts[0] === "entries" && pathParts[3] === "review" && request.method === "POST") {
      const [, collection, slug] = pathParts
      const body = await readJsonBody(request)
      const data = runWorkflow(buildCliArgsFromReview(collection, decodeURIComponent(slug), body))
      sendJson(response, 200, { ok: true, data })
      return
    }

    if (pathParts.length === 3 && pathParts[0] === "entries" && request.method === "DELETE") {
      const [, collection, slug] = pathParts
      const data = runWorkflow(["delete", collection, decodeURIComponent(slug)])
      sendJson(response, 200, { ok: true, data })
      return
    }

    sendError(response, 404, `route not found: ${request.method} ${url.pathname}`)
  } catch (error) {
    sendError(
      response,
      500,
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined,
    )
  }
})

server.listen(port, "127.0.0.1", () => {
  console.log(`[studio-api] listening on http://127.0.0.1:${port}`)
})
