---
project_name: 'FloorScan'
user_name: 'Marco'
date: '2026-03-16'
sections_completed:
  ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 42
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in FloorScan. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

### Frontend
- **Next.js** 14.2.5 (App Router, NOT Pages Router)
- **React** ^18 / **React DOM** ^18
- **TypeScript** (strict mode via tsconfig.json)
- **Tailwind CSS** 3.4.1 (dark theme default)
- **Radix UI** (multiple @radix-ui/react-* packages) — headless accessible primitives
- **Framer Motion** 11.3.19 — animations
- **Lucide React** 0.414.0 — icons
- **NextAuth** 5.0.0-beta.25 (v5 beta — JWT strategy, 30-day maxAge)
- **Vercel AI SDK** (ai 6.0.116, @ai-sdk/openai 3.0.41, @ai-sdk/groq 3.0.29)
- **Three.js** 0.169.0 + React Three Fiber 8.17.0 + drei 9.117.0
- **pdfjs-dist** 3.11.174 — client-side PDF rendering
- **jspdf** 4.2.0 + **pdf-lib** 1.17.1 — client-side PDF generation
- **tesseract.js** 7.0.0 — browser OCR
- **@neondatabase/serverless** 0.10.4 — PostgreSQL client

### Backend
- **Python** 3.11.0 (pinned in runtime.txt)
- **FastAPI** 0.111.0 + **uvicorn** 0.29.0
- **Pydantic** 2.7.0
- **OpenCV** (opencv-python-headless) 4.10.0.84
- **Pillow** 10.4.0 + **numpy** >=2.0.0
- **inference-sdk** 0.9.14 (Roboflow)
- **PyMuPDF** 1.24.4 — PDF parsing
- **ezdxf** >=0.18.0 — DXF/CAD export
- **pytesseract** >=0.3.10 — OCR (requires Tesseract system package)

### Deployment
- Frontend: **Vercel** (auto-deploy from origin remote)
- Backend: **Railway** (Docker, auto-deploy from kevin remote)
- Database: **Neon PostgreSQL** (serverless)

---

## Critical Implementation Rules

### Language-Specific Rules

**TypeScript (Frontend):**
- ALWAYS use TypeScript strict mode — no `any` types without explicit justification
- Import types from `@/lib/types.ts` and `@/lib/measure-types.ts` — never duplicate type definitions
- Use path aliases: `@/components/...`, `@/lib/...`, `@/app/...`
- All user-facing strings MUST use i18n: `const t = useTranslation()` then `t("key")`
- Never use `require()` — always ES module imports

**Python (Backend):**
- All functions use snake_case, Pydantic models use PascalCase
- Type hints required on all function signatures
- Use `HTTPException` from FastAPI for all error responses — never return raw error dicts
- Session access MUST use the threading lock: `with sessions[sid]["lock"]:`
- NumPy arrays for all image/mask data — never use Python lists for pixel data

### Framework-Specific Rules

**Next.js App Router:**
- Pages are in `app/` directory (NOT `pages/`)
- Client components require `"use client"` directive at top of file
- API routes are `route.ts` files returning `NextResponse`
- Backend proxy: `/api/backend/*` rewrites to Railway — configured in `next.config.js`
- NEVER call the backend URL directly from client code — always go through `/api/backend/`

**FastAPI Backend:**
- ALL endpoints are in `main.py` (monolithic — do not split into routers until Phase 2)
- Session data is in-memory: `sessions: dict` at module level
- Every endpoint that modifies session must snapshot for undo BEFORE modifying
- Masks are stored as NumPy uint8 arrays (H, W) or (H, W, 4) for RGBA
- Use `base64.b64encode(cv2.imencode('.png', mask)[1]).decode()` for mask serialization

**React Components:**
- Functional components only — no class components
- State management via `useState` + props — no Redux, no Zustand, no Context for app state
- `demo-client.tsx` is the ONLY orchestrator — step components receive data as props
- Step components communicate UP via callback props (onUploaded, onCropped, onAnalyzed, etc.)
- Panel components are children of `results-step.tsx` (except ChatPanel which is global)

**Vercel AI SDK:**
- Chat uses `useChat` hook from `@ai-sdk/react`
- Streaming responses via `streamText` from `ai` package
- Chat API route at `/api/chat/route.ts` — supports dual modes (help vs analysis)
- Send `mode`, `currentStep`, and analysis context in request body

