---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - prd.md (Product Requirements Document)
  - MEMORY.md (project memory)
workflowType: 'architecture'
project_name: 'FloorScan'
user_name: 'Marco'
date: '2026-03-16'
lastStep: 8
status: 'complete'
completedAt: '2026-03-16'
---

# Architecture Decision Document — FloorScan

_This document defines all architectural decisions, implementation patterns, and project structure for the FloorScan AI floor plan analysis platform. It serves as the single source of truth for AI agents implementing features._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
49 functional requirements organized across 9 categories:
- **FR-UPLOAD (4 FRs):** PDF/image upload, multi-page selection, high-res conversion
- **FR-PREP (5 FRs):** Image cropping, auto/manual scale calibration
- **FR-ANALYSIS (7 FRs):** Multi-model Pipeline G detection, room classification, surface calculation, mask generation, admin model config
- **FR-RESULTS (9 FRs):** Mask overlay toggles, room list, materials, DPGF, CCTP, PMR compliance, 3D view, chatbot, stepper navigation
- **FR-EDITOR (5 FRs):** Layer-based mask editing, SAM segmentation, undo/redo, real-time recalculation
- **FR-EXPORT (6 FRs):** PDF, DXF, CSV, Rapport Pro, DPGF PDF, compliance PDF
- **FR-MEASURE (4 FRs):** Polygon/rectangle zones, surface classification, area/perimeter, CSV export
- **FR-CHAT (5 FRs):** Global floating panel, help/analysis modes, streaming, minimizable
- **FR-AUTH (4 FRs):** Register/login, admin role, session save/restore, unsaved work warning

**Non-Functional Requirements:**
23 NFRs across 6 categories: Performance (5), Reliability (4), Security (4), Scalability (3), Accessibility/i18n (4), Browser Compatibility (3).

**Scale & Complexity:**
- Primary domain: Full-stack web application (Next.js + FastAPI)
- Complexity level: Medium-high
- Estimated architectural components: ~80 files across frontend and backend
- Key complexity drivers: Multi-model AI inference, real-time mask editing with undo/redo, session-based image processing, domain-specific document generation (DPGF/CCTP/PMR)

### Technical Constraints & Dependencies

| Constraint | Detail |
|---|---|
| AI inference | Roboflow cloud API (inference-sdk), requires API key and internet |
| PDF processing | PyMuPDF backend + pdfjs-dist frontend (dual-stack) |
| OCR | Tesseract system dependency (must be installed in Docker) |
| Session storage | In-memory (backend), limits horizontal scaling |
| Image size | Large floor plans (5000px+) need tiled inference (2048px + 1024px passes) |
| Browser | WebGL required for 3D view (Three.js) |
| Auth | NextAuth v5 beta (API may change) |
| Database | Neon serverless PostgreSQL (cold start latency) |

### Cross-Cutting Concerns Identified

1. **Session management** — Spans upload, crop, scale, analyze, edit, export; in-memory with TTL
2. **Internationalization** — All user-facing strings across 50 components, 5 languages
3. **Error handling** — Backend pipeline failures must propagate cleanly to frontend
4. **Image data flow** — Base64-encoded masks flow through multiple endpoints
5. **Authentication** — Protects demo/measure/admin routes via middleware
6. **Export system** — Multiple export formats share the same analysis data

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application — brownfield project already built on:
- **Frontend:** Next.js 14 + TypeScript + Tailwind CSS
- **Backend:** Python FastAPI + OpenCV + Roboflow
- **Deployment:** Vercel (frontend) + Railway (backend)

### Selected Starter: Existing Codebase (Brownfield)

**Rationale:** This is a brownfield project with an established codebase (100+ files, 50 components, 21 backend endpoints). No starter template needed — the existing architecture is the foundation.

**Initialization Command:**

```bash
# Frontend
cd frontend && npm install

# Backend
cd backend && pip install -r requirements.txt
```

**Architectural Decisions Already Established by Codebase:**

**Language & Runtime:**
- Frontend: TypeScript (strict mode), Node.js
- Backend: Python 3.11

