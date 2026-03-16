---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-exec-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
inputDocuments:
  - MEMORY.md (project memory)
  - README.md (project root)
  - frontend/lib/types.ts (type definitions)
  - frontend/lib/i18n.ts (internationalization)
  - frontend/app/demo/demo-client.tsx (main orchestrator)
  - backend/main.py (API server)
  - backend/pipeline.py (AI pipeline)
  - backend/requirements.txt (Python deps)
  - frontend/package.json (Node deps)
workflowType: 'prd'
classification:
  projectType: web_app
  domain: construction_aec
  complexity: medium-high
  projectContext: brownfield
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 0
  projectDocs: 1
---

# Product Requirements Document - FloorScan

**Author:** Marco
**Date:** 2026-03-16
**Version:** 1.0

## Executive Summary

FloorScan is an AI-powered architectural floor plan analysis platform that transforms static building plans (PDF/images) into structured, actionable data for construction professionals. It combines computer vision (Roboflow multi-model inference), interactive editing (SAM segmentation), and automated reporting (DPGF costing, PMR compliance, PDF/DXF export) into a single browser-based workflow.

**What makes it special:** FloorScan's "best-of" Pipeline G cherry-picks the strongest detection from 7 specialized AI models (walls from Model D at 95.8% mAP, doors from Model A, windows from Model D) rather than relying on a single model. This multi-model consensus approach delivers detection accuracy that no single model achieves alone. The 7-step guided workflow (Upload → Crop → Scale → Connect → Analyze → Results → Editor) makes complex AI analysis accessible to non-technical BTP professionals.

**Project classification:** Brownfield web application (Next.js 14 + FastAPI) in the Construction/AEC domain. Medium-high complexity due to multi-model AI pipelines, real-time image processing, mask editing with undo/redo, and domain-specific reporting (DPGF, CCTP, compliance).

**Target market:** French BTP professionals — general contractors (entreprises g, TCE), quantity surveyors (m, OPC), architects, and real estate developers who need fast, reliable plan analysis without manual measurement.

## Success Criteria

### User Success
- **Time to analysis:** < 3 minutes from PDF upload to full surface/opening analysis (vs. 30+ minutes manual)
- **Detection accuracy:** > 90% for doors/windows, > 85% for room boundary detection
- **User adoption:** Users complete the full 7-step workflow without abandoning (> 70% completion rate)
- **Repeat usage:** Users return for additional plans within 30 days (> 40% retention)

### Business Success
- **Active users:** 100+ monthly active users within 6 months of launch
- **Plan analyses:** 500+ plans analyzed per month
- **Export utilization:** > 50% of completed analyses result in at least one export (PDF, DXF, CSV)

### Technical Success
- **Pipeline reliability:** < 2% analysis failure rate
- **Session stability:** Sessions persist reliably for 1-hour working windows
- **Multi-page support:** PDF documents with 10+ pages handled without degradation
- **Response time:** Analysis endpoint returns within 60 seconds for standard residential plans

## Product Scope

### Phase 1 — MVP (Current State)
Core AI analysis workflow: upload, crop, scale calibration, multi-model detection (Pipeline G), results visualization with mask overlays, interactive mask editor with SAM, and export (PDF, DXF, CSV). Includes manual measurement mode (Metré), AI chatbot assistant, and 5-language support.

### Phase 2 — Growth
Facade analysis (building elevations), plan version comparison (Diff), cartouche/legend OCR extraction, multi-page PDF batch processing, collaborative features, and cloud session persistence.

### Phase 3 — Expansion
BIM integration (IFC export), automated regulatory compliance reports, client portal with project management, API access for third-party integrations, mobile-optimized experience.

## User Journeys

### Journey 1: The General Contractor — Quick Plan Analysis

**Persona:** Jean, 45, general contractor (TCE). Receives 5-10 plans per week from architects. Needs surface areas and opening counts fast for quotes.

