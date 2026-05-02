<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Styling convention

Tailwind v4 is configured in `src/app/globals.css` — new components should use it.

- New components: Tailwind utility classes
- Existing inline `style={{...}}` blocks: leave as-is unless you're already touching the file for other reasons (avoid mass rewrites, keeps diffs reviewable)
- Theme tokens live in `:root` of `globals.css` (`--vb-bg`, `--accent`, etc.) — reference via `var(--vb-bg)` in inline styles or `bg-[var(--vb-bg)]` in classes
