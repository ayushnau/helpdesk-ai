# Example Sites

These are sample merchant websites that embed the helpdesk.ai chat widget.

## Running

1. Start the backend:
   ```bash
   cd helpdesk-ai
   bun run server
   ```

2. Open an example in your browser:
   ```bash
   open examples/posthog-site.html
   open examples/acme-site.html
   ```

3. Click the chat bubble in the bottom-right corner and ask a question.

## How it works

Each site adds a single `<script>` tag:

```html
<script
  src="http://localhost:3001/widget.js"
  data-tenant-id="posthog"
  data-key="tk_posthog_demo"
  data-title="PostHog Support"
  data-accent="#1D4AFF">
</script>
```

| Attribute | Purpose |
|-----------|---------|
| `data-tenant-id` | Which tenant's knowledge base to search |
| `data-key` | Public widget token (authenticates the request) |
| `data-title` | Chat widget header title |
| `data-accent` | Brand color for the chat bubble and accents |
| `data-position` | `right` (default) or `left` |

The widget key (`tk_...`) is a public token — safe to embed in HTML. It is NOT the LLM API key. The actual API key is stored encrypted on the server and never exposed to the browser.