**Journey:**
1. Jean opens FloorScan, selects "Analyse IA", uploads a multi-page PDF of a residential project
2. He selects page 2 (ground floor plan), the system converts it to a high-resolution image
3. He crops the plan to remove the legend/cartouche border
4. Auto-scale detects the scale from the plan markings; Jean confirms it matches "1:100"
5. Pipeline G runs: walls detected (amber overlay), doors (green), windows (cyan), french doors (orange), rooms auto-labeled
6. Results show: 85.2 m2 habitable, 12 doors, 8 windows, 2 french doors, 7 rooms identified
7. Jean toggles mask overlays to verify detection, notices a missed door — opens the Editor
8. In the editor, he uses SAM (click-to-segment) to add the missing door, saves
9. Returns to Results, exports an annotated PDF for his client quote
10. Uses the AI chatbot: "Quel est le coût estimé du lot peinture ?" — gets a DPGF breakdown

**Key requirements revealed:** Fast PDF handling, accurate auto-scale, reliable multi-model detection, intuitive mask editing, quick export, AI-powered cost estimation.

### Journey 2: The Quantity Surveyor — Detailed Measurement

**Persona:** Sophie, 32, quantity surveyor (OPC). Needs precise measurements for bills of quantities.

**Journey:**
1. Sophie uploads a commercial building plan, uses manual scale calibration (traces a known 5m wall)
2. After AI analysis, she switches to the Materials panel for detailed material estimation
3. She adjusts ceiling height (2.50m → 3.00m for commercial) and waste percentage
4. Reviews the DPGF with lot-by-lot pricing, exports to PDF
5. Opens the CCTP panel for technical specifications
6. Switches to Metré mode for manual polygon measurements of irregular spaces
7. Exports everything as a comprehensive Rapport Pro PDF

**Key requirements revealed:** Precise manual calibration, material estimation parameters, DPGF accuracy, CCTP generation, hybrid AI + manual measurement, professional report export.

### Journey 3: The Architect — Plan Comparison

**Persona:** Pierre, 38, architect. Compares V1 and V2 of a renovation project.

**Journey:**
1. Pierre uses the Diff mode, uploads V1 (existing) and V2 (proposed)
2. The system aligns both plans and highlights changes (new walls, removed doors, resized rooms)
3. Side-by-side view with overlay mode shows additions in green, removals in red
4. He exports the diff visualization for client presentation

**Key requirements revealed:** Multi-plan comparison, intelligent alignment, visual diff overlay, export capabilities.

### Journey 4: The Admin — Model Management

**Persona:** Marco, developer/admin. Manages AI models and monitors system health.

**Journey:**
1. Marco logs in with admin credentials, accesses the Connect step (hidden for regular users)
2. He configures a new Roboflow model for testing, adjusts API keys and confidence thresholds
3. Uses the Compare feature to benchmark 7 models side-by-side on a reference plan
4. Reviews consensus detection details, adjusts Pipeline G configuration
5. Monitors active sessions and system health

**Key requirements revealed:** Admin authentication, model configuration, multi-model comparison, session monitoring.

## Journey Requirements Summary

| Requirement Area | J1 (Contractor) | J2 (Surveyor) | J3 (Architect) | J4 (Admin) |
|---|---|---|---|---|
| PDF upload & page selection | Yes | Yes | Yes | - |
| Image crop | Yes | Yes | - | - |
| Auto-scale detection | Yes | - | - | - |
| Manual scale calibration | - | Yes | - | - |
| Multi-model AI analysis | Yes | Yes | - | Yes |
| Mask overlay visualization | Yes | Yes | - | - |
| Interactive mask editor (SAM) | Yes | - | - | - |
| Material estimation | - | Yes | - | - |
| DPGF / CCTP generation | Yes | Yes | - | - |
| Plan comparison (Diff) | - | - | Yes | - |
| Export (PDF, DXF, CSV) | Yes | Yes | Yes | - |
| Admin model configuration | - | - | - | Yes |
| AI chatbot assistant | Yes | Yes | - | - |
| Manual measurement (Metré) | - | Yes | - | - |

## Domain-Specific Requirements

### Construction/AEC Domain Constraints

**Measurement Standards:**
- All surface calculations follow French building measurement standards (surface habitable, surface de plancher, SHOB/SHON)
- Metric system exclusively (m, m2, m3)
- Scale calibration must support standard architectural scales (1:50, 1:100, 1:200, 1:500)

