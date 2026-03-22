import type { CollectionEntry } from "astro:content"

export const CONTENT_STATUSES = ["draft", "published", "archived"] as const

export type ContentStatus = (typeof CONTENT_STATUSES)[number]

type PublishableData = {
  draft?: boolean
  status?: ContentStatus
}

export function getContentStatus(data: PublishableData): ContentStatus {
  if (data.draft === true) return "draft"
  return data.status ?? "published"
}

export function isPublishedContent(data: PublishableData): boolean {
  return getContentStatus(data) === "published"
}

export function filterPublishedEntries<T extends CollectionEntry<"blog"> | CollectionEntry<"projects">>(
  entries: T[],
): T[] {
  return entries.filter((entry) => isPublishedContent(entry.data))
}
