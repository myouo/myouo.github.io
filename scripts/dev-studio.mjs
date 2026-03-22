#!/usr/bin/env node

import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

const children = []

function start(name, command, args) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  })

  child.on("exit", (code, signal) => {
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

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM")
    }
  }

  setTimeout(() => process.exit(exitCode), 100)
}

process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))

start("studio-api", process.execPath, ["./scripts/content-studio-server.mjs"])
start("astro-dev", "npm", ["run", "dev"])

console.log("[studio] local studio is starting")