**Industry Terminology:**
- All labels, reports, and AI responses use French BTP vocabulary (lot, DPGF, CCTP, PMR, etc.)
- Room type classification follows French standards (S, Cuisine, SdB, WC, Couloir, Bureau...)

**Regulatory Compliance:**
- PMR (Personnes Mobilite R) accessibility checking for door widths, corridor widths, turning radius
- Building code surface minimums per room type
- DPGF pricing follows French construction lot structure (13 standard lots)

**Integration Requirements:**
- DXF export for AutoCAD/BIM software interoperability
- PDF generation matching French architectural documentation standards
- CSV export compatible with standard quantity surveying tools

## Technical Architecture Considerations

### Web Application Architecture

**Frontend (Next.js 14 + TypeScript + Tailwind CSS):**
- Single-page application with client-side routing
- 5 application modes: IA Analysis, Metré, Facade, Diff, Cartouche
- 7-step wizard UI with stepper navigation and back buttons
- Session persistence via localStorage (2-hour TTL)
- API proxy through Next.js routes to backend (CORS avoidance)
- Real-time streaming for AI chatbot (Vercel AI SDK + OpenAI GPT-4o-mini)
- 3D visualization via Three.js / React Three Fiber
- PDF generation client-side (jspdf, pdf-lib)
- 5-language i18n support (FR, EN, ES, DE, IT)

**Backend (Python FastAPI):**
- 23 REST endpoints for the complete workflow
- In-memory session management with per-session threading locks
- Multi-model Roboflow inference with tiled processing (2048px + 1024px passes)
- OpenCV for mask operations, morphology, contour analysis
- Mask editing with compressed undo/redo history stacks
- SAM (Segment Anything Model) for interactive segmentation
- PyMuPDF for PDF rendering, ezdxf for AutoCAD export, Tesseract for OCR

**Authentication:**
- NextAuth v5 with credential-based login
- Admin role gating for Connect step and model configuration
- Neon (serverless Postgres) for user storage

**Deployment:**
- Frontend: Vercel (automatic from GitHub)
- Backend: Railway (Docker container)
- Two GitHub remotes: origin (thehydrowave) + kevin (Kvn-Nhr/Floorscan linked to Railway)

### Key Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| AI inference | Roboflow (inference-sdk) | Pre-trained CubiCasa models + custom fine-tuning, cloud-hosted inference |
| Multi-model strategy | Pipeline G "best-of" | Cherry-pick strongest detector per element type across 7 models |
| Mask storage | In-memory compressed PNG | Fast editing with undo/redo, no persistent DB needed for analysis sessions |
| Frontend framework | Next.js 14 | SSR landing page + SPA demo, Vercel deployment, API routes as proxy |
| Styling | Tailwind CSS | Rapid UI development, dark theme, responsive |
| LLM integration | OpenAI GPT-4o-mini via Vercel AI SDK | Cost-effective streaming chat for plan analysis Q&A |
| PDF processing | PyMuPDF (backend) + pdf-lib (frontend) | Server-side PDF→image conversion, client-side annotated export |

## MVP Feature Set (Phase 1 — Implemented)

### Core Analysis Workflow
1. **PDF/Image Upload** — PDF multi-page support with page selection, direct JPG/PNG upload (max 50MB PDF, 100MB images)
2. **Image Crop** — Interactive crop tool with zoom/pan to isolate plan area
3. **Scale Calibration** — Auto-detection from plan markings + manual 2-point calibration
4. **AI Analysis (Pipeline G)** — Multi-model "best-of" detection: walls (Model D), doors (Model A), windows (Model D), french doors (cross-reference), rooms (CubiCasa), cloisons (AI minus pixel)
5. **Results Dashboard** — Surface breakdown (habitable, total, walls), opening counts, room list with areas, stackable mask overlays (doors/windows/walls/french-doors/cloisons/interior)
6. **Mask Editor** — Layer-based editing (7 mask types), brush/eraser tools, SAM click-to-segment, undo/redo history, real-time surface recalculation
7. **Export Suite** — Annotated PDF, DXF (AutoCAD), CSV, Rapport Pro PDF

