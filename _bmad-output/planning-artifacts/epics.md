---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - prd.md
  - architecture.md
status: 'complete'
completedAt: '2026-03-16'
---

# FloorScan - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for FloorScan, decomposing the requirements from the PRD and Architecture into implementable stories organized by user value.

## Requirements Inventory

### Functional Requirements

- FR1: User can upload PDF files (up to 100MB) and select specific pages for analysis
- FR2: User can upload images directly (JPG, PNG up to 50MB)
- FR3: System converts PDF pages to high-resolution images (3x zoom) for analysis
- FR4: User can return to upload step to analyze additional pages of the same PDF
- FR5: User can crop the uploaded image to isolate the floor plan area
- FR6: User can skip cropping if the image is already properly framed
- FR7: User can calibrate scale automatically (system detects scale markings)
- FR8: User can calibrate scale manually by tracing a known distance on the plan
- FR9: User can skip scale calibration (analysis proceeds without metric measurements)
- FR10: System detects walls, doors, windows, and french doors using multi-model Pipeline G
- FR11: System identifies room boundaries and classifies room types (14 types)
- FR12: System calculates surfaces (habitable, building, walls) in m2
- FR13: System counts and measures all openings (doors, windows, french doors) with dimensions
- FR14: System generates RGBA mask overlays for each detected element type
- FR15: Admin can configure AI model parameters (API key, model name, confidence thresholds)
- FR16: Admin can compare up to 7 models side-by-side with consensus analysis
- FR17: User can toggle visibility of individual mask overlays (doors, windows, walls, french doors, cloisons, interior)
- FR18: User can view room list with type, area (m2), and perimeter (m) for each room
- FR19: User can access material estimation with configurable parameters (ceiling height, waste %)
- FR20: User can generate DPGF cost breakdown by construction lot
- FR21: User can generate CCTP technical specifications
- FR22: User can check PMR compliance for all detected rooms and openings
- FR23: User can view 3D visualization of the floor plan
- FR24: User can use the AI chatbot to ask questions about analysis data
- FR25: User can navigate back to any completed step via stepper clicks
- FR26: User can edit any mask layer (walls, doors, windows, french doors, cloisons, interior) with brush/eraser tools
- FR27: User can use SAM (click-to-segment) to automatically segment elements
- FR28: User can undo/redo mask edits with full history
- FR29: System recalculates surfaces and counts in real-time after mask edits
- FR30: User can switch between editor and results views preserving all changes
- FR31: User can export annotated PDF with detected elements overlay
- FR32: User can export DXF file for AutoCAD/BIM software
- FR33: User can export CSV with detection data
- FR34: User can generate comprehensive Rapport Pro PDF
- FR35: User can generate DPGF PDF with lot-by-lot pricing
- FR36: User can generate compliance report PDF
- FR37: User can draw polygon and rectangle zones on the plan
- FR38: User can classify zones by surface type (habitable, circulation, technical, exterior)
- FR39: System calculates area and perimeter for each zone
- FR40: User can export measurement data as CSV
- FR41: Chatbot is accessible on all workflow steps (global floating panel)
- FR42: In help mode (no analysis), chatbot guides users through app features
- FR43: In analysis mode (results available), chatbot answers questions about plan data
- FR44: Chatbot supports streaming responses with markdown formatting
- FR45: User can minimize chatbot to a slim bar or close it entirely
- FR46: Users can register and login with email/password
- FR47: Admin users can access the Connect step for model configuration
- FR48: System saves and restores analysis sessions (2-hour window)
- FR49: System warns users before leaving with unsaved work

### NonFunctional Requirements

- NFR1: PDF upload and conversion completes within 10 seconds for files under 20MB
- NFR2: AI analysis (Pipeline G) completes within 60 seconds for standard residential plans (< 5000px)
- NFR3: Mask editor operations (brush, SAM) respond within 500ms
- NFR4: Chat responses begin streaming within 2 seconds
- NFR5: Frontend initial load (demo page) under 3 seconds on broadband
- NFR6: Analysis pipeline failure rate < 2% for supported file formats
- NFR7: Session data preserved reliably for 1-hour working window
- NFR8: Undo/redo history maintains integrity across all mask types (7 layers)
- NFR9: Graceful degradation when Roboflow API is unavailable (clear error messaging)
- NFR10: User passwords hashed with bcrypt
- NFR11: Admin routes protected by role-based access control
- NFR12: API keys not exposed to frontend (proxy through Next.js API routes)
- NFR13: Session data isolated per user (per-session locks)
- NFR14: Backend supports 50 concurrent sessions with in-memory storage
- NFR15: Frontend static assets served via Vercel CDN globally
- NFR16: Architecture supports migration to Redis/PostgreSQL for session persistence
- NFR17: UI supports 5 languages with runtime switching (FR, EN, ES, DE, IT)
- NFR18: All interactive elements have appropriate ARIA labels
- NFR19: Responsive layout functional on screens 768px and above
- NFR20: Dark theme by default with theme switcher available
- NFR21: Full functionality in Chrome 90+, Firefox 90+, Edge 90+, Safari 15+
- NFR22: PDF.js rendering consistent across supported browsers
- NFR23: Three.js 3D view requires WebGL support (graceful fallback if unavailable)

