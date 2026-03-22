#!/usr/bin/env node

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

const children = []
const watchedScriptFiles = new Set([
  "content-studio-server.mjs",
  "content-workflow.mjs",
])

function start(name, command, args, onExit) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  })

  child.on("exit", (code, signal) => {
    onExit?.(code, signal)
    if (signal) {
      console.log(`[${name}] exited with signal ${signal}`)
    } else if (code && code !== 0) {
      console.log(`[${name}] exited with code ${code}`)
      shutdown(code)
    }
  })

  children.push(child)
  return child
}

let shuttingDown = false
let apiRestartTimer = null
let restartingApi = false
let studioApiChild = null
let scriptWatcher = null

function removeChild(child) {
  const index = children.indexOf(child)
  if (index >= 0) {
    children.splice(index, 1)
  }
}

function startStudioApi() {
  studioApiChild = start("studio-api", process.execPath, ["./scripts/content-studio-server.mjs"], (code, signal) => {
    removeChild(studioApiChild)
    const expectedRestart = restartingApi && signal === "SIGTERM"
    if (expectedRestart) {
      restartingApi = false
      startStudioApi()
      return
    }

    if (!signal && code && code !== 0) {
      return
    }
  })
}

function restartStudioApi(reason) {
  if (shuttingDown) return
  if (!studioApiChild) {
    startStudioApi()
    return
  }

  if (apiRestartTimer) {
    clearTimeout(apiRestartTimer)
  }

  apiRestartTimer = setTimeout(() => {
    apiRestartTimer = null
    if (shuttingDown || !studioApiChild) return

    console.log(`[studio] restarting studio-api after ${reason}`)
    restartingApi = true
    studioApiChild.kill("SIGTERM")
  }, 120)
}

function startScriptWatcher() {
  scriptWatcher = fs.watch(path.join(repoRoot, "scripts"), (eventType, filename) => {
    const changedFile = filename?.toString()
    if (!changedFile || !watchedScriptFiles.has(changedFile)) return
    restartStudioApi(`${eventType} ${changedFile}`)
  })
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  if (apiRestartTimer) {
    clearTimeout(apiRestartTimer)
    apiRestartTimer = null
  }

  scriptWatcher?.close()

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM")
    }
  }

  setTimeout(() => process.exit(exitCode), 100)
}

process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))

startStudioApi()
start("astro-dev", "npm", ["run", "dev"])
startScriptWatcher()

console.log("[studio] local studio is starting")