**Styling Solution:**
- Tailwind CSS 3.4 with dark theme default
- Radix UI primitives for accessible components
- Framer Motion for animations
- Class variance authority + tailwind-merge for component variants

**Build Tooling:**
- Next.js built-in (SWC compiler, webpack)
- PostCSS for Tailwind processing

**Testing Framework:**
- Not yet established (gap — see recommendations)

**Code Organization:**
- Frontend: App Router (pages) + components by feature + lib for logic
- Backend: Single main.py + pipeline.py (monolithic, potential refactor target)

**Development Experience:**
- Hot reload via Next.js dev server + uvicorn --reload
- TypeScript type checking
- Backend API proxy through next.config.js rewrites

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
1. Multi-model AI strategy (Pipeline G best-of) — DECIDED
2. Session-based architecture (in-memory) — DECIDED
3. Frontend-backend communication (REST + proxy) — DECIDED
4. Authentication strategy (NextAuth v5 JWT) — DECIDED

**Important Decisions (Shape Architecture):**
5. Mask storage format (compressed PNG base64) — DECIDED
6. Export pipeline (dual client/server PDF) — DECIDED
7. LLM integration (OpenAI/Groq via Vercel AI SDK) — DECIDED

**Deferred Decisions (Post-MVP):**
- Redis/PostgreSQL session persistence (Phase 2)
- BIM/IFC export format (Phase 3)
- Horizontal scaling strategy (Phase 3)

### Data Architecture

| Decision | Choice | Version | Rationale |
|---|---|---|---|
| Primary database | Neon PostgreSQL (serverless) | Latest | User auth only; cold starts acceptable for auth flows |
| Session storage | In-memory Python dict | N/A | Fast access for image processing; 50 session limit acceptable for MVP |
| Image storage | In-memory compressed PNG | N/A | Masks as RGBA PNG base64; no persistent file storage needed |
| Undo/redo | Per-layer history stacks | N/A | Compressed mask snapshots per edit operation |
| Client state | localStorage | N/A | Session restore with 2-hour TTL, beforeunload warning |

**Data Flow:**

```
User uploads PDF/Image
  → Backend /upload-pdf or /upload-image
    → Session created (in-memory)
    → Image stored as numpy array
  → Frontend receives session_id

User triggers analysis
  → Backend /analyze
    → Roboflow inference (7 models, tiled)
    → OpenCV mask generation
    → Surface/room calculation
    → All masks stored in session
  → Frontend receives base64 masks + JSON metrics

User edits mask
  → Backend /edit-mask
    → Snapshot for undo
    → Mask updated in session
    → Surfaces recalculated
  → Frontend receives updated mask + metrics

User exports
  → Backend /export-pdf or /export-dxf
    → Renders from session data
    → Returns file bytes
  → Frontend triggers download
```

### Authentication & Security

| Decision | Choice | Rationale |
|---|---|---|
| Auth framework | NextAuth.js v5 (beta.25) | Built-in Next.js integration, JWT sessions |
| Session strategy | JWT (30-day maxAge) | Stateless, no server-side session DB needed |
| Password hashing | bcryptjs | Industry standard, works in Edge runtime |
| Route protection | Next.js middleware | Intercepts before page render |
| API key protection | Next.js API routes as proxy | Roboflow keys never exposed to browser |
| Admin authorization | Role field in JWT | Simple role check in middleware and API routes |
| CORS | Eliminated via rewrite proxy | Frontend and backend share same origin |

**Protected Routes:**
- `/demo/*` — Requires authentication
- `/measure/*` — Requires authentication
- `/admin/*` — Requires authentication + admin role

### API & Communication Patterns

| Decision | Choice | Rationale |
|---|---|---|
| API style | REST (JSON + multipart) | Simple, well-supported; image uploads need multipart |
| Frontend → Backend | HTTP via Next.js rewrite proxy | Eliminates CORS; `/api/backend/*` → Railway |
| Error format | `{ detail: string }` (FastAPI default) | Consistent with FastAPI conventions |
| Streaming | Server-Sent Events (AI chat) | Vercel AI SDK handles streaming natively |
| File transfer | Base64 in JSON body | Masks are small enough; avoids multipart complexity for edits |
| Rate limiting | None (MVP) | Low user count; add in Phase 2 |