### Additional Requirements

- Brownfield project — all epics enhance or stabilize the existing codebase
- Backend main.py is monolithic (1500+ lines) — new features follow existing patterns
- Two-remote git strategy (origin for Vercel frontend, kevin for Railway backend)
- Next.js API routes serve as proxy to eliminate CORS
- In-memory session storage with 50-session cap and 1-hour TTL
- Docker container for backend (python:3.11-slim + Tesseract OCR)

### UX Design Requirements

No UX Design specification document available. UX patterns follow existing codebase conventions (Tailwind + Radix UI + Framer Motion).

### FR Coverage Map

- FR1, FR2, FR3, FR4: Epic 1 — Document Upload & Page Selection
- FR5, FR6: Epic 2 — Image Preparation & Cropping
- FR7, FR8, FR9: Epic 2 — Image Preparation & Cropping
- FR10, FR11, FR12, FR13, FR14: Epic 3 — AI Analysis Pipeline
- FR15, FR16: Epic 7 — Admin & Model Configuration
- FR17, FR18: Epic 4 — Results Visualization & Exploration
- FR19, FR20, FR21, FR22, FR23: Epic 4 — Results Visualization & Exploration
- FR24, FR41, FR42, FR43, FR44, FR45: Epic 6 — AI Chatbot Assistant
- FR25: Epic 4 — Results Visualization & Exploration
- FR26, FR27, FR28, FR29, FR30: Epic 5 — Interactive Mask Editor
- FR31, FR32, FR33, FR34, FR35, FR36: Epic 4 — Results Visualization & Exploration
- FR37, FR38, FR39, FR40: Epic 8 — Manual Measurement (Metré)
- FR46, FR47: Epic 7 — Admin & Model Configuration
- FR48, FR49: Epic 9 — Session Management & Reliability

## Epic List

### Epic 1: Document Upload & Page Selection
Users can upload PDF documents or images and select specific pages for analysis, providing the entry point to the entire FloorScan workflow.
**FRs covered:** FR1, FR2, FR3, FR4

### Epic 2: Image Preparation & Scale Calibration
Users can crop their floor plan images and calibrate the scale (automatically or manually), ensuring accurate metric measurements for all subsequent analysis.
**FRs covered:** FR5, FR6, FR7, FR8, FR9

### Epic 3: AI Analysis Pipeline
The system performs multi-model AI detection (Pipeline G) to identify walls, doors, windows, french doors, rooms, and calculate all surfaces and measurements automatically.
**FRs covered:** FR10, FR11, FR12, FR13, FR14

### Epic 4: Results Visualization & Export
Users can explore analysis results through interactive overlays, view room details, access specialized panels (materials, DPGF, CCTP, compliance, 3D), navigate between steps, and export professional documents.
**FRs covered:** FR17, FR18, FR19, FR20, FR21, FR22, FR23, FR25, FR31, FR32, FR33, FR34, FR35, FR36

### Epic 5: Interactive Mask Editor
Users can manually refine AI detection results by editing mask layers with brush/eraser tools, using SAM click-to-segment, with full undo/redo and real-time recalculation.
**FRs covered:** FR26, FR27, FR28, FR29, FR30

### Epic 6: AI Chatbot Assistant
A global AI chatbot is accessible on all workflow steps, providing contextual help in navigation mode and data-driven analysis answers when results are available.
**FRs covered:** FR24, FR41, FR42, FR43, FR44, FR45

### Epic 7: Authentication & Admin Configuration
Users can register and login, admin users can access model configuration and multi-model comparison tools for managing AI detection quality.
**FRs covered:** FR15, FR16, FR46, FR47

