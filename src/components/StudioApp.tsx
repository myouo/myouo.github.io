import { For, Show, createMemo, createSignal, onMount } from "solid-js"

type EntryStatus = "draft" | "published" | "archived"
type EntryCollection = "blog" | "projects"

type StudioEntry = {
  collection: EntryCollection
  slug: string
  status: EntryStatus
  date: string
  title: string
  summary: string
  tags: string[]
  filePath: string
}

type RepoState = {
  branch: string
  dirty: boolean
  dirtyPaths: string[]
}

type ReviewResult = {
  branch: string
  base: string
  prUrl: string | null
  deleteReview?: boolean
}

const API_BASE = "http://127.0.0.1:4111"

const inputClass = "w-full px-3 py-2 rounded-lg outline-none placeholder-neutral-400 dark:placeholder-neutral-500 text-black dark:text-white bg-black/5 dark:bg-white/10 hover:bg-black/10 hover:dark:bg-white/15 focus:bg-black/10 focus:dark:bg-white/15 border border-black/10 dark:border-white/10 focus:border-black/40 focus:dark:border-white/40 transition-colors duration-300 ease-in-out"
const textareaClass = `${inputClass} min-h-28 resize-y`
const cardClass = "rounded-2xl border border-black/10 dark:border-white/20 bg-white/70 dark:bg-white/[0.03] shadow-[0_10px_30px_rgba(0,0,0,0.05)] dark:shadow-[0_10px_30px_rgba(255,255,255,0.03)]"
const panelClass = `${cardClass} p-5`
const primaryButtonClass = "rounded-full border border-black dark:border-white bg-black dark:bg-white px-4 py-2 text-sm font-semibold text-white dark:text-black hover:opacity-85 transition-opacity duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
const secondaryButtonClass = "rounded-full border border-black/10 dark:border-white/20 px-4 py-2 text-sm font-semibold text-black/75 dark:text-white/75 hover:bg-black/5 hover:dark:bg-white/10 hover:text-black hover:dark:text-white transition-colors duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
const dangerButtonClass = "rounded-full border border-red-500/20 bg-red-500/5 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-500/10 dark:text-red-300 transition-colors duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"

function studioUrl(pathname: string): string {
  return `${API_BASE}${pathname}`
}

async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(studioUrl(pathname), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })

  const payload = await response.json()
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `request failed with ${response.status}`)
  }

  return payload.data as T
}

function statusPillClass(status: EntryStatus) {
  switch (status) {
    case "published":
      return "border-black/15 bg-black text-white dark:border-white/25 dark:bg-white dark:text-black"
    case "archived":
      return "border-black/10 bg-black/5 text-black/70 dark:border-white/20 dark:bg-white/10 dark:text-white/70"
    default:
      return "border-black/10 bg-transparent text-black/70 dark:border-white/20 dark:text-white/70"
  }
}