**Backend Endpoint Categories:**

| Category | Endpoints | Purpose |
|---|---|---|
| Upload | 2 | PDF and image ingestion |
| Preparation | 2 | Crop and calibrate |
| Analysis | 3 | Analyze, compare, facade |
| Editing | 6 | Edit masks, undo/redo, room labels |
| AI tools | 2 | SAM segment, visual search |
| Export | 3 | PDF, DXF, measurement PDF |
| Utility | 3 | Health, image retrieval, cartouche OCR |

### Frontend Architecture

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js 14 (App Router) | SSR landing page + SPA demo, Vercel deployment |
| State management | React useState + props | Sufficient for stepper workflow; no global store needed |
| Styling | Tailwind CSS + Radix UI | Rapid development, consistent design system |
| Animation | Framer Motion | Smooth step transitions, panel animations |
| 3D rendering | React Three Fiber + drei | Three.js integration with React component model |
| PDF rendering | pdfjs-dist (browser) | Client-side PDF page rendering for upload step |
| PDF generation | jspdf + pdf-lib (browser) | Client-side annotated export; some server-side via reportlab |
| Icons | Lucide React | Consistent icon set, tree-shakeable |
| AI chat | Vercel AI SDK (useChat hook) | Streaming chat with OpenAI/Groq backends |
| i18n | Custom context (lib/i18n.ts) | Simple key-value translation, runtime switching |

**Component Architecture:**

```
app/demo/demo-client.tsx (Main orchestrator)
  ├── Stepper (navigation)
  ├── Step components (upload, crop, scale, connect, analyze, results, editor)
  │   └── Each step is a self-contained component with own state
  ├── Panel components (materials, dpgf, cctp, compliance, gantt, 3D, scenarios...)
  │   └── Rendered conditionally within results-step
  └── ChatPanel (global, floating)
      └── Rendered at demo-client level, outside step AnimatePresence
```

### Infrastructure & Deployment

| Decision | Choice | Rationale |
|---|---|---|
| Frontend hosting | Vercel | Native Next.js support, CDN, automatic deploys |
| Backend hosting | Railway | Docker support, persistent processes, easy scaling |
| Database | Neon PostgreSQL | Serverless, auto-scaling, free tier for auth |
| CI/CD | GitHub → Vercel (auto) + GitHub → Railway (auto) | Push-to-deploy on both platforms |
| Container | Docker (python:3.11-slim) | Reproducible backend builds with system deps (Tesseract) |
| Monitoring | Railway logs + Vercel logs | Built-in platform monitoring |
| Domain | Vercel (frontend) | Custom domain support |

**Two-Remote Git Strategy:**

| Remote | Repository | Deployment |
|---|---|---|
| origin | thehydrowave/floorscan | Vercel (frontend) |
| kevin | Kvn-Nhr/Floorscan | Railway (backend) |

## Implementation Patterns & Consistency Rules

### Naming Patterns

**File Naming:**
- Components: `kebab-case.tsx` (e.g., `results-step.tsx`, `chat-panel.tsx`)
- Libraries: `kebab-case.ts` (e.g., `dpgf-pdf.ts`, `snap-engine.ts`)
- Types: `kebab-case.ts` (e.g., `types.ts`, `measure-types.ts`)
- API routes: `route.ts` inside directory structure

**Component Naming:**
- PascalCase for React components (e.g., `ResultsStep`, `ChatPanel`)
- camelCase for functions and variables
- UPPER_SNAKE_CASE for constants (e.g., `ANALYSIS_SYSTEM_PROMPT`, `STEP_NAMES`)

**Backend Naming:**
- snake_case for Python functions and variables
- snake_case for API endpoint paths (e.g., `/edit-mask`, `/upload-pdf`)
- PascalCase for Pydantic models

