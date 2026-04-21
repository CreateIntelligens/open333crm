# AGENTS.md - AI Agent Context Document

> This document provides project context, conventions, and tool usage guidelines for AI agents.

---

## Project Overview

**open333CRM** is an enterprise-grade omnichannel customer relationship management system that integrates LINE, Facebook Messenger, and WebChat multi-channel customer service, providing intelligent automation, data analytics, marketing campaigns, and fan engagement features.

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui, Recharts, Socket.io Client |
| **Backend** | Fastify, TypeScript, Prisma ORM, Socket.io, json-rules-engine |
| **Database** | PostgreSQL (port 5432), Redis (port 6380), MinIO S3 (port 9000) |
| **AI** | Ollama (qwen2.5:7b, port 11434) |
| **Build** | Turborepo, pnpm |

### Application Structure

```
apps/
├── api/          # Fastify backend API (port 3001)
├── web/          # Next.js frontend (port 3000) ← Primary Focus
├── workers/      # Background workers
├── widget/       # WebChat widget
└── api/          # API application

packages/
├── core/         # Core modules
├── database/     # Prisma ORM
├── ui/           # Shared UI components
├── types/        # Shared TypeScript types
├── brain/        # AI/LLM modules
├── shared/       # Shared utilities
├── channel-plugins/  # Channel plugins
└── automation/   # Automation engine
```

### Entry Points

- **Web Frontend**: `http://localhost:3000`
- **API**: `http://localhost:3001`
- **WebSocket**: `ws://localhost:3001`

### Development Commands

```bash
pnpm dev              # Start both API and Web
pnpm build            # Build all packages
pnpm lint             # Code linting
pnpm db:generate      # Generate Prisma Client
pnpm db:migrate       # Run database migrations
pnpm db:seed          # Seed database
```

### Environment Variables

**Root `.env`**:
```env
DATABASE_URL=postgresql://crm:crmpassword@localhost:5432/open333crm
REDIS_URL=redis://localhost:6380
JWT_SECRET=your-super-secret-jwt-key-change-in-production
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
LINE_CHANNEL_SECRET=your-line-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=your-line-access-token
FB_APP_SECRET=your-fb-app-secret
```

**Web Environment Variables** (`apps/web/.env`):
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Default Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@demo.com | admin123 |
| Supervisor | supervisor@demo.com | admin123 |
| Agent | agent1@demo.com | admin123 |

---

## Code Conventions

### General Conventions

1. **ESM Modules**: All packages use `"type": "module"`
2. **Strict TypeScript**: Avoid `any`, use explicit types
3. **Conventional Commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
4. **No secrets in commits**: Never commit `.env`, credentials, or sensitive information to git

### Frontend Conventions (apps/web)

1. **React 19 + Next.js 16**: Use App Router (RSC)
2. **Component Library**: shadcn/ui (based on Radix UI)
3. **Styling**: Tailwind CSS
4. **Charts**: Recharts
5. **State Management**: React Query (swr)
6. **Real-time Communication**: Socket.io Client
7. **No console.log/console.error**: Use logger or structured logging
8. **Responsive Design**: Mobile-first, support minimum 375px width

### Backend Conventions (apps/api)

1. **Fastify**: Use Fastify plugin system to organize routes
2. **Prisma**: Access Prisma Client via `src/lib/prisma.ts`
3. **Authentication**: JWT Bearer Token
4. **Error Handling**: Use Fastify error handler plugin
5. **WebSocket**: Socket.io plugin with real-time events

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `canvas-flow.ts`, `auth-service.ts` |
| Components | PascalCase | `ConversationList.tsx`, `AgentCard.tsx` |
| Hooks | camelCase, use prefix | `useConversations.ts`, `useAuth.ts` |
| Routes | RESTful | `/conversations/:id/messages` |
| Environment Variables | UPPER_SNAKE_CASE | `DATABASE_URL`, `JWT_SECRET` |

---

## OpenSpec Workflow

This project uses OpenSpec to manage changes.

### Commands

```bash
openspec-propose    # Propose a new change
openspec-apply     # Implement a change
openspec-archive   # Complete and archive a change
openspec-explore   # Explore mode
```

### Current Progress

- `unified-interaction-canvas` tasks are all checked, implementation status is "Wrapping up"

### Note

If there are inconsistencies between `CHANGELOG.md`, `README.md`, and OpenSpec task lists, use "actual code integration status + README Current Status" as the source of truth.

---

## MCP Tools Usage

### context7

**Purpose**: Query library documentation

**Usage**:
1. Call `context7_resolve-library-id` to get library ID
2. Then call `context7_query-docs` for specific questions