### Testing Rules

- No test framework currently configured (gap in MVP)
- When adding tests: use Vitest for frontend, pytest for backend
- Co-locate test files next to source: `*.test.ts` / `*_test.py`
- Backend tests must mock `sessions` dict and Roboflow API calls
- Frontend tests must mock `fetch` for `/api/backend/*` calls

### Code Quality & Style Rules

**File Naming:**
- Frontend components: `kebab-case.tsx` (e.g., `results-step.tsx`, `chat-panel.tsx`)
- Frontend libs: `kebab-case.ts` (e.g., `dpgf-pdf.ts`, `snap-engine.ts`)
- API routes: `route.ts` inside directory structure (`app/api/{name}/route.ts`)
- Backend: `snake_case.py` (only `main.py` and `pipeline.py` currently)

**Component Naming:**
- React components: PascalCase (`ResultsStep`, `ChatPanel`, `DpgfPanel`)
- Hooks: camelCase with `use` prefix (`useAuth`, `useChat`, `useTranslation`)
- Constants: UPPER_SNAKE_CASE (`ANALYSIS_SYSTEM_PROMPT`, `STEP_NAMES`)
- Props interfaces: `{ComponentName}Props` (e.g., `ChatPanelProps`)

**Styling:**
- Tailwind utility classes ONLY — no CSS modules, no styled-components
- Dark theme is default — use `dark:` prefix for light mode specifics
- Custom global styles only in `globals.css` when Tailwind classes are insufficient
- Use `clsx()` or `cn()` (from lib/utils.ts) for conditional class merging
- Radix UI components for accessible primitives (Dialog, Tooltip, etc.)

**Internationalization:**
- ALL user-visible strings must be in `lib/i18n.ts`
- 5 languages: FR (default), EN, ES, DE, IT
- Access via `useTranslation()` hook from `lib/lang-context.tsx`
- Keys are dot-notation strings: `t("results.surface_habitable")`

### Development Workflow Rules

**Git Strategy:**
- Two remotes: `origin` (thehydrowave/floorscan → Vercel) and `kevin` (Kvn-Nhr/Floorscan → Railway)
- Always push to BOTH remotes: `git push origin main && git push kevin main`
- Commit messages: conventional format (`feat:`, `fix:`, `docs:`, `refactor:`)
- Build check before push: `cd frontend && npm run build`

**Development Servers:**
- Frontend: `cd frontend && npm run dev` (port 3000)
- Backend: `cd backend && uvicorn main:app --reload --port 8000`
- Backend proxy active in dev via `next.config.js` rewrites

**Environment Variables:**
- Frontend secrets in `frontend/.env.local` (dev) / `.env.production` (prod) — NOT committed
- Required env vars: `AUTH_SECRET`, `AUTH_URL`, `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`
- Backend needs: `PORT` (default 8000), Roboflow API key passed per-request from frontend

### Critical Don't-Miss Rules

**Anti-Patterns to AVOID:**
- NEVER expose Roboflow API keys in client-side code — always proxy through `/api/infer` or `/api/backend/analyze`
- NEVER modify session data without acquiring the session lock first
- NEVER create new state management solutions (Context, Redux) — use useState + props
- NEVER add new CSS files or CSS modules — Tailwind only
- NEVER split backend into multiple Python files (keep in main.py until Phase 2 refactor)
- NEVER call backend directly from browser — always through Next.js proxy rewrites
- NEVER hardcode French strings in components — always use i18n keys

**Edge Cases Agents Must Handle:**
- PDF uploads can be 100MB+ — backend must handle multipart streaming
- Image dimensions can exceed 5000px — tiled inference required
- Session TTL is 1 hour — endpoints must check session existence before processing
- Scale might be uncalibrated — display pixel values when no scale is set
- Roboflow API can timeout — wrap inference calls in try/catch with clear error messages
- Multiple browser tabs can share the same session_id — per-session locks prevent race conditions

**Security Rules:**
- Passwords MUST be hashed with bcrypt (never plaintext, never MD5/SHA)
- Admin routes check `session.user.role === "admin"` in middleware AND in API route
- API keys stored in environment variables only — never in code or config files
- Session data includes threading lock — always acquire before read/write

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Look at existing similar components/endpoints before creating new patterns
- Update this file if new patterns emerge during implementation

**For Humans:**
- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review quarterly for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-03-16