### Epic 8: Manual Measurement (Metré)
Users can draw polygon and rectangle zones on plans for manual surface measurement, classify zones by type, and export measurement data.
**FRs covered:** FR37, FR38, FR39, FR40

### Epic 9: Session Management & Reliability
The system reliably saves and restores analysis sessions, warns users about unsaved work, and maintains stable operations under concurrent usage.
**FRs covered:** FR48, FR49

---

## Epic 1: Document Upload & Page Selection

Users can upload PDF documents or images and select specific pages for analysis, providing the entry point to the entire FloorScan workflow.

### Story 1.1: Upload PDF and Select Page

As a construction professional,
I want to upload a multi-page PDF and select a specific page,
So that I can analyze individual floor plans from architectural documents.

**Acceptance Criteria:**

**Given** a user on the upload step
**When** they select a PDF file (up to 100MB)
**Then** the system displays all pages as thumbnails for selection
**And** the user can click a page to select it for analysis

**Given** a selected PDF page
**When** the system processes it
**Then** it converts the page to a high-resolution image (3x zoom)
**And** the session is created on the backend with the converted image

**Given** an invalid or corrupt PDF
**When** the user attempts to upload it
**Then** the system displays a clear error message in the user's language

### Story 1.2: Upload Image Directly

As a construction professional,
I want to upload a JPG or PNG image directly,
So that I can analyze floor plans that are already in image format.

**Acceptance Criteria:**

**Given** a user on the upload step
**When** they select a JPG or PNG file (up to 50MB)
**Then** the system uploads and stores the image in the backend session
**And** the user proceeds to the crop step

**Given** an unsupported file format
**When** the user attempts to upload it
**Then** the system displays an error indicating supported formats (PDF, JPG, PNG)

### Story 1.3: Return to Upload for Additional Pages

As a construction professional,
I want to return to the upload step to analyze another page from the same PDF,
So that I can process multiple floors without re-uploading the entire document.

**Acceptance Criteria:**

**Given** a user who has completed analysis on one page
**When** they navigate back to the upload step via the stepper
**Then** the previously uploaded PDF is still available
**And** they can select a different page for new analysis

---

## Epic 2: Image Preparation & Scale Calibration

Users can crop their floor plan images and calibrate the scale (automatically or manually), ensuring accurate metric measurements for all subsequent analysis.

### Story 2.1: Crop Floor Plan Image

As a construction professional,
I want to crop the uploaded image to isolate the floor plan area,
So that the AI analysis focuses only on the relevant plan content.

**Acceptance Criteria:**

**Given** an uploaded image displayed on the crop step
**When** the user draws a crop rectangle with zoom/pan controls
**Then** the system crops the image to the selected area
**And** sends the cropped image to the backend for storage in the session

**Given** a properly framed image
**When** the user clicks "Skip Crop"
**Then** the system proceeds to scale calibration with the original image

### Story 2.2: Automatic Scale Detection

As a construction professional,
I want the system to automatically detect the scale from plan markings,
So that I can get accurate metric measurements without manual calibration.

**Acceptance Criteria:**

**Given** a cropped floor plan image with visible scale markings
**When** the system runs auto-scale detection
**Then** it identifies the scale ratio (e.g., 1:100) and calculates pixels per meter
**And** displays the detected scale for user confirmation

**Given** auto-detection fails or returns an unreliable result
**When** the user reviews the detected scale
**Then** they can switch to manual calibration or skip scale entirely

### Story 2.3: Manual Scale Calibration

As a quantity surveyor,
I want to manually calibrate the scale by tracing a known distance,
So that I can ensure precise measurements even when auto-detection fails.

**Acceptance Criteria:**

**Given** a user on the scale calibration step
**When** they click two points on the plan and enter the real-world distance (e.g., 5m)
**Then** the system calculates pixels per meter from the traced line
**And** stores the calibration value in the backend session

**Given** a user who doesn't need metric measurements
**When** they click "Skip Scale"
**Then** the system proceeds to analysis without metric calibration
**And** surface values are displayed in pixels rather than m2

---

## Epic 3: AI Analysis Pipeline

The system performs multi-model AI detection (Pipeline G) to identify walls, doors, windows, french doors, rooms, and calculate all surfaces and measurements automatically.

### Story 3.1: Run Multi-Model Detection (Pipeline G)

As a construction professional,
I want the system to detect all architectural elements using AI,
So that I get a complete analysis of walls, doors, windows, rooms, and surfaces automatically.

**Acceptance Criteria:**

**Given** a calibrated (or uncalibrated) floor plan image
**When** the user triggers analysis
**Then** Pipeline G runs multi-model inference:
- Walls detected using Model D (95.8% mAP)
- Doors detected using Model A
- Windows detected using Model D
- French doors detected via cross-reference
**And** results are stored in the backend session

**Given** a large image (> 5000px)
**When** Pipeline G runs
**Then** it uses tiled inference (2048px + 1024px passes) for accuracy
**And** completes within 60 seconds (NFR2)

**Given** the Roboflow API is unavailable
**When** analysis is attempted
**Then** the system displays a clear error message (NFR9)
**And** suggests the user try again later

### Story 3.2: Room Detection and Classification

As a construction professional,
I want the system to identify and classify all rooms,
So that I can see room types, areas, and perimeters in the results.

**Acceptance Criteria:**

**Given** a completed AI detection
**When** room boundary analysis runs
**Then** the system identifies up to 14 room types (Salon, Cuisine, SdB, WC, Chambre, Couloir, Bureau, etc.)
**And** calculates area (m2) and perimeter (m) for each room

**Given** detected architectural elements
**When** surface calculation runs
**Then** the system computes habitable surface, building surface, and wall surface
**And** counts all openings (doors, windows, french doors) with dimensions

### Story 3.3: Generate Mask Overlays

As a construction professional,
I want RGBA mask overlays for each detected element type,
So that I can visually verify and toggle detection results.

**Acceptance Criteria:**

**Given** completed AI detection results
**When** mask generation runs
**Then** the system produces base64-encoded RGBA PNG masks for:
- Walls (amber), Doors (green), Windows (cyan), French doors (orange), Cloisons, Interior
**And** all masks are stored in the backend session

---

## Epic 4: Results Visualization & Export

Users can explore analysis results through interactive overlays, view room details, access specialized panels, navigate between steps, and export professional documents.

### Story 4.1: Results Dashboard with Mask Overlays

As a construction professional,
I want to view analysis results with toggleable mask overlays,
So that I can visually verify what the AI detected on my floor plan.

**Acceptance Criteria:**

**Given** a completed analysis
**When** the user views the results step
**Then** they see surface breakdown (habitable, total, walls), opening counts, and room list
**And** can toggle visibility of individual overlays (doors, windows, walls, french doors, cloisons, interior)

**Given** a room list is displayed
**When** the user reviews rooms
**Then** each room shows type, area (m2), and perimeter (m)

### Story 4.2: Materials Estimation Panel

As a quantity surveyor,
I want to estimate materials with configurable parameters,
So that I can generate material quantities for quotes.

**Acceptance Criteria:**

**Given** analysis results are available
**When** the user opens the Materials panel
**Then** they can adjust ceiling height and waste percentage
**And** the system calculates paint, flooring, and plaster quantities

### Story 4.3: DPGF Cost Breakdown Panel

As a construction professional,
I want to generate a DPGF cost breakdown by construction lot,
So that I can produce lot-by-lot pricing for my project quotes.

**Acceptance Criteria:**

**Given** analysis results with surface data
**When** the user opens the DPGF panel
**Then** the system displays a 13-lot cost breakdown following French BTP standards
**And** the user can export the DPGF as a PDF document (FR35)

### Story 4.4: CCTP Technical Specifications Panel

As a quantity surveyor,
I want to generate CCTP technical specifications,
So that I can produce technical documentation for the project.

**Acceptance Criteria:**

**Given** analysis results
**When** the user opens the CCTP panel
**Then** the system generates technical specifications based on detected elements
**And** the user can export CCTP content

### Story 4.5: PMR Compliance Panel

As an architect,
I want to check PMR accessibility compliance,
So that I can verify the floor plan meets regulatory requirements.

**Acceptance Criteria:**

**Given** analysis results with doors and room data
**When** the user opens the Compliance panel
**Then** the system checks door widths, corridor widths, and turning radius against PMR standards
**And** displays pass/fail for each room and opening
**And** the user can export a compliance report PDF (FR36)

### Story 4.6: 3D Visualization Panel

As a construction professional,
I want to view a 3D visualization of the floor plan,
So that I can better understand spatial relationships.

**Acceptance Criteria:**

**Given** analysis results with wall masks
**When** the user opens the 3D View panel
**Then** Three.js renders an extruded 3D floor plan
**And** the user can orbit, pan, and zoom the 3D view

