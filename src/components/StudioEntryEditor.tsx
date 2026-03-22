import { Show, createSignal, onMount } from "solid-js"

type EntryStatus = "draft" | "published" | "archived"
type EntryCollection = "blog" | "projects"

type StudioEntryDetail = {
  collection: EntryCollection
  slug: string
  status: EntryStatus
  date: string
  title: string
  summary: string
  tags: string[]
  filePath: string
  body: string
  repoUrl: string
  demoUrl: string
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
}

type Props = {
  collection: EntryCollection
  slug: string
  backHref?: string
}

const API_BASE = "http://127.0.0.1:4111"

const inputClass = "w-full px-3 py-2 rounded-lg outline-none placeholder-neutral-400 dark:placeholder-neutral-500 text-black dark:text-white bg-black/5 dark:bg-white/10 hover:bg-black/10 hover:dark:bg-white/15 focus:bg-black/10 focus:dark:bg-white/15 border border-black/10 dark:border-white/10 focus:border-black/40 focus:dark:border-white/40 transition-colors duration-300 ease-in-out"
const textareaClass = `${inputClass} min-h-28 resize-y`
const cardClass = "rounded-2xl border border-black/10 dark:border-white/20 bg-white/70 dark:bg-white/[0.03] shadow-[0_10px_30px_rgba(0,0,0,0.05)] dark:shadow-[0_10px_30px_rgba(255,255,255,0.03)]"
const panelClass = `${cardClass} p-5`
const primaryButtonClass = "rounded-full border border-black dark:border-white bg-black dark:bg-white px-4 py-2 text-sm font-semibold text-white dark:text-black hover:opacity-85 transition-opacity duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
const secondaryButtonClass = "rounded-full border border-black/10 dark:border-white/20 px-4 py-2 text-sm font-semibold text-black/75 dark:text-white/75 hover:bg-black/5 hover:dark:bg-white/10 hover:text-black hover:dark:text-white transition-colors duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"

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