**CSS/Tailwind:**
- Utility-first with Tailwind classes
- Custom classes only in globals.css when absolutely necessary
- Dark theme as default (`dark:` prefix for light mode overrides)

### Structure Patterns

**Frontend Component Organization: By Feature**
```
components/
  demo/           ← Main workflow (stepper steps + panels)
  landing/        ← Marketing pages
  measure/        ← Manual measurement mode
  facade/         ← Facade analysis mode
  diff/           ← Plan comparison mode
  cartouche/      ← OCR extraction mode
  ui/             ← Shared UI primitives (button, toast, etc.)
```

**Library Organization: By Domain**
```
lib/
  types.ts          ← Core TypeScript interfaces
  backend.ts        ← Backend API client
  i18n.ts           ← Internationalization
  utils.ts          ← General utilities
  *-pdf.ts          ← PDF generation (cctp-pdf, dpgf-pdf, rapport-pdf...)
  *-calculator.ts   ← Computation logic
  *-detection.ts    ← Detection algorithms
```

**API Route Organization:**
```
app/api/
  auth/             ← Authentication endpoints
  admin/            ← Admin-only endpoints
  chat/             ← AI chatbot
  infer/            ← Roboflow proxy
  test-connection/  ← Health check
```

### Format Patterns

**API Response Formats:**

Frontend API routes return:
```typescript
// Success
NextResponse.json({ data: ... })

// Error
NextResponse.json({ error: "message" }, { status: 4xx })
```

Backend (FastAPI) returns:
```python
# Success — direct JSON response
return { "session_id": "...", "surfaces": {...}, ... }

# Error
raise HTTPException(status_code=4xx, detail="message")
```

**Mask Data Format:**
```
Base64-encoded RGBA PNG string
Prefix: "data:image/png;base64," (optional, stripped on backend)
Resolution: Matches source image dimensions
Channels: R=mask, G=mask, B=mask, A=opacity (0 or 255)
```

**Session Data Shape (Backend):**
```python
sessions[session_id] = {
    "image": np.ndarray,           # Original image
    "m_doors": np.ndarray,         # Door mask
    "m_windows": np.ndarray,       # Window mask
    "m_walls_ai": np.ndarray,      # AI wall mask
    "m_french_doors": np.ndarray,  # French door mask
    "m_cloisons": np.ndarray,      # Partition mask
    "m_interior": np.ndarray,      # Interior mask
    "rooms": list,                 # Room data
    "scale": float,                # px/m ratio
    "undo_stack": list,            # Edit history
    "redo_stack": list,            # Redo history
    "last_access": float,          # Timestamp
}
```

### Communication Patterns

**Frontend → Backend Flow:**
```
Component → lib/backend.ts → /api/backend/* (Next.js proxy) → Railway/localhost:8000
```

**State Flow (Stepper):**
```
demo-client.tsx (orchestrator)
  ├── step: number (current step 1-7)
  ├── sessionId: string (backend session)
  ├── analysisResult: AnalysisResult (from /analyze)
  ├── croppedImage: string (base64)
  └── scale: number (px/m)

Props passed down:
  UploadStep → onUploaded(sessionId, imageUrl)
  CropStep → onCropped(croppedB64)
  ScaleStep → onScaleSet(pxPerMeter)
  AnalyzeStep → onAnalyzed(result)
  ResultsStep ← analysisResult (read-only display)
  EditorStep ← analysisResult (editable, sends edits to backend)
```

**Event Patterns:**
- Step transitions: callback props (onNext, onBack, onStepClick)
- Panel visibility: local useState toggles
- Chat: Vercel AI SDK useChat hook manages stream state
- 3D: React Three Fiber declarative scene graph

### Process Patterns

**Error Handling:**

Frontend:
```typescript
try {
  const res = await fetch("/api/backend/analyze", { ... });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
} catch (err) {
  toast({ title: t("error"), description: err.message, variant: "destructive" });
}
```

Backend:
```python
try:
    result = run_pipeline(session)
except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))
```