### Analysis Panels
8. **Materials Panel** — Material estimation (paint, flooring, plaster) with configurable parameters
9. **DPGF Panel** — Lot-by-lot cost breakdown following French 13-lot structure
10. **CCTP Panel** — Technical specifications document generation
11. **Compliance Panel** — PMR accessibility compliance checking
12. **Gantt Panel** — Construction timeline estimation
13. **3D View** — Three.js floor plan visualization with extruded walls
14. **Scenarios Panel** — What-if renovation scenarios with cost comparison

### Additional Modes
15. **Metré (Manual Measurement)** — Polygon/rectangle zone drawing, surface type classification, area/perimeter calculation, CSV export
16. **AI Chatbot** — Global assistant (help mode + data analysis mode), auto-opens on IA/Metré selection, minimizable/retractable

### Infrastructure
17. **Multi-language UI** — FR, EN, ES, DE, IT with runtime switching
18. **Authentication** — Login/register, admin role, session restore
19. **Multi-model Comparison** — Side-by-side evaluation of 7 AI models (admin feature)
20. **Session Management** — Auto-save/restore, 1-hour TTL, beforeunload warning

## Post-MVP Features (Phase 2 & 3)

### Phase 2 — Growth
- **Facade Analysis** — Building elevation detection (windows, doors, balconies, floors) — WIP, mock data
- **Plan Diff** — V1/V2 comparison with alignment, side-by-side, overlay, and diff visualization — WIP
- **Cartouche OCR** — Legend/title block extraction (project name, architect, scale, date) — WIP
- **Multi-page Batch** — Analyze all pages of a PDF sequentially with per-page results storage
- **Cloud Sessions** — Persistent session storage (Redis/PostgreSQL) for cross-device access
- **Housing Detection** — Automatic apartment/unit identification in multi-unit buildings
- **Visual Search** — Find similar architectural elements across the plan

### Phase 3 — Expansion
- **BIM/IFC Export** — Industry Foundation Classes for BIM software integration
- **Automated Compliance Reports** — Full regulatory compliance documentation
- **Client Portal** — Multi-project management, team collaboration, client sharing
- **Public API** — REST API for third-party integrations
- **Mobile Optimization** — Responsive workflow for tablet/mobile usage
- **Lot Detection** — Automated lot/parcel boundary detection
- **Pattern Matching** — Detect recurring architectural patterns across projects

## Functional Requirements

### FR-UPLOAD: Document Input
- **FR1:** User can upload PDF files (up to 100MB) and select specific pages for analysis
- **FR2:** User can upload images directly (JPG, PNG up to 50MB)
- **FR3:** System converts PDF pages to high-resolution images (3x zoom) for analysis
- **FR4:** User can return to upload step to analyze additional pages of the same PDF

### FR-PREP: Image Preparation
- **FR5:** User can crop the uploaded image to isolate the floor plan area
- **FR6:** User can skip cropping if the image is already properly framed
- **FR7:** User can calibrate scale automatically (system detects scale markings)
- **FR8:** User can calibrate scale manually by tracing a known distance on the plan
- **FR9:** User can skip scale calibration (analysis proceeds without metric measurements)

### FR-ANALYSIS: AI Detection
- **FR10:** System detects walls, doors, windows, and french doors using multi-model Pipeline G
- **FR11:** System identifies room boundaries and classifies room types (14 types)
- **FR12:** System calculates surfaces (habitable, building, walls) in m2
- **FR13:** System counts and measures all openings (doors, windows, french doors) with dimensions
- **FR14:** System generates RGBA mask overlays for each detected element type
- **FR15:** Admin can configure AI model parameters (API key, model name, confidence thresholds)
- **FR16:** Admin can compare up to 7 models side-by-side with consensus analysis

### FR-RESULTS: Visualization & Analysis
- **FR17:** User can toggle visibility of individual mask overlays (doors, windows, walls, french doors, cloisons, interior)
- **FR18:** User can view room list with type, area (m2), and perimeter (m) for each room
- **FR19:** User can access material estimation with configurable parameters (ceiling height, waste %)
- **FR20:** User can generate DPGF cost breakdown by construction lot
- **FR21:** User can generate CCTP technical specifications
- **FR22:** User can check PMR compliance for all detected rooms and openings
- **FR23:** User can view 3D visualization of the floor plan
- **FR24:** User can use the AI chatbot to ask questions about analysis data
- **FR25:** User can navigate back to any completed step via stepper clicks