export default function StudioApp() {
  const [entries, setEntries] = createSignal<StudioEntry[]>([])
  const [repoState, setRepoState] = createSignal<RepoState | null>(null)
  const [apiOnline, setApiOnline] = createSignal(false)
  const [loading, setLoading] = createSignal(true)
  const [busySlug, setBusySlug] = createSignal<string | null>(null)
  const [message, setMessage] = createSignal<string>("")
  const [error, setError] = createSignal<string>("")

  const [query, setQuery] = createSignal("")
  const [collectionFilter, setCollectionFilter] = createSignal<"all" | EntryCollection>("all")
  const [statusFilter, setStatusFilter] = createSignal<"all" | EntryStatus>("all")
  const [pushOnReview, setPushOnReview] = createSignal(false)

  const [newCollection, setNewCollection] = createSignal<EntryCollection>("blog")
  const [newTitle, setNewTitle] = createSignal("")
  const [newSummary, setNewSummary] = createSignal("")
  const [newTags, setNewTags] = createSignal("")
  const [newSlug, setNewSlug] = createSignal("")
  const [newStatus, setNewStatus] = createSignal<EntryStatus>("draft")
  const [newRepoUrl, setNewRepoUrl] = createSignal("")
  const [newDemoUrl, setNewDemoUrl] = createSignal("")

  const entryStats = createMemo(() => {
    const currentEntries = entries()
    return {
      total: currentEntries.length,
      draft: currentEntries.filter((entry) => entry.status === "draft").length,
      published: currentEntries.filter((entry) => entry.status === "published").length,
      archived: currentEntries.filter((entry) => entry.status === "archived").length,
    }
  })

  const filteredEntries = createMemo(() => {
    const keyword = query().trim().toLowerCase()

    return entries().filter((entry) => {
      if (collectionFilter() !== "all" && entry.collection !== collectionFilter()) return false
      if (statusFilter() !== "all" && entry.status !== statusFilter()) return false
      if (!keyword) return true

      return [
        entry.title,
        entry.summary,
        entry.slug,
        entry.collection,
        entry.status,
        ...entry.tags,
      ].some((part) => part.toLowerCase().includes(keyword))
    })
  })

  async function refresh() {
    setLoading(true)
    setError("")

    try {
      const [repo, listed] = await Promise.all([
        request<RepoState>("/repo-state"),
        request<StudioEntry[]>("/entries?collection=all"),
      ])

      setRepoState(repo)
      setEntries(listed)
      setApiOnline(true)
    } catch (fetchError) {
      setApiOnline(false)
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    void refresh()
  })

  async function createEntry(event: SubmitEvent) {
    event.preventDefault()
    setBusySlug("__create__")
    setMessage("")
    setError("")

    try {
      const created = await request<StudioEntry>("/entries", {
        method: "POST",
        body: JSON.stringify({
          collection: newCollection(),
          title: newTitle(),
          summary: newSummary(),
          tags: newTags(),
          slug: newSlug(),
          status: newStatus(),
          repoUrl: newRepoUrl(),
          demoUrl: newDemoUrl(),
        }),
      })

      setMessage(`Created ${created.collection}/${created.slug}`)
      setNewTitle("")
      setNewSummary("")
      setNewTags("")
      setNewSlug("")
      setNewRepoUrl("")
      setNewDemoUrl("")
      await refresh()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setBusySlug(null)
    }
  }

  async function updateStatus(entry: StudioEntry, status: EntryStatus) {
    setBusySlug(entry.slug)
    setMessage("")
    setError("")

    try {
      await request(`/entries/${entry.collection}/${encodeURIComponent(entry.slug)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      })
      setMessage(`Updated ${entry.collection}/${entry.slug} -> ${status}`)
      await refresh()
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : String(statusError))
    } finally {
      setBusySlug(null)
    }
  }

  async function submitReview(entry: StudioEntry) {
    setBusySlug(entry.slug)
    setMessage("")
    setError("")

    try {
      const result = await request<ReviewResult>(`/entries/${entry.collection}/${encodeURIComponent(entry.slug)}/review`, {
        method: "POST",
        body: JSON.stringify({
          status: entry.status,
          push: pushOnReview(),
        }),
      })

      const reviewMessage = result.prUrl
        ? `Review branch ${result.branch} is ready. PR: ${result.prUrl}`
        : `Review branch ${result.branch} is ready.`

      setMessage(reviewMessage)
      await refresh()
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError))
    } finally {
      setBusySlug(null)
    }
  }

  async function submitDeleteReview(entry: StudioEntry) {
    const confirmed = window.confirm(`Create a deletion review for ${entry.collection}/${entry.slug}? This will remove the entry locally and prepare a review branch.`)
    if (!confirmed) return

    setBusySlug(entry.slug)
    setMessage("")
    setError("")

    try {
      const result = await request<ReviewResult>(`/entries/${entry.collection}/${encodeURIComponent(entry.slug)}/review`, {
        method: "POST",
        body: JSON.stringify({
          delete: true,
          push: pushOnReview(),
        }),
      })

      const reviewMessage = result.prUrl
        ? `Deletion review ${result.branch} is ready. PR: ${result.prUrl}`
        : `Deletion review ${result.branch} is ready.`

      setMessage(reviewMessage)
      await refresh()
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError))
    } finally {
      setBusySlug(null)
    }
  }

  async function deleteLocalDraft(entry: StudioEntry) {
    const confirmed = window.confirm(`Delete ${entry.collection}/${entry.slug} locally? This does not create a review branch.`)
    if (!confirmed) return

    setBusySlug(entry.slug)
    setMessage("")
    setError("")

    try {
      await request(`/entries/${entry.collection}/${encodeURIComponent(entry.slug)}`, {
        method: "DELETE",
      })
      setMessage(`Deleted ${entry.collection}/${entry.slug}`)
      await refresh()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    } finally {
      setBusySlug(null)
    }
  }

  return (
    <div class="space-y-6">
      <section class={panelClass}>
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div class="text-sm uppercase tracking-[0.2em] text-black/50 dark:text-white/40">
              Local Studio
            </div>
            <h2 class="mt-2 text-2xl font-semibold text-black dark:text-white">
              Editorial control panel
            </h2>
            <p class="mt-2 max-w-2xl">
              This page only works with the local content API. Public GitHub Pages builds stay read-only.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <div class={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em] ${apiOnline() ? "border-black/15 bg-black text-white dark:border-white/25 dark:bg-white dark:text-black" : "border-black/10 bg-transparent text-black/60 dark:border-white/20 dark:text-white/60"}`}>
              {apiOnline() ? "API Online" : "API Offline"}
            </div>
            <Show when={repoState()}>
              {(state) => (
                <div class="rounded-full border border-black/10 dark:border-white/20 px-3 py-1 text-xs uppercase tracking-[0.18em]">
                  Branch {state().branch}
                </div>
              )}
            </Show>
            <button class={secondaryButtonClass} onClick={() => void refresh()} disabled={loading()}>
              Refresh
            </button>
          </div>
        </div>

        <Show when={repoState()?.dirty}>
          <div class="mt-4 rounded-xl border border-black/10 dark:border-white/20 bg-black/[0.03] dark:bg-white/[0.04] p-4 text-sm">
            <div>Working tree has local changes. `submit-review` only succeeds when unrelated files are clean.</div>
            <div class="mt-3 flex flex-wrap gap-2">
              <For each={repoState()?.dirtyPaths.slice(0, 6) ?? []}>
                {(dirtyPath) => (
                  <span class="rounded-lg border border-black/10 dark:border-white/20 px-2.5 py-1 font-mono text-[11px] normal-case tracking-normal break-all">
                    {dirtyPath}
                  </span>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={message()}>
          <div class="mt-4 break-words rounded-xl border border-black/10 dark:border-white/20 bg-black/[0.03] dark:bg-white/[0.04] p-4 text-sm text-black dark:text-white">
            {message()}
          </div>
        </Show>

        <Show when={error()}>
          <div class="mt-4 break-words rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300">
            {error()}
          </div>
        </Show>
      </section>

      <section class={panelClass}>
        <div class="mb-4 flex items-center justify-between gap-4">
          <div>
            <div class="text-sm font-semibold text-black dark:text-white">Create new entry</div>
            <div class="text-sm">Generate a draft post or project, then review it through GitHub PR.</div>
          </div>
        </div>

        <form class="grid gap-4 lg:grid-cols-2" onSubmit={createEntry}>
          <label class="block">
            <div class="mb-2 text-sm font-semibold text-black dark:text-white">Collection</div>
            <select class={inputClass} value={newCollection()} onInput={(event) => setNewCollection(event.currentTarget.value as EntryCollection)}>
              <option value="blog">Blog</option>
              <option value="projects">Projects</option>
            </select>
          </label>

          <label class="block">
            <div class="mb-2 text-sm font-semibold text-black dark:text-white">Status</div>
            <select class={inputClass} value={newStatus()} onInput={(event) => setNewStatus(event.currentTarget.value as EntryStatus)}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </label>

          <label class="block lg:col-span-2">
            <div class="mb-2 text-sm font-semibold text-black dark:text-white">Title</div>
            <input class={inputClass} value={newTitle()} onInput={(event) => setNewTitle(event.currentTarget.value)} placeholder="BatchMortal: lessons from browser automation" />
          </label>

          <label class="block lg:col-span-2">
            <div class="mb-2 text-sm font-semibold text-black dark:text-white">Summary</div>
            <textarea class={textareaClass} value={newSummary()} onInput={(event) => setNewSummary(event.currentTarget.value)} placeholder="One concise summary for cards, search, and metadata." />
          </label>

          <label class="block">
            <div class="mb-2 text-sm font-semibold text-black dark:text-white">Tags</div>
            <input class={inputClass} value={newTags()} onInput={(event) => setNewTags(event.currentTarget.value)} placeholder="Python, Automation, Mahjong" />
          </label>

          <label class="block">
            <div class="mb-2 text-sm font-semibold text-black dark:text-white">Slug</div>
            <input class={inputClass} value={newSlug()} onInput={(event) => setNewSlug(event.currentTarget.value)} placeholder="Optional; auto-generated if empty" />
          </label>

          <Show when={newCollection() === "projects"}>
            <>
              <label class="block">
                <div class="mb-2 text-sm font-semibold text-black dark:text-white">Repository URL</div>
                <input class={inputClass} value={newRepoUrl()} onInput={(event) => setNewRepoUrl(event.currentTarget.value)} placeholder="https://github.com/myouo/project" />
              </label>

              <label class="block">
                <div class="mb-2 text-sm font-semibold text-black dark:text-white">Demo URL</div>
                <input class={inputClass} value={newDemoUrl()} onInput={(event) => setNewDemoUrl(event.currentTarget.value)} placeholder="https://example.com" />
              </label>
            </>
          </Show>

          <div class="lg:col-span-2 flex justify-end">
            <button type="submit" class={primaryButtonClass} disabled={busySlug() === "__create__"}>
              {busySlug() === "__create__" ? "Creating..." : "Create Entry"}
            </button>
          </div>
        </form>
      </section>

      <section class="grid gap-6 xl:grid-cols-[260px,1fr]">
        <aside class={`${panelClass} h-fit`}>
          <div class="text-sm font-semibold text-black dark:text-white">Filters</div>
          <div class="mt-4">
            <input class={inputClass} value={query()} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search title, slug, tags..." />
          </div>

          <div class="mt-5">
            <div class="mb-2 text-xs uppercase tracking-[0.18em] text-black/50 dark:text-white/40">Collection</div>
            <div class="flex flex-wrap gap-2">
              <For each={["all", "blog", "projects"] as const}>
                {(item) => (
                  <button
                    type="button"
                    class={collectionFilter() === item ? primaryButtonClass : secondaryButtonClass}
                    onClick={() => setCollectionFilter(item)}
                  >
                    {item}
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="mt-5">
            <div class="mb-2 text-xs uppercase tracking-[0.18em] text-black/50 dark:text-white/40">Status</div>
            <div class="flex flex-wrap gap-2">
              <For each={["all", "draft", "published", "archived"] as const}>
                {(item) => (
                  <button
                    type="button"
                    class={statusFilter() === item ? primaryButtonClass : secondaryButtonClass}
                    onClick={() => setStatusFilter(item)}
                  >
                    {item}
                  </button>
                )}
              </For>
            </div>
          </div>

          <label class="mt-5 flex items-center gap-3 rounded-xl border border-black/10 dark:border-white/20 p-3">
            <input type="checkbox" checked={pushOnReview()} onChange={(event) => setPushOnReview(event.currentTarget.checked)} />
            <span class="text-sm">Push branch on review submit</span>
          </label>

          <div class="mt-5 rounded-xl border border-black/10 dark:border-white/20 p-4">
            <div class="text-xs uppercase tracking-[0.18em] text-black/50 dark:text-white/40">Overview</div>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <div class="rounded-xl bg-black/5 p-3 dark:bg-white/10">
                <div class="text-[11px] uppercase tracking-[0.14em] text-black/45 dark:text-white/35">Total</div>
                <div class="mt-1 text-xl font-semibold text-black dark:text-white">{entryStats().total}</div>
              </div>
              <div class="rounded-xl bg-black/5 p-3 dark:bg-white/10">
                <div class="text-[11px] uppercase tracking-[0.14em] text-black/45 dark:text-white/35">Draft</div>
                <div class="mt-1 text-xl font-semibold text-black dark:text-white">{entryStats().draft}</div>
              </div>
              <div class="rounded-xl bg-black/5 p-3 dark:bg-white/10">
                <div class="text-[11px] uppercase tracking-[0.14em] text-black/45 dark:text-white/35">Published</div>
                <div class="mt-1 text-xl font-semibold text-black dark:text-white">{entryStats().published}</div>
              </div>
              <div class="rounded-xl bg-black/5 p-3 dark:bg-white/10">
                <div class="text-[11px] uppercase tracking-[0.14em] text-black/45 dark:text-white/35">Archived</div>
                <div class="mt-1 text-xl font-semibold text-black dark:text-white">{entryStats().archived}</div>
              </div>
            </div>
          </div>
        </aside>

        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4">
            <div class="text-sm uppercase tracking-[0.18em] text-black/50 dark:text-white/40">
              Showing {filteredEntries().length} of {entries().length}
            </div>
          </div>

          <Show when={!loading()} fallback={<div class={panelClass}>Loading studio data...</div>}>
            <Show when={filteredEntries().length > 0} fallback={<div class={panelClass}>No entries match the current filters.</div>}>
              <For each={filteredEntries()}>
                {(entry) => (
                  <div class={`${panelClass} space-y-4`}>
                    <div class="grid gap-5 2xl:grid-cols-[minmax(0,1fr),auto] 2xl:items-start">
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="rounded-full border border-black/10 dark:border-white/20 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em]">
                            {entry.collection}
                          </span>
                          <span class={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${statusPillClass(entry.status)}`}>
                            {entry.status}
                          </span>
                          <span class="text-xs uppercase tracking-[0.18em] text-black/45 dark:text-white/35">
                            {entry.date}
                          </span>
                        </div>
                        <h3 class="mt-3 break-words text-xl font-semibold text-black dark:text-white">{entry.title}</h3>
                        <p class="mt-2 break-words leading-7">{entry.summary || "No summary yet."}</p>
                        <div class="mt-3 break-all text-xs uppercase tracking-[0.14em] text-black/45 dark:text-white/35">
                          {entry.slug} · {entry.filePath}
                        </div>
                        <div class="mt-3 flex flex-wrap gap-2">
                          <For each={entry.tags}>
                            {(tag) => (
                              <span class="rounded-full bg-black/5 px-2.5 py-1 text-xs uppercase tracking-[0.14em] dark:bg-white/10">
                                {tag}
                              </span>
                            )}
                          </For>
                        </div>
                      </div>

                      <div class="flex flex-wrap gap-2 border-t border-black/10 pt-4 dark:border-white/20 2xl:max-w-[18rem] 2xl:justify-end 2xl:border-t-0 2xl:pt-0">
                        <button type="button" class={secondaryButtonClass} disabled={busySlug() === entry.slug || entry.status === "draft"} onClick={() => void updateStatus(entry, "draft")}>
                          Draft
                        </button>
                        <button type="button" class={secondaryButtonClass} disabled={busySlug() === entry.slug || entry.status === "published"} onClick={() => void updateStatus(entry, "published")}>
                          Publish
                        </button>
                        <button type="button" class={secondaryButtonClass} disabled={busySlug() === entry.slug || entry.status === "archived"} onClick={() => void updateStatus(entry, "archived")}>
                          Archive
                        </button>
                        <button type="button" class={primaryButtonClass} disabled={busySlug() === entry.slug} onClick={() => void submitReview(entry)}>
                          {busySlug() === entry.slug ? "Working..." : "Prepare Review"}
                        </button>
                        <button type="button" class={dangerButtonClass} disabled={busySlug() === entry.slug} onClick={() => void submitDeleteReview(entry)}>
                          Delete Review
                        </button>
                        <Show when={entry.status === "draft"}>
                          <button type="button" class={secondaryButtonClass} disabled={busySlug() === entry.slug} onClick={() => void deleteLocalDraft(entry)}>
                            Delete Local
                          </button>
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </section>
    </div>
  )
}
