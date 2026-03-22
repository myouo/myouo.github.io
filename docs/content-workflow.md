# Content Workflow

This site is deployed with GitHub Pages, so the editorial workflow is repository-first:

- Draft and manage content locally.
- Submit every meaningful content or status change through a Git branch and pull request.
- Only content with `status: published` appears on the public site after the PR is merged into `main`.

## Status Model

- `draft`: hidden from the public site
- `published`: visible on the public site
- `archived`: hidden from the public site

`draft: true` is still supported for older content, but new entries should use `status`.

## Commands

```bash
npm run content -- new blog --title "My New Post"
npm run content -- list
npm run content -- set-status blog my-new-post published
npm run content -- delete blog my-new-post
npm run content -- submit-review blog my-new-post --status published --push
npm run studio:api
npm run studio:dev
```

## Local Studio UI

If you want a visual management interface, use the local Studio:

```bash
npm run studio:dev
```

This starts:

- the Astro dev server for the website UI
- the local Studio API on `http://127.0.0.1:4111`

Then open `/studio` in the local site.

## Recommended Flow

### 1. Create a draft

```bash
npm run content -- new blog --title "BatchMortal Notes" --summary "What I built and why"
```

This creates a markdown entry with `status: draft`.

### 2. Write and edit locally

Edit the generated file under `src/content/blog/<slug>/index.md` or `src/content/projects/<slug>/index.md`.

### 3. Submit for review

If the content should stay hidden after merge:

```bash
npm run content -- submit-review blog my-new-post --push
```

If the content should go live when the PR is merged:

```bash
npm run content -- submit-review blog my-new-post --status published --push
```

The tool will:

- create a dedicated review branch
- commit only the selected entry path
- optionally push the branch
- print a GitHub compare URL for PR creation

If GitHub CLI is installed, you can also append `--create-pr`.

### 4. Publish or archive later

```bash
npm run content -- submit-review blog my-new-post --status archived --push
```

### 5. Delete content

Delete locally:

```bash
npm run content -- delete blog my-new-post
```

Create a deletion review branch:

```bash
npm run content -- submit-review blog my-new-post --delete --push
```

## Notes

- Public pages, search, RSS, and article routes only include `published` entries.
- Pull requests run `npm run build` automatically through GitHub Actions.
- If you want GitHub to enforce approvals, configure branch protection for `main` in the repository settings.