**Loading States:**
- Each step manages its own loading state via `useState<boolean>`
- Naming convention: `isLoading`, `isAnalyzing`, `isExporting`
- Visual: Spinner overlay or disabled button with loading text

**Undo/Redo Pattern:**
```python
# Before edit: snapshot current mask
undo_stack.append(compress(current_mask))
redo_stack.clear()

# Undo: pop from undo, push current to redo
mask = decompress(undo_stack.pop())
redo_stack.append(compress(current_mask))

# Redo: pop from redo, push current to undo
mask = decompress(redo_stack.pop())
undo_stack.append(compress(current_mask))
```

### Enforcement Guidelines

**All AI Agents MUST:**
1. Follow kebab-case file naming for all new frontend files
2. Use TypeScript strict mode — no `any` types without explicit justification
3. Add i18n keys for ALL user-facing strings (lib/i18n.ts)
4. Pass session_id to all backend calls that modify state
5. Use the existing backend.ts client for API calls, not raw fetch
6. Follow the existing component pattern: functional components with hooks
7. Use Tailwind utility classes exclusively (no CSS modules or styled-components)
8. Keep backend endpoints in main.py (no route splitting until refactor phase)

## Project Structure & Boundaries

### Complete Project Directory Structure

```
floorscan-git/
├── README.md
├── .gitignore
├── .env.example
├── start-frontend.bat
│
├── frontend/
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── next.config.js              # API proxy rewrites
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── middleware.ts                # Auth route protection
│   ├── auth.ts                     # NextAuth config
│   ├── auth.config.ts              # Edge-safe auth
│   ├── auth.d.ts                   # NextAuth type extensions
│   ├── .env.example
│   ├── .env.local                  # Dev secrets (not committed)
│   ├── .env.production             # Prod secrets (not committed)
│   │
│   ├── app/
│   │   ├── layout.tsx              # Root layout + providers
│   │   ├── page.tsx                # Landing page (/)
│   │   ├── globals.css             # Global styles + Tailwind
│   │   ├── admin/
│   │   │   └── page.tsx            # Admin dashboard
│   │   ├── demo/
│   │   │   ├── page.tsx            # Demo page wrapper
│   │   │   └── demo-client.tsx     # Main client orchestrator
│   │   ├── login/
│   │   │   └── page.tsx
│   │   ├── register/
│   │   │   └── page.tsx
│   │   ├── measure/
│   │   │   ├── page.tsx
│   │   │   └── measure-client.tsx
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── [...nextauth]/route.ts
│   │       │   └── register/route.ts
│   │       ├── admin/users/
│   │       │   ├── route.ts
│   │       │   └── [id]/route.ts
│   │       ├── chat/route.ts       # AI chatbot streaming
│   │       ├── infer/route.ts      # Roboflow proxy
│   │       └── test-connection/route.ts
│   │
│   ├── components/
│   │   ├── ui/                     # Shared UI primitives
│   │   │   ├── button.tsx
│   │   │   ├── lang-switcher.tsx
│   │   │   ├── theme-switcher.tsx
│   │   │   ├── toast.tsx
│   │   │   ├── toaster.tsx
│   │   │   └── use-toast.ts
│   │   ├── landing/                # Marketing page sections
│   │   │   ├── navbar.tsx
│   │   │   ├── hero-section.tsx
│   │   │   ├── features-section.tsx
│   │   │   ├── use-cases.tsx
│   │   │   ├── how-it-works.tsx
│   │   │   └── footer.tsx
│   │   ├── demo/                   # Main workflow (30 components)
│   │   │   ├── stepper.tsx
│   │   │   ├── upload-step.tsx
│   │   │   ├── crop-step.tsx
│   │   │   ├── scale-step.tsx
│   │   │   ├── connect-step.tsx
│   │   │   ├── analyze-step.tsx
│   │   │   ├── results-step.tsx
│   │   │   ├── editor-step.tsx
│   │   │   ├── chat-panel.tsx
│   │   │   ├── dashboard-panel.tsx
│   │   │   ├── toolkit-panel.tsx
│   │   │   ├── materials-panel.tsx
│   │   │   ├── dpgf-panel.tsx
│   │   │   ├── cctp-panel.tsx
│   │   │   ├── compliance-panel.tsx
│   │   │   ├── gantt-panel.tsx
│   │   │   ├── scenario-panel.tsx
│   │   │   ├── housing-panel.tsx
│   │   │   ├── lots-panel.tsx
│   │   │   ├── metre-panel.tsx
│   │   │   ├── ocr-panel.tsx
│   │   │   ├── pattern-panel.tsx
│   │   │   ├── comparison-panel.tsx
│   │   │   ├── debug-panel.tsx
│   │   │   ├── measure-tool.tsx
│   │   │   ├── view-3d-panel.tsx
│   │   │   ├── floor-scene.tsx
│   │   │   ├── rapport-dialog.tsx
│   │   │   └── devis-dialog.tsx
│   │   ├── measure/                # Manual measurement mode
│   │   │   ├── measure-canvas.tsx
│   │   │   ├── measure-crop-step.tsx
│   │   │   └── surface-panel.tsx
│   │   ├── facade/                 # Facade analysis mode
│   │   │   ├── facade-analyze-step.tsx
│   │   │   ├── facade-editor-step.tsx
│   │   │   └── facade-results-step.tsx
│   │   ├── diff/                   # Plan comparison
│   │   │   └── diff-view-step.tsx
│   │   └── cartouche/              # OCR extraction
│   │       └── cartouche-result-step.tsx
│   │
│   ├── lib/                        # Business logic & utilities
│   │   ├── types.ts                # Core TypeScript interfaces
│   │   ├── measure-types.ts        # Measurement types
│   │   ├── backend.ts              # Backend API client
│   │   ├── db.ts                   # Neon PostgreSQL client
│   │   ├── utils.ts                # General utilities
│   │   ├── i18n.ts                 # Internationalization (5 languages)
│   │   ├── auth-provider.tsx       # NextAuth context
│   │   ├── lang-context.tsx        # Language context
│   │   ├── theme-context.tsx       # Theme context
│   │   ├── use-auth.ts             # Auth hook
│   │   ├── pdf-render.ts           # PDF rendering
│   │   ├── cctp-pdf.ts             # CCTP generation
│   │   ├── cctp-templates.ts       # CCTP templates
│   │   ├── compliance-pdf.ts       # Compliance report
│   │   ├── compliance-checker.ts   # PMR compliance logic
│   │   ├── dpgf-pdf.ts             # DPGF export
│   │   ├── dpgf-defaults.ts        # DPGF default values
│   │   ├── dpgf-scenarios.ts       # DPGF scenarios
│   │   ├── rapport-pdf.ts          # Professional report
│   │   ├── devis-pdf.ts            # Quote document
│   │   ├── metre-pdf.ts            # Measurement PDF
│   │   ├── metre-calculator.ts     # Measurement math
│   │   ├── gantt-builder.ts        # Timeline generation
│   │   ├── housing-detection.ts    # Housing type detection
│   │   ├── lot-detection.ts        # Lot/parcel detection
│   │   ├── pattern-match.ts        # Pattern matching
│   │   ├── snap-engine.ts          # Snap alignment
│   │   ├── toolkit-calculators.ts  # Tool calculations
│   │   ├── export-mock.ts          # Mock export data
│   │   └── mock.ts                 # Mock development data
│   │
│   ├── types/
│   │   └── r3f.d.ts                # React Three Fiber types
│   │
│   └── public/                     # Static assets
│       └── assets/
│
├── backend/
│   ├── main.py                     # FastAPI server (1500+ lines, 21 endpoints)
│   ├── pipeline.py                 # AI detection pipeline
│   ├── requirements.txt            # Python dependencies
│   ├── runtime.txt                 # Python 3.11.0
│   └── Dockerfile                  # Docker build (python:3.11-slim + Tesseract)
│
├── _bmad/                          # BMAD Method framework
│   └── bmm/
│       ├── config.yaml
│       ├── agents/
│       └── workflows/
│
├── _bmad-output/                   # BMAD generated artifacts
│   └── planning-artifacts/
│       ├── prd.md
│       └── architecture.md         # THIS DOCUMENT
│
└── .claude/                        # Claude Code configuration
    └── skills/                     # BMAD skills (45 installed)
```