**Use Cases**:
- Next.js API and patterns
- React 19 new features
- Fastify plugin development
- Prisma ORM operations

```typescript
// Example: Query Next.js 16 cache directive usage
context7_resolve-library-id({ libraryName: "Next.js", query: "cache directive use cache" })
context7_query-docs({ libraryId: "/vercel/next.js", query: "use cache directive example" })
```

### chrome-devtools-mcp

**Purpose**: Verify frontend results, screenshots, UI testing

**Usage**:
1. Start browser with `start`
2. Navigate to target page with `navigate`
3. Take screenshot with `take_screenshot` or snapshot with `take_snapshot`
4. Interact with elements via `click`, `type`, `fill_form`

**Use Cases**:
- Verify UI rendering results
- Screenshot to record bugs
- Form functionality testing
- Confirm styling is correct

### next-devtools-mcp

**Purpose**: Next.js development tools (error diagnosis, route inspection, build status)

**Usage**:
1. Call `next-devtools_nextjs_index` to discover available tools
2. Then call `next-devtools_nextjs_call` to execute specific tools

**Use Cases**:
- Query route structure
- Diagnose build errors
- Check runtime errors
- Manage cache

### figma-remote-mcp

**Purpose**: Figma-related features (read design mockups)

**Use Cases**:
- Compare against design mockups to confirm UI
- Get colors, spacing, and other design tokens

---

## Key Directory Structure

### apps/web/

```
apps/web/src/
├── app/                      # App Router pages
│   ├── (auth)/              # Auth page group
│   ├── (dashboard)/         # Main dashboard group
│   │   ├── conversations/   # Conversation management
│   │   ├── contacts/       # Contacts
│   │   ├── cases/          # Case management
│   │   ├── automation/     # Automation rules
│   │   ├── analytics/       # Data analytics
│   │   ├── marketing/      # Marketing system
│   │   └── settings/       # Settings
│   └── layout.tsx           # Root layout
├── components/              # React components
│   ├── ui/                  # shadcn/ui components
│   ├── chat/                # Chat-related
│   ├── analytics/            # Analytics charts
│   └── shared/              # Shared components
├── hooks/                    # Custom Hooks
├── lib/                      # Utilities
└── styles/                   # Style files
```

### apps/api/

```
apps/api/src/
├── modules/                  # Business modules
│   ├── auth/                 # Authentication
│   ├── conversation/         # Conversation management
│   ├── contact/             # Contacts
│   ├── case/                # Case management
│   ├── channel/             # Channel management
│   ├── automation/          # Automation engine
│   ├── canvas/               # Canvas Flow
│   ├── ai/                   # AI/LLM
│   ├── analytics/            # Data analytics
│   ├── marketing/            # Marketing system
│   ├── portal/               # Fan activities
│   └── shortlink/            # Short links
├── channels/                 # Channel integrations
│   ├── line/                 # LINE Messaging API
│   ├── fb/                   # Facebook Messenger
│   └── simulator/            # Simulator
├── plugins/                  # Fastify plugins
├── services/                 # Service layer
└── lib/                      # Utilities
```

### packages/

```
packages/
├── database/                 # Prisma ORM
│   └── prisma/
│       ├── schema.prisma     # Database schema
│       ├── migrations/       # Migration files
│       └── seed.ts           # Seed data
├── ui/                       # Shared UI components
├── types/                    # Shared TypeScript types
├── shared/                   # Shared utilities
└── brain/                    # AI modules
```

---

## Quick Command Reference

### Development

```bash
pnpm dev                          # Start dev server
pnpm --filter @open333crm/web dev  # Start Web only
pnpm --filter @open333crm/api dev # Start API only
```

### Docker

```bash
docker compose up -d             # Start all services
docker compose ps                # View status
docker compose logs -f postgres  # View logs
docker compose down              # Stop services
```

### Database

```bash
pnpm db:generate                 # Generate Prisma Client
pnpm db:migrate                 # Run migrations
pnpm db:seed                     # Seed data
pnpm db:studio                   # Prisma Studio GUI
```

---

## Important Notes

1. **API reads root `.env` first**: `apps/api/src/index.ts` loads `.env` from project root, not `apps/api/.env`
2. **PostgreSQL port 5432**: Note the distinction between 5432 (external) and 5433 (Docker internal)
3. **Redis port 6380**: Docker exposes 6380, not the default 6379
4. **Canvas Email defaults to log**: Requires `EMAIL_DELIVERY_MODE=webhook` + `EMAIL_WEBHOOK_URL` for actual email sending
5. **Widget needs sync**: `pnpm dev` automatically runs `sync:widget`, manual runs need to be careful