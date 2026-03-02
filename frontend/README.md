# FloorScan — AI Floor Plan Analysis SaaS

A production-style Next.js SaaS application for analyzing construction floor plans using AI. Detects doors, windows, walls, and surfaces automatically, with manual correction and export capabilities.

## ✨ Features

- **AI Detection**: Integrates with Roboflow serverless API (auto-fallback to mock mode)
- **Interactive Demo**: 5-step wizard (Upload → Crop → Detect → Correct → Export)
- **Secure Architecture**: API key never exposed to browser
- **Exports**: Annotated PDF (via `pdf-lib`) + Excel/CSV
- **Modern UI**: Dark SaaS design with Framer Motion animations

---

## 🚀 Quick Start

### 1. Install dependencies

```bash
npm install
# or
yarn install
# or
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Optional — without this, app uses MOCK mode automatically
ROBOFLOW_API_KEY=your_roboflow_api_key
ROBOFLOW_MODEL_ID=cubicasa5k-2-qpmsa-1gd2e/1
```

> ⚠️ **NEVER commit `.env.local` to version control!**

### 3. Run development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 🔐 Security Architecture

```
Browser                   Next.js Server              Roboflow
  |                            |                          |
  |  POST /api/infer           |                          |
  |  { imageBase64, dims }  →  |                          |
  |                            |  POST /serverless/model  |
  |                            |  ?api_key=SECRET       → |
  |                            |                       ←  |
  |  ← { detections, mode }    |                          |
```

**Key principle**: The Roboflow API key only exists in `process.env.ROBOFLOW_API_KEY` on the server. The client **never** has access to it.

### Mock Mode

If `ROBOFLOW_API_KEY` is not set (or set to the placeholder value), the `/api/infer` route automatically returns realistic mock detections. This is ideal for:
- Local development without credentials
- Demos and presentations
- Testing the UI flow

---

## 📁 Project Structure

```
floorscan/
├── app/
│   ├── api/
│   │   └── infer/
│   │       └── route.ts          # Server-side inference endpoint
│   ├── demo/
│   │   ├── page.tsx              # Demo page (metadata)
│   │   └── demo-client.tsx       # Demo orchestrator (client)
│   ├── globals.css               # Global styles
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Landing page
├── components/
│   ├── demo/
│   │   ├── stepper.tsx           # Step progress indicator
│   │   ├── upload-step.tsx       # Step 1: File upload
│   │   ├── crop-step.tsx         # Step 2: Interactive crop
│   │   ├── detect-step.tsx       # Step 3: AI detection overlay
│   │   ├── correct-step.tsx      # Step 4: Editable table
│   │   └── export-step.tsx       # Step 5: Export options
│   ├── landing/
│   │   ├── navbar.tsx            # Sticky navigation
│   │   ├── hero-section.tsx      # Hero with floor plan preview
│   │   ├── features-section.tsx  # 6 feature cards
│   │   ├── how-it-works.tsx      # 5-step process
│   │   ├── use-cases.tsx         # Target audiences
│   │   ├── security-section.tsx  # Security architecture
│   │   └── footer.tsx            # Footer
│   └── ui/
│       ├── button.tsx            # Button component
│       ├── toast.tsx             # Toast primitives
│       ├── toaster.tsx           # Toast container
│       └── use-toast.ts          # Toast hook
├── lib/
│   ├── types.ts                  # TypeScript types
│   ├── utils.ts                  # Utils, exports, helpers
│   └── mock-data.ts              # Realistic mock detections
├── .env.example
├── next.config.js
├── tailwind.config.ts
└── tsconfig.json
```

---

## 🔌 API Reference

### `POST /api/infer`

Analyzes a floor plan image. **API key is never sent to the client.**

**Request body:**
```json
{
  "imageBase64": "base64_encoded_image_optional",
  "imageWidth": 800,
  "imageHeight": 600
}
```

**Response:**
```json
{
  "detections": [
    {
      "id": "det_1_abc12",
      "type": "door",
      "bbox": { "x": 120, "y": 200, "width": 55, "height": 80 },
      "confidence": 0.94,
      "area": 1.85
    }
  ],
  "mode": "mock",
  "image_width": 800,
  "image_height": 600
}
```

**Detection types**: `"door" | "window" | "wall" | "surface"`

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | TailwindCSS |
| Animations | Framer Motion |
| UI Primitives | Radix UI |
| Icons | Lucide React |
| PDF Export | pdf-lib |
| AI Backend | Roboflow Serverless |
| Fonts | Syne + DM Sans |

---

## 🏗 Extending

### Add a real PDF parser

Install `pdfjs-dist` for proper PDF rendering:
```bash
npm install pdfjs-dist
```

Then use the Canvas API to render PDF pages to images before sending to inference.

### Connect to the Python backend

The original FastAPI backend (`floorscan/backend/`) provides advanced features like:
- SAM segmentation
- Mask editing
- Advanced PDF report generation

Update `/api/infer/route.ts` to proxy to `http://localhost:8000` instead of Roboflow directly.

### Add persistence

Replace in-memory state with a database (Postgres + Prisma recommended) to persist sessions across page refreshes.

---

## 📦 Production Deployment

### Vercel (recommended)

```bash
npx vercel deploy
```

Set environment variables in Vercel dashboard:
- `ROBOFLOW_API_KEY`
- `ROBOFLOW_MODEL_ID`

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci && npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

---

## 📄 License

MIT — use freely for commercial and personal projects.