export default function StudioEntryEditor(props: Props) {
  const [entry, setEntry] = createSignal<StudioEntryDetail | null>(null)
  const [repoState, setRepoState] = createSignal<RepoState | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [reviewing, setReviewing] = createSignal(false)
  const [pushOnReview, setPushOnReview] = createSignal(false)
  const [message, setMessage] = createSignal("")
  const [error, setError] = createSignal("")

  const [title, setTitle] = createSignal("")
  const [summary, setSummary] = createSignal("")
  const [date, setDate] = createSignal("")
  const [tags, setTags] = createSignal("")
  const [repoUrl, setRepoUrl] = createSignal("")
  const [demoUrl, setDemoUrl] = createSignal("")
  const [body, setBody] = createSignal("")

  function syncForm(detail: StudioEntryDetail) {
    setEntry(detail)
    setTitle(detail.title)
    setSummary(detail.summary)
    setDate(detail.date)
    setTags(detail.tags.join(", "))
    setRepoUrl(detail.repoUrl)
    setDemoUrl(detail.demoUrl)
    setBody(detail.body)
  }

  async function refresh() {
    setLoading(true)
    setError("")

    try {
      const [repo, detail] = await Promise.all([
        request<RepoState>("/repo-state"),
        request<StudioEntryDetail>(`/entries/${props.collection}/${encodeURIComponent(props.slug)}`),
      ])

      setRepoState(repo)
      syncForm(detail)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    void refresh()
  })

  async function saveEditor(event: SubmitEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage("")
    setError("")

    try {
      const updated = await request<StudioEntryDetail>(`/entries/${props.collection}/${encodeURIComponent(props.slug)}`, {
        method: "PUT",
        body: JSON.stringify({
          title: title(),
          summary: summary(),
          date: date(),
          tags: tags(),
          repoUrl: props.collection === "projects" ? repoUrl() : undefined,
          demoUrl: props.collection === "projects" ? demoUrl() : undefined,
          body: body(),
        }),
      })

      syncForm(updated)
      setMessage(`Updated ${updated.collection}/${updated.slug} locally. Use Prepare Review when ready.`)
      setRepoState(await request<RepoState>("/repo-state"))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function submitReview() {
    const current = entry()
    if (!current) return

    setReviewing(true)
    setMessage("")
    setError("")

    try {
      const result = await request<ReviewResult>(`/entries/${current.collection}/${encodeURIComponent(current.slug)}/review`, {
        method: "POST",
        body: JSON.stringify({
          status: current.status,
          push: pushOnReview(),
        }),
      })

      setMessage(result.prUrl
        ? `Review branch ${result.branch} is ready. PR: ${result.prUrl}`
        : `Review branch ${result.branch} is ready.`)
      await refresh()
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError))
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div class="space-y-6">
      <section class={panelClass}>
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div class="text-sm uppercase tracking-[0.2em] text-black/50 dark:text-white/40">
              Studio Editor
            </div>
            <h2 class="mt-2 text-2xl font-semibold text-black dark:text-white">
              Edit published content
            </h2>
            <p class="mt-2 max-w-2xl">
              Save changes locally, then submit them through the existing review branch workflow.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Show when={repoState()}>
              {(state) => (
                <div class="rounded-full border border-black/10 dark:border-white/20 px-3 py-1 text-xs uppercase tracking-[0.18em]">
                  Branch {state().branch}
                </div>
              )}
            </Show>
            <a href={props.backHref ?? "/studio"} class={secondaryButtonClass}>
              Back To Studio
            </a>
          </div>
        </div>

        <Show when={repoState()?.dirty}>
          <div class="mt-4 rounded-xl border border-black/10 dark:border-white/20 bg-black/[0.03] dark:bg-white/[0.04] p-4 text-sm">
            <div>Working tree has local changes. `submit-review` only succeeds when unrelated files are clean.</div>
            <div class="mt-3 flex flex-wrap gap-2">
              {repoState()?.dirtyPaths.slice(0, 6).map((dirtyPath) => (
                <span class="rounded-lg border border-black/10 dark:border-white/20 px-2.5 py-1 font-mono text-[11px] normal-case tracking-normal break-all">
                  {dirtyPath}
                </span>
              ))}
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

      <Show when={!loading()} fallback={<section class={panelClass}>Loading editor...</section>}>
        <Show when={entry()} fallback={<section class={panelClass}>Entry not found.</section>}>
          {(detail) => (
            <section class={panelClass}>
              <div class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div class="text-sm font-semibold text-black dark:text-white">
                    {detail().collection}/{detail().slug}
                  </div>
                  <div class="text-sm">
                    Current status: {detail().status}
                  </div>
                </div>
                <div class="flex items-center gap-3">
                  <label class="flex items-center gap-3 rounded-xl border border-black/10 dark:border-white/20 px-3 py-2">
                    <input type="checkbox" checked={pushOnReview()} onChange={(event) => setPushOnReview(event.currentTarget.checked)} />
                    <span class="text-sm">Push branch on review</span>
                  </label>
                  <button type="button" class={secondaryButtonClass} onClick={() => void submitReview()} disabled={reviewing() || saving()}>
                    {reviewing() ? "Preparing..." : "Prepare Review"}
                  </button>
                </div>
              </div>

              <form class="grid gap-4 lg:grid-cols-2" onSubmit={saveEditor}>
                <label class="block lg:col-span-2">
                  <div class="mb-2 text-sm font-semibold text-black dark:text-white">Title</div>
                  <input class={inputClass} value={title()} onInput={(event) => setTitle(event.currentTarget.value)} />
                </label>

                <label class="block">
                  <div class="mb-2 text-sm font-semibold text-black dark:text-white">Date</div>
                  <input class={inputClass} value={date()} onInput={(event) => setDate(event.currentTarget.value)} placeholder="2026-03-22" />
                </label>

                <label class="block">
                  <div class="mb-2 text-sm font-semibold text-black dark:text-white">Tags</div>
                  <input class={inputClass} value={tags()} onInput={(event) => setTags(event.currentTarget.value)} placeholder="Python, Automation, Mahjong" />
                </label>

                <label class="block lg:col-span-2">
                  <div class="mb-2 text-sm font-semibold text-black dark:text-white">Summary</div>
                  <textarea class={textareaClass} value={summary()} onInput={(event) => setSummary(event.currentTarget.value)} />
                </label>

                <Show when={props.collection === "projects"}>
                  <>
                    <label class="block">
                      <div class="mb-2 text-sm font-semibold text-black dark:text-white">Repository URL</div>
                      <input class={inputClass} value={repoUrl()} onInput={(event) => setRepoUrl(event.currentTarget.value)} placeholder="https://github.com/myouo/project" />
                    </label>

                    <label class="block">
                      <div class="mb-2 text-sm font-semibold text-black dark:text-white">Demo URL</div>
                      <input class={inputClass} value={demoUrl()} onInput={(event) => setDemoUrl(event.currentTarget.value)} placeholder="https://example.com" />
                    </label>
                  </>
                </Show>

                <label class="block lg:col-span-2">
                  <div class="mb-2 text-sm font-semibold text-black dark:text-white">Body</div>
                  <textarea class={`${textareaClass} min-h-[26rem] font-mono text-sm leading-7`} value={body()} onInput={(event) => setBody(event.currentTarget.value)} />
                </label>

                <div class="lg:col-span-2 flex justify-end">
                  <button type="submit" class={primaryButtonClass} disabled={saving() || reviewing()}>
                    {saving() ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </section>
          )}
        </Show>
      </Show>
    </div>
  )
}