**Given** a browser without WebGL support
**When** the 3D view is requested
**Then** the system displays a fallback message (NFR23)

### Story 4.7: Export Suite (PDF, DXF, CSV, Rapport Pro)

As a construction professional,
I want to export analysis results in multiple formats,
So that I can share findings with clients and import into other tools.

**Acceptance Criteria:**

**Given** completed analysis results
**When** the user clicks export PDF
**Then** the system generates an annotated PDF with detected elements overlay (FR31)

**Given** completed analysis results
**When** the user clicks export DXF
**Then** the system generates a DXF file for AutoCAD/BIM software (FR32)

**Given** completed analysis results
**When** the user clicks export CSV
**Then** the system exports detection data in CSV format (FR33)

**Given** completed analysis results
**When** the user clicks Rapport Pro
**Then** the system generates a comprehensive professional PDF report (FR34)

### Story 4.8: Stepper Navigation with Back Support

As a construction professional,
I want to navigate back to any completed step via the stepper,
So that I can review or redo earlier steps without losing my progress.

**Acceptance Criteria:**

**Given** a user on any step beyond step 1
**When** they click a completed step in the stepper
**Then** they navigate to that step while preserving all current data
**And** completed steps are visually distinct and clickable

---

## Epic 5: Interactive Mask Editor

Users can manually refine AI detection results by editing mask layers with brush/eraser tools, using SAM click-to-segment, with full undo/redo and real-time recalculation.

### Story 5.1: Layer-Based Mask Editing with Brush/Eraser

As a construction professional,
I want to edit detection masks with brush and eraser tools,
So that I can correct AI detection errors manually.

**Acceptance Criteria:**

**Given** the user opens the editor step
**When** they select a mask layer (walls, doors, windows, french doors, cloisons, interior)
**Then** they can paint with a brush tool to add detected areas
**And** erase with an eraser tool to remove false detections
**And** the mask overlay updates in real-time

**Given** the user edits a mask
**When** they save the edit
**Then** the backend recalculates surfaces and counts in real-time (FR29)
**And** the updated mask is stored in the session

### Story 5.2: SAM Click-to-Segment

As a construction professional,
I want to click on an element to automatically segment it,
So that I can quickly add missed detections without manual brushing.

**Acceptance Criteria:**

**Given** the user is in the editor with a layer selected
**When** they click on an architectural element
**Then** SAM (Segment Anything Model) generates a segmentation mask for that element
**And** the segmented area is added to the current layer mask

**Given** SAM produces an inaccurate segment
**When** the user uses undo
**Then** the segment is removed and the previous mask state is restored

### Story 5.3: Undo/Redo Edit History

As a construction professional,
I want to undo and redo my mask edits,
So that I can experiment without fear of losing previous states.

**Acceptance Criteria:**

**Given** the user has made mask edits
**When** they click undo
**Then** the previous mask state is restored from the history stack
**And** the undone state is pushed to the redo stack

**Given** the user has undone edits
**When** they click redo
**Then** the next mask state is restored from the redo stack

**Given** the undo/redo system
**When** integrity is checked across all 7 mask layers
**Then** each layer maintains its own independent history (NFR8)

### Story 5.4: Switch Between Editor and Results

As a construction professional,
I want to switch between editor and results views,
So that I can verify my edits in the results context.

**Acceptance Criteria:**

**Given** the user has made edits in the editor
**When** they switch to the results view
**Then** all mask changes are preserved and reflected in the results
**And** updated surfaces and counts are displayed

---

## Epic 6: AI Chatbot Assistant

A global AI chatbot is accessible on all workflow steps, providing contextual help in navigation mode and data-driven analysis answers when results are available.

### Story 6.1: Global Floating Chatbot Panel

As a user,
I want an AI chatbot accessible on every step of the workflow,
So that I can get help anytime without leaving my current context.

**Acceptance Criteria:**

**Given** a user on any workflow step
**When** they click the floating chat button
**Then** the chatbot panel opens with a context-aware welcome message
**And** the panel can be minimized to a slim bar or closed entirely (FR45)

**Given** the user is on IA or Metré mode
**When** the workflow starts
**Then** the chatbot auto-opens after 1.2 seconds (auto-open behavior)
**And** does not re-open if the user closes it

### Story 6.2: Help Mode (No Analysis Data)

As a new user,
I want the chatbot to guide me through app features,
So that I can learn how to use FloorScan effectively.

