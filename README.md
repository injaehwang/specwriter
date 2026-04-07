# specwriter

Spec-driven FE development tool. Analyze existing projects and generate specifications for AI coding assistants.

## Quick Start

```bash
npx specwriter init
```

One command. Zero config. specwriter analyzes your project and generates everything AI needs to understand and work on it.

## What It Does

```
specwriter init
  │
  ├── Rust core (28x faster)     Scans all files, extracts components
  ├── AI_CONTEXT.md              Project context for any AI
  ├── components/*.md            Per-component specs
  ├── features/                  Feature specs (AI writes these)
  └── AI config injection        Claude, Cursor, Copilot, Gemini...
```

### Generated Output

```
.specwriter/
├── AI_CONTEXT.md       # Project overview, patterns, rules, component tree
├── index.json          # Structured data for MCP queries
├── components/
│   ├── Header.md       # Props, state, children, imports
│   ├── LoginForm.md
│   └── ...
└── features/           # AI writes feature specs here before coding
```

### AI_CONTEXT.md Example

```markdown
# my-app

> Vue Education / LMS — 47 components

## 프로젝트 개요

**도메인:** Education / LMS
**아키텍처:** Nuxt (SSR/SSG hybrid)
**데이터:** Pinia + REST API

**기술 스택:** Vue 3.4 · javascript · Tailwind CSS · pnpm

## 프로젝트 구조

- `src/components/` — 공유 컴포넌트 (32개)
- `src/pages/` — 페이지 컴포넌트
- `src/stores/` — Pinia 스토어
- `server/api/` — API 엔드포인트

## 주요 컴포넌트

| 컴포넌트 | 파일 | Props |
|-----------|------|-------|
| **LectureCard** | `src/components/LectureCard.vue` | title, instructor, duration |
| **VideoPlayer** | `src/components/VideoPlayer.vue` | src, autoplay |
| ...

## 규칙

- 모든 컴포넌트는 <script setup> 사용
- Pinia 스토어는 src/stores/ 에 위치
- API 호출은 composables/useApi.ts 사용

## 패턴

### Shared Components
12 components reused across the project
- `Modal` — used by 8 components
- `Button` — used by 15 components

## 컴포넌트 트리

App
  DefaultLayout
    Header
      NavMenu
      UserAvatar
    Sidebar
      SidebarMenu
  ...

## 기능 명세

`.specwriter/features/` 폴더가 비어있다면, 먼저 기존 코드를 분석하여
현재 구현된 기능들의 명세를 작성하세요.
```

## Multi-language

```bash
specwriter init --lang=ko    # 한글
specwriter init --lang=ja    # 日本語
specwriter init --lang=zh    # 中文
specwriter init              # English (default)
```

Language is saved in config — subsequent runs use the same language.

## AI Integration

specwriter auto-detects AI tools in your project and injects `.specwriter/` references:

| AI Tool | Detection | Action |
|---------|-----------|--------|
| Claude Code | `CLAUDE.md` or `.claude/` | Appends reference + registers MCP |
| Cursor | `.cursor/` | Creates rule + registers MCP |
| GitHub Copilot | `.github/` | Appends to `copilot-instructions.md` |
| Gemini | `.gemini/` | Appends to `GEMINI.md` |
| Windsurf | `.windsurf/` | Creates rule |
| Cline | `.clinerules` | Appends reference |
| JetBrains AI | `.aiassistant/` | Creates rule |
| OpenAI Codex | `AGENTS.md` | Appends reference |
| Aider | `.aider.conf.yml` | Adds to `read:` |
| Tabnine | `.tabnine/` | Creates guideline |

Existing content is never deleted — uses `<!-- specwriter:start/end -->` markers.

## MCP Server

Built-in MCP server for AI assistants to query specs during conversations.

```json
// .claude/settings.local.json (auto-registered)
{
  "mcpServers": {
    "specwriter": { "command": "npx", "args": ["-y", "specwriter", "serve", "."] }
  }
}
```

### Tools

| Tool | Description |
|------|-------------|
| `get_project_context` | Full project overview |
| `get_component(name)` | Component spec (props, state, children) |
| `get_page(route)` | Page spec |
| `search_specs(query)` | Search all specifications |
| `get_dependencies(name)` | Component dependency graph |
| `get_rules` | Coding conventions |
| `get_routes` | Route map |
| `list_components` | All components |
| `update_specs` | Re-analyze after code changes |

## Rust Core

Includes a tree-sitter based Rust binary for fast analysis:

| | Node.js | Rust |
|---|---------|------|
| 56 files | 2.8s | **18ms** |
| 200 files | ~10s | **~50ms** |

Windows binary included in npm package. Other platforms fall back to Node.js.

## Figma Integration

```json
// specwriter.config.json
{
  "figma": {
    "url": "https://figma.com/design/abc123/MyProject"
  }
}
```

```bash
# .env
FIGMA_TOKEN=figd_xxxxx
```

`specwriter init` auto-fetches Figma designs and generates wireframes.

## Feature-Driven Development

specwriter creates a `features/` folder where AI writes feature specs before coding:

```markdown
# Login Feature

## 기능 설명
이메일/비밀번호 로그인 + 소셜 로그인

## 페이지
- /login — 로그인 폼
- /register — 회원가입

## 컴포넌트
- LoginForm — 이메일, 비밀번호 입력 + 유효성 검사
- SocialLoginButtons — Google, GitHub 로그인

## API
- POST /api/auth/login — JWT 토큰 반환
- POST /api/auth/register — 사용자 생성

## 데이터 흐름
LoginForm → onSubmit → POST /api/auth/login → JWT 저장 → 리다이렉트
```

AI reads this spec before implementing, and updates it when requirements change.

## Commands

```bash
specwriter init [path]       # Analyze + generate specs + setup AI integrations
specwriter analyze [path]    # Re-analyze and regenerate
specwriter info [path]       # Show detected framework
specwriter serve [path]      # Start MCP server
specwriter --version         # Check version
specwriter analyze --debug   # Debug mode
```

### Options

```
--lang <code>          Output language: en, ko, ja, zh
--no-wireframes        Skip wireframe generation
--format <type>        Output format: json, md, both
--debug                Show all scan details
```

## Supported Frameworks

| Framework | Detection | Components | Routes |
|-----------|-----------|------------|--------|
| Next.js | App Router + Pages Router | TSX | File-based |
| React | React Router | TSX/JSX | Config-based |
| Vue | Vue Router | SFC (.vue) | Config-based |
| Nuxt | File-based | SFC (.vue) | File-based |
| SvelteKit | File-based | .svelte | File-based |
| Angular | Module Router | Decorator-based | Config-based |
| Generic | - | All | - |

## License

MIT