### Architectural Boundaries

**API Boundaries:**

```
Browser ←→ Vercel (Next.js)
              ├── SSR pages (landing, login, register)
              ├── SPA client (demo, measure)
              ├── API routes (/api/chat, /api/infer, /api/auth/*)
              └── Proxy rewrites (/api/backend/* → Railway)

Railway (FastAPI)
              ├── Image processing endpoints
              ├── AI inference orchestration
              ├── Mask editing + undo/redo
              └── Export generation (PDF, DXF)
```

**Component Boundaries:**
- `demo-client.tsx` is the ONLY orchestrator — all step components receive props from it
- Step components do NOT communicate with each other directly
- Panel components are children of `results-step.tsx` (except ChatPanel which is global)
- UI components in `/ui/` are stateless primitives

**Data Boundaries:**
- Frontend NEVER calls Roboflow directly — always through `/api/infer` or `/api/backend/analyze`
- Backend sessions are isolated per session_id with threading locks
- localStorage used only for session restore metadata, not for large image data
- Auth tokens (JWT) managed entirely by NextAuth — no manual token handling

### Requirements to Structure Mapping

| FR Category | Frontend Location | Backend Endpoint |
|---|---|---|
| FR-UPLOAD | components/demo/upload-step.tsx | /upload-pdf, /upload-image |
| FR-PREP | components/demo/crop-step.tsx, scale-step.tsx | /crop, /calibrate |
| FR-ANALYSIS | components/demo/analyze-step.tsx, connect-step.tsx | /analyze, /compare |
| FR-RESULTS | components/demo/results-step.tsx + panel components | /image/{session}/{type} |
| FR-EDITOR | components/demo/editor-step.tsx | /edit-mask, /edit-room-mask, /sam-segment, /undo-*, /redo-* |
| FR-EXPORT | lib/*-pdf.ts, rapport-dialog.tsx, devis-dialog.tsx | /export-pdf, /export-dxf, /export-measure-pdf |
| FR-MEASURE | components/measure/*, lib/metre-*.ts | N/A (client-side) |
| FR-CHAT | components/demo/chat-panel.tsx | /api/chat (Next.js route) |
| FR-AUTH | app/login, app/register, middleware.ts, auth.ts | /api/auth/* (Next.js routes) |

### Integration Points

**Internal Communication:**
- Frontend → Backend: HTTP REST via Next.js rewrite proxy
- Component → Component: React props (parent to child), callbacks (child to parent)
- Step → Orchestrator: Callback props (onUploaded, onCropped, onScaleSet, onAnalyzed)
- Chat → API: Vercel AI SDK streaming (SSE)

**External Integrations:**
- Roboflow API: Model inference (proxied through /api/infer and /api/backend/analyze)
- OpenAI API: Chat completions (GPT-4o-mini via Vercel AI SDK)
- Groq API: Alternative LLM provider (configured in /api/chat)
- Neon PostgreSQL: User authentication database
- Tesseract OCR: Cartouche text extraction (system dependency in Docker)

**Data Flow:**

```
PDF Upload → PyMuPDF (page extraction) → numpy array → session
Image Upload → PIL decode → numpy array → session
Crop → OpenCV crop → updated session image
Scale → Calibration math → px/m ratio in session
Analyze → Roboflow inference (tiled) → OpenCV masks → session
Edit → Mask merge/paint → undo snapshot → recalculate → session
Export → Session data → PDF/DXF/CSV generation → file bytes → download
```

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:** All technology choices are proven compatible — Next.js 14 + Tailwind + Radix + Framer Motion is a well-tested combination. FastAPI + OpenCV + Roboflow inference-sdk work together reliably. The proxy rewrite pattern eliminates CORS issues cleanly.

**Pattern Consistency:** Naming conventions (kebab-case files, PascalCase components, camelCase functions) are consistent across the existing codebase. Backend follows Python conventions (snake_case) throughout.

**Structure Alignment:** The feature-based component organization maps directly to the 5 application modes (demo, measure, facade, diff, cartouche). The stepper workflow architecture naturally segments the 7-step process.

### Requirements Coverage Validation

**Functional Requirements Coverage:**
- FR-UPLOAD (4/4): Fully covered by upload-step.tsx + backend endpoints
- FR-PREP (5/5): Covered by crop-step.tsx + scale-step.tsx + backend
- FR-ANALYSIS (7/7): Pipeline G implementation + connect-step for admin
- FR-RESULTS (9/9): results-step.tsx + 10 panel components
- FR-EDITOR (5/5): editor-step.tsx + backend mask editing + SAM
- FR-EXPORT (6/6): Multiple *-pdf.ts libraries + backend endpoints
- FR-MEASURE (4/4): measure/ components + metre-calculator.ts
- FR-CHAT (5/5): chat-panel.tsx with dual modes + /api/chat
- FR-AUTH (4/4): NextAuth + middleware + localStorage session restore

**Non-Functional Requirements Coverage:**
- Performance (5/5): Tiled inference for large images, client-side rendering, CDN delivery
- Reliability (4/4): Session TTL, undo/redo integrity, graceful error handling
- Security (4/4): bcrypt, JWT, RBAC, API proxy for key protection
- Scalability (3/3): 50-session limit documented, migration path to Redis planned
- Accessibility (4/4): i18n (5 languages), Radix ARIA components, responsive 768px+
- Browser (3/3): Modern browsers 90+, pdfjs-dist cross-browser, WebGL fallback noted

### Implementation Readiness Validation

**Decision Completeness:** All critical and important decisions are documented with specific technology versions. Implementation patterns cover naming, structure, format, communication, and process patterns.

**Structure Completeness:** Complete directory tree with 100+ files mapped. Every FR category has a clear file/directory home.

**Pattern Completeness:** Naming conventions, error handling, loading states, undo/redo, data flow, and API formats are all specified with concrete examples.

### Gap Analysis Results

**Minor Gaps (Non-blocking):**
1. **Testing framework** — No test infrastructure yet (Jest, Vitest, Playwright). Recommend adding in Phase 2.
2. **CI/CD pipeline** — No GitHub Actions workflow. Relies on Vercel/Railway auto-deploy. Recommend adding linting + build check.
3. **Backend modularization** — main.py is 1500+ lines. Consider splitting into route modules when adding Phase 2 features.
4. **API documentation** — No OpenAPI/Swagger docs generated. FastAPI generates these automatically but they're not exposed.
5. **Monitoring/alerting** — Relies on platform logs only. Consider adding structured logging in Phase 2.

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed (medium-high)
- [x] Technical constraints identified (8 constraints documented)
- [x] Cross-cutting concerns mapped (6 concerns)

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented (error handling, loading, undo/redo)

**Project Structure**
- [x] Complete directory structure defined (100+ files)
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — brownfield project with established patterns and working codebase

**Key Strengths:**
- Multi-model AI strategy (Pipeline G) is well-designed and proven
- Clean frontend-backend separation via proxy pattern
- Feature-based component organization scales well
- Comprehensive export system with domain-specific documents
- 5-language i18n from day one

**Areas for Future Enhancement:**
- Add testing infrastructure (unit + e2e)
- Add CI/CD pipeline with automated checks
- Split backend into route modules for maintainability
- Migrate to Redis/PostgreSQL for persistent sessions (Phase 2)
- Add structured logging and monitoring

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document for all architectural questions
- Use existing patterns (look at similar components) before creating new patterns

**First Implementation Priority:**
Continue development on the existing brownfield codebase. Phase 2 features (facade, diff, cartouche, batch processing) should follow the same component organization and backend endpoint patterns established by the demo workflow.

---

*Architecture document generated 2026-03-16 for FloorScan. All sections based on codebase analysis, PRD requirements, and project memory context.*