### FR-EDITOR: Mask Editing
- **FR26:** User can edit any mask layer (walls, doors, windows, french doors, cloisons, interior) with brush/eraser tools
- **FR27:** User can use SAM (click-to-segment) to automatically segment elements
- **FR28:** User can undo/redo mask edits with full history
- **FR29:** System recalculates surfaces and counts in real-time after mask edits
- **FR30:** User can switch between editor and results views preserving all changes

### FR-EXPORT: Document Generation
- **FR31:** User can export annotated PDF with detected elements overlay
- **FR32:** User can export DXF file for AutoCAD/BIM software
- **FR33:** User can export CSV with detection data
- **FR34:** User can generate comprehensive Rapport Pro PDF
- **FR35:** User can generate DPGF PDF with lot-by-lot pricing
- **FR36:** User can generate compliance report PDF

### FR-MEASURE: Manual Measurement
- **FR37:** User can draw polygon and rectangle zones on the plan
- **FR38:** User can classify zones by surface type (habitable, circulation, technical, exterior)
- **FR39:** System calculates area and perimeter for each zone
- **FR40:** User can export measurement data as CSV

### FR-CHAT: AI Assistant
- **FR41:** Chatbot is accessible on all workflow steps (global floating panel)
- **FR42:** In help mode (no analysis), chatbot guides users through app features
- **FR43:** In analysis mode (results available), chatbot answers questions about plan data
- **FR44:** Chatbot supports streaming responses with markdown formatting
- **FR45:** User can minimize chatbot to a slim bar or close it entirely

### FR-AUTH: Authentication & Administration
- **FR46:** Users can register and login with email/password
- **FR47:** Admin users can access the Connect step for model configuration
- **FR48:** System saves and restores analysis sessions (2-hour window)
- **FR49:** System warns users before leaving with unsaved work

## Non-Functional Requirements

### Performance
- **NFR1:** PDF upload and conversion completes within 10 seconds for files under 20MB
- **NFR2:** AI analysis (Pipeline G) completes within 60 seconds for standard residential plans (< 5000px)
- **NFR3:** Mask editor operations (brush, SAM) respond within 500ms
- **NFR4:** Chat responses begin streaming within 2 seconds
- **NFR5:** Frontend initial load (demo page) under 3 seconds on broadband

### Reliability
- **NFR6:** Analysis pipeline failure rate < 2% for supported file formats
- **NFR7:** Session data preserved reliably for 1-hour working window
- **NFR8:** Undo/redo history maintains integrity across all mask types (7 layers)
- **NFR9:** Graceful degradation when Roboflow API is unavailable (clear error messaging)

### Security
- **NFR10:** User passwords hashed with bcrypt
- **NFR11:** Admin routes protected by role-based access control
- **NFR12:** API keys not exposed to frontend (proxy through Next.js API routes)
- **NFR13:** Session data isolated per user (per-session locks)

### Scalability
- **NFR14:** Backend supports 50 concurrent sessions with in-memory storage
- **NFR15:** Frontend static assets served via Vercel CDN globally
- **NFR16:** Architecture supports migration to Redis/PostgreSQL for session persistence

### Accessibility & Internationalization
- **NFR17:** UI supports 5 languages with runtime switching (FR, EN, ES, DE, IT)
- **NFR18:** All interactive elements have appropriate ARIA labels
- **NFR19:** Responsive layout functional on screens 768px and above
- **NFR20:** Dark theme by default with theme switcher available

### Browser Compatibility
- **NFR21:** Full functionality in Chrome 90+, Firefox 90+, Edge 90+, Safari 15+
- **NFR22:** PDF.js rendering consistent across supported browsers
- **NFR23:** Three.js 3D view requires WebGL support (graceful fallback if unavailable)

---

*PRD generated 2026-03-16 for FloorScan v1.0. All sections based on existing codebase analysis and project memory context.*