**Acceptance Criteria:**

**Given** no analysis results are available
**When** the user interacts with the chatbot
**Then** it operates in help mode with app usage suggestions
**And** provides step-specific guidance based on the current step (FR42)

### Story 6.3: Analysis Mode (Results Available)

As a construction professional,
I want the chatbot to answer questions about my analysis data,
So that I can get quick insights without manual calculation.

**Acceptance Criteria:**

**Given** analysis results are available
**When** the user asks a question (e.g., "What is the paint cost estimate?")
**Then** the chatbot answers using the actual analysis data (surfaces, rooms, openings, DPGF)
**And** responses stream with markdown formatting (FR44)

---

## Epic 7: Authentication & Admin Configuration

Users can register and login, admin users can access model configuration and multi-model comparison tools for managing AI detection quality.

### Story 7.1: User Registration and Login

As a new user,
I want to register with email/password and login,
So that I can access the FloorScan analysis tools.

**Acceptance Criteria:**

**Given** a visitor on the login page
**When** they enter valid credentials
**Then** they are authenticated via NextAuth JWT and redirected to the demo page

**Given** a new visitor
**When** they register with email, name, and password
**Then** the account is created in Neon PostgreSQL with bcrypt-hashed password (NFR10)
**And** they can login immediately

**Given** a non-authenticated user
**When** they try to access /demo, /measure, or /admin
**Then** they are redirected to the login page (NFR11)

### Story 7.2: Admin Model Configuration (Connect Step)

As an admin,
I want to configure AI model parameters and compare models,
So that I can optimize detection quality.

**Acceptance Criteria:**

**Given** an admin user on the Connect step
**When** they configure a Roboflow model (API key, model name, confidence thresholds)
**Then** the configuration is stored and used for subsequent analyses

**Given** an admin user
**When** they use the Compare feature
**Then** up to 7 models run side-by-side on the same reference plan (FR16)
**And** consensus analysis shows which model performs best per element type

**Given** a non-admin user
**When** they attempt to access the Connect step
**Then** the step is hidden from the stepper navigation

---

## Epic 8: Manual Measurement (Metré)

Users can draw polygon and rectangle zones on plans for manual surface measurement, classify zones by type, and export measurement data.

### Story 8.1: Draw Measurement Zones

As a quantity surveyor,
I want to draw polygon and rectangle zones on a floor plan,
So that I can manually measure irregular spaces.

**Acceptance Criteria:**

**Given** a user on the Metré mode with an uploaded plan
**When** they draw a polygon or rectangle on the canvas
**Then** the system calculates area (m2) and perimeter (m) for the zone
**And** displays the measurements in real-time

### Story 8.2: Classify and Export Measurements

As a quantity surveyor,
I want to classify zones by surface type and export data,
So that I can produce organized measurement reports.

**Acceptance Criteria:**

**Given** drawn measurement zones
**When** the user assigns a surface type (habitable, circulation, technical, exterior)
**Then** the zone is color-coded by type and labeled

**Given** classified measurement zones
**When** the user clicks export CSV
**Then** the system exports all zone data (type, area, perimeter) as CSV (FR40)

---

## Epic 9: Session Management & Reliability

The system reliably saves and restores analysis sessions, warns users about unsaved work, and maintains stable operations under concurrent usage.

### Story 9.1: Session Save and Restore

As a construction professional,
I want the system to save my analysis session automatically,
So that I can resume my work if I close the browser accidentally.

**Acceptance Criteria:**

**Given** an active analysis session
**When** the system auto-saves session metadata to localStorage
**Then** the session can be restored within a 2-hour window (FR48)
**And** all analysis results, masks, and current step are preserved

**Given** a user with a saved session
**When** they return to FloorScan within the TTL window
**Then** they are prompted to restore or start fresh

### Story 9.2: Unsaved Work Warning and Session Stability

As a construction professional,
I want to be warned before losing unsaved work,
So that I don't accidentally lose my analysis progress.

**Acceptance Criteria:**

**Given** a user with an active analysis session
**When** they attempt to close the tab or navigate away
**Then** a beforeunload warning prompts them to confirm (FR49)

**Given** 50 concurrent backend sessions (NFR14)
**When** a new session is requested
**Then** the oldest inactive session is evicted to make room
**And** per-session threading locks ensure data isolation (NFR13)

---

*Epics and stories generated 2026-03-16 for FloorScan. All 49 functional requirements covered across 9 epics and 22 stories.*
