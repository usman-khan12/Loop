# Loop — Browser Workflow Recorder + Replayer

> Record a repetitive browser task once, then replay it automatically.

A Chrome Extension (Manifest V3) that records your browser actions as structured steps and replays them in a dedicated automation window — including cross-tab variable passing.

---

## Quick Start

### 1. Install & Build

```bash
npm install
npm run build
```

### 2. Load in Chrome

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `dist/` folder

The Loop extension will appear in your toolbar.

### 3. Test with Local Pages

```bash
node test-pages/server.js
```

Then open:
- **Spreadsheet**: `http://localhost:3456/spreadsheet.html`
- **Form**: `http://localhost:3456/form.html`

### 4. Core Proof Test

1. Open both test pages in separate tabs
2. Open the Loop side panel (click the toolbar icon)
3. Click **Start Recording**
4. On the spreadsheet page, click a row to select it
5. Click any cell to mark the email — use "🎯 Mark as Variable" → name it `email`
6. Repeat for `name` and `company`
7. Switch to the form tab
8. Fill in the form fields (they'll be recorded)
9. Click Submit
10. Click **Stop Recording**
11. Save the workflow
12. Click **Run Workflow** — a new automation window opens and executes!

---

## Architecture

```
src/
├── background/         # Service worker (orchestrator)
│   ├── index.ts        # Message hub, recording lifecycle
│   ├── tabManager.ts   # Tab/window management
│   ├── workflowEngine.ts  # Step-by-step executor
│   └── workflowBuilder.ts # Raw events → structured workflow
├── content/            # Injected into web pages
│   ├── index.ts        # Entry point, message router
│   ├── recorder.ts     # DOM event capture
│   ├── executor.ts     # Step execution + element highlight
│   ├── domUtils.ts     # CSS selector / XPath generation
│   ├── targetResolver.ts  # 4-strategy element finder
│   ├── extraction.ts   # Text/value extraction
│   └── variableMarker.ts  # "Mark as Variable" overlay
├── sidepanel/          # Main React UI
│   ├── App.tsx         # Root + state sync
│   ├── store.ts        # Zustand store
│   └── views/
│       ├── HomeView.tsx       # Workflow list + record CTA
│       ├── RecordingView.tsx  # Live event feed
│       ├── WorkflowDetail.tsx # Step review + run
│       └── RunView.tsx        # Live execution + logs
├── popup/              # Quick controls
└── shared/             # Types, utils, storage, messaging
```

## Milestones Implemented

- ✅ **M1** — Extension skeleton, design system, messaging
- ✅ **M2** — Recording engine with semantic DOM capture
- ✅ **M3** — Step-by-step executor with retry logic
- ✅ **M4** — Cross-tab variable passing
- ✅ **M5** — Dedicated automation window

## Tech Stack

- **TypeScript + React** — Extension UI
- **Vite + @crxjs/vite-plugin** — Build tooling with HMR
- **Zustand** — Side panel state
- **chrome.storage.local** — Workflow persistence
- **Manifest V3** — Modern Chrome extension standard
