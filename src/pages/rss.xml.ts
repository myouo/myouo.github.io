import rss from "@astrojs/rss"
import { getCollection } from "astro:content"
import { SITE } from "@consts"
import { filterPublishedEntries } from "@lib/content"

type Context = {
  site: string
}

export async function GET(context: Context) {
	const posts = filterPublishedEntries(await getCollection("blog"))
  const projects = filterPublishedEntries(await getCollection("projects"))

  const items = [...posts, ...projects]

  items.sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime())

  return rss({
    title: SITE.TITLE,
    description: SITE.DESCRIPTION,
    site: context.site,
    items: items.map((item) => ({
      title: item.data.title,
      description: item.data.summary,
      pubDate: item.data.date,
      link: item.collection === "blog"
        ? `/blog/${item.slug}/`
        : `/projects/${item.slug}/`,
    })),
  })
}
