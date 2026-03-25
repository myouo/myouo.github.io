import type { Site, Page, Links, Socials } from "@types"

// Global
export const SITE: Site = {
  TITLE: "Myouo",
  DESCRIPTION: "Portfolio and blog of Myouo, a programming enthusiast who enjoys building small things and solving problems.",
  AUTHOR: "myouo",
}

// Journey Page
export const JOURNEY: Page = {
  TITLE: "Journey",
  DESCRIPTION: "My open source contributions and independent projects.",
}

// Blog Page
export const BLOG: Page = {
  TITLE: "Blog",
  DESCRIPTION: "Writing on topics I am passionate about.",
}

// Projects Page 
export const PROJECTS: Page = {
  TITLE: "Projects",
  DESCRIPTION: "Recent projects I have worked on.",
}

// Search Page
export const SEARCH: Page = {
  TITLE: "Search",
  DESCRIPTION: "Search all posts and projects by keyword.",
}

// Links
export const LINKS: Links = [
  { 
    TEXT: "Home", 
    HREF: "/", 
  },
  { 
    TEXT: "Journey", 
    HREF: "/journey", 
  },
  { 
    TEXT: "Blog", 
    HREF: "/blog", 
  },
  { 
    TEXT: "Projects", 
    HREF: "/projects", 
  },
]

// Socials
export const SOCIALS: Socials = [
  { 
    NAME: "Email",
    ICON: "email", 
    TEXT: "myouo@proton.me",
    HREF: "mailto:myouo@proton.me",
  },
  { 
    NAME: "Github",
    ICON: "github",
    TEXT: "myouo",
    HREF: "https://github.com/myouo"
  },
  { 
    NAME: "Twitter",
    ICON: "twitter-x",
    TEXT: "myouo",
    HREF: "https://twitter.com/myouomee",
  },
]
