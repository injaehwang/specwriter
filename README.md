# specwriter

Analyze existing projects and generate comprehensive specifications for AI coding assistants.

One command to give every AI tool full context about your project — structure, components, conventions, and tooling.

## Quick Start

```bash
cd your-project
npx specwriter init
```

That's it. specwriter will:

1. Detect your framework (Next.js, React, Vue, Nuxt, Svelte, Angular)
2. Extract routes, components, props, state, and dependencies
3. Analyze your tooling (TypeScript, ESLint, Prettier config)
4. Generate specs in `.specwriter/`
5. Inject references into your AI configs (Claude, Cursor, Copilot, Gemini, etc.)
6. Register MCP servers with API keys auto-resolved from `.env` files

## What Gets Generated

```
.specwriter/
├── AI_CONTEXT.md            # Universal context for any AI
├── mcp-servers.json         # Recommended MCP servers for your stack
├── spec.json / spec.md      # Project overview, tech stack, structure
├── rules.json / rules.md    # Coding conventions, naming patterns
├── pages/
│   ├── _index.json / .md    # Route map
│   └── <name>.json / .md    # Per-page spec with ASCII wireframe
└── components/
    ├── _index.json / .md    # Component registry + dependency graph
    └── <name>.json / .md    # Per-component: props, state, events
```

### Example: Generated Component Spec

```markdown
# DataTable

**Type:** component
**File:** `src/components/DataTable.tsx`
**Client Component**

## Props

| Name       | Type                     | Required | Default |
|------------|--------------------------|----------|---------|
| `columns`  | `string[]`               | Yes      | -       |
| `data`     | `Record<string, unknown>[]` | No    | []      |
| `pageSize` | `number`                 | No       | 10      |

## State

| Name     | Type           | Source   | Initial |
|----------|----------------|----------|---------|
| `page`   | `number`       | useState | 0       |
| `sortBy` | `string | null`| useState | null    |
```

### Example: Generated Wireframe

```
┌──────────────────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────────────────┐ │
│ │ <Header>                                             │ │
│ └──────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐ │
│ │ <StatCard>                                           │ │
│ └──────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐ │
│ │ <DataTable>                                          │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

## AI Integration

specwriter auto-detects AI tools in your project and injects `.specwriter/` references:

| AI Tool | Detection | Action |
|---------|-----------|--------|
| Claude Code | `CLAUDE.md` or `.claude/` | Appends reference + registers MCP server |
| Cursor | `.cursor/` or `.cursorrules` | Creates `.cursor/rules/specwriter.mdc` + MCP |
| GitHub Copilot | `.github/` | Appends to `copilot-instructions.md` |
| Gemini | `.gemini/` | Appends to `GEMINI.md` |
| Windsurf | `.windsurf/` or `.windsurfrules` | Creates rule file or appends |
| Cline | `.clinerules` | Appends reference |
| JetBrains AI | `.aiassistant/` | Creates rule file |
| Aider | `.aider.conf.yml` | Adds to `read:` section |
| Continue.dev | `.continuerc.json` | Adds to `docs` array |
| Tabnine | `.tabnine/` | Creates guideline file |
| OpenAI Codex | `AGENTS.md` | Appends reference |

Existing content is never deleted — specwriter uses `<!-- specwriter:start/end -->` markers for safe re-runs.

## MCP Server

specwriter includes a built-in MCP server that AI assistants can call during conversations.

### Tools

| Tool | Description |
|------|-------------|
| `get_project_context` | Full project overview (tech stack, routes, components) |
| `get_component(name)` | Component spec: props, state, events, children |
| `get_page(route)` | Page spec with wireframe and component list |
| `search_specs(query)` | Search through all specifications |
| `get_dependencies(name)` | What a component uses and what uses it |
| `get_rules` | Coding conventions and patterns |
| `get_routes` | Complete route map |
| `list_components` | All components with types and paths |
| `update_specs` | Re-analyze project after code changes |

### Auto-Registration

When you run `specwriter init`, MCP servers are automatically registered in your AI config files. No manual setup.

### Recommended MCP Servers

specwriter analyzes your `package.json` and recommends additional MCP servers:

| If your project uses | Recommended MCP |
|---------------------|-----------------|
| Any JS/TS project | Context7 (library docs) |
| Supabase | `@supabase/mcp-server-supabase` |
| Prisma | `@anthropic/mcp-server-prisma` |
| PostgreSQL | `@anthropic/mcp-server-postgres` |
| Stripe | `@stripe/mcp-server` |
| Firebase | `@anthropic/mcp-server-firebase` |
| Playwright | `@anthropic/mcp-server-playwright` |
| GitHub | `@modelcontextprotocol/server-github` |
| Sentry | `@sentry/mcp-server` |

API keys are auto-resolved from `.env`, `.env.local`, and system environment variables.

## Tooling Analysis

specwriter deep-analyzes your development tooling and generates "Rules for AI":

```markdown
## Rules for AI

- TypeScript strict mode is ON — never use `any`, always handle null/undefined
- Use path aliases for imports: `@/*`, `@/components/*`
- Formatting: no semicolons, single quotes, 2-space indent (prettier)
- Testing with vitest — test files: **/*.{test,spec}.{ts,tsx}
- lint-staged runs on commit — code must pass lint before committing
```

Analyzed tools: TypeScript config, ESLint (rules, extends, plugins), Prettier settings, testing framework, Git hooks (Husky, lint-staged, commitlint), CI/CD provider.

## Commands

```bash
npx specwriter init [path]       # Analyze project + generate specs + setup AI integrations
npx specwriter analyze [path]    # Re-analyze and regenerate specs
npx specwriter info [path]       # Show detected framework info
npx specwriter serve [path]      # Start MCP server (used by AI tools automatically)
```

### Options

```
-o, --output <dir>       Output directory (default: .specwriter)
--framework <name>       Force framework (skip auto-detection)
--include <patterns...>  Include glob patterns
--exclude <patterns...>  Exclude glob patterns
--depth <n>              Component nesting depth (default: 3)
--no-wireframes          Skip wireframe generation
--format <type>          Output format: json, md, both (default: both)
--verbose                Verbose output
```

### Configuration

Create `specwriter.config.json` for project-specific settings:

```json
{
  "output": ".specwriter",
  "include": ["src/**", "app/**", "pages/**"],
  "exclude": ["**/*.test.*", "**/__tests__/**"],
  "framework": "auto",
  "depth": 3,
  "wireframes": true,
  "format": "both"
}
```

## Supported Frameworks

| Framework | Routes | Components | Status |
|-----------|--------|------------|--------|
| Next.js (App Router) | File-based | TSX + Server/Client | Tested |
| Next.js (Pages Router) | File-based | TSX | Tested |
| React | React Router | TSX/JSX | Tested |
| Vue | Vue Router | SFC (.vue) | Built |
| Nuxt | File-based | SFC (.vue) | Built |
| SvelteKit | File-based | .svelte | Built |
| Angular | Module Router | Decorator-based | Built |
| Generic | - | TSX/JSX/Vue/Svelte | Fallback |

## License

MIT
