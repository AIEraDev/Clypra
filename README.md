# Clypra

<div align="center">

![Clypra Showcase Banner](public/clypra.jpg)

**Professional video editing—free and open source forever.**

A modern video editor built on Tauri v2, React 19, and Rust with hardware-accelerated processing across desktop and mobile.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md) [![GitHub issues](https://img.shields.io/github/issues/AIEraDev/clypra)](https://github.com/AIEraDev/clypra/issues) [![GitHub stars](https://img.shields.io/github/stars/AIEraDev/clypra)](https://github.com/AIEraDev/clypra/stargazers) [![GitHub Sponsors](https://img.shields.io/github/sponsors/AIEraDev?label=Sponsors&logo=githubsponsors&color=EA4AAA)](SPONSORS.md)

[Features](#key-features) • [Architecture](#architecture) • [⚡ Performance Telemetry](#-production-performance-telemetry--privacy) • [Installation](#installation) • [Development](#development) • [Contributing](CONTRIBUTING.md)

</div>

---

## Overview

Clypra is a **free, open-source video editor** (MIT License) with professional-grade features. Everything is 100% free and open source—no watermarks, no paywalls, no feature limits, and no subscriptions required.

### Supported Platforms

- **Desktop**: macOS (Apple Silicon & Intel), Windows 10/11, Linux
- **Mobile**: iOS & Android (via Capacitor)

---

## Key Features

- 🎬 **Multi-Track Timeline & Editing** — Frame-accurate trimming, multi-layer track arrangement, and complete undo/redo history.
- ⚡ **Hardware-Accelerated Engine** — Sub-10ms decoding latency powered by native Rust, GPU decoding (VideoToolbox, D3D11VA, VAAPI), and FFmpeg.
- 🎵 **High-Fidelity Audio & Waveforms** — Real-time peak + RMS waveform rendering, frame-accurate AV sync, and clip volume controls.
- 🎨 **Text & Visual Compositing** — Custom text styling, animated overlays, filters, and real-time canvas previews.
- 📦 **Multi-Format Import & Export** — Support for MP4, MOV, WebM, MKV, MP3, WAV, PNG, and high-quality ProRes/H.264 export.
- 🛡️ **Zero-Overhead Performance Telemetry** — Production-only frame timing analysis to optimize driver compatibility and cross-OS rendering with zero PII.

---

## ⚡ Production Performance Telemetry & Privacy

To ensure stutter-free 60 FPS playback and diagnose edge-case GPU driver regressions across diverse hardware configurations, Clypra includes a lightweight, non-blocking telemetry collector:

- **What We Collect**: High-level numerical timings (decode $\mu$s, compose $\mu$s, P95 seek latency, dropped frame counts, OS family, and GPU vendor/model).
- **Strict Privacy (Zero PII)**: Zero video frames, media assets, project titles, file paths, or personal user identities are ever accessed or sent.
- **Adaptive Sampling**: Smooth 60 FPS playback is sampled at 1%, while dropped frames ($>5\%$) and driver fallbacks are captured at 100% to isolate regressions without impacting playback frame pacing.
- **Analysis Hub**: Aggregated performance metrics are analyzed by engineers in the [Clypra Studio Admin Console](https://github.com/AIEraDev/clypra-studio) (`/studio/admin`).

For technical details, see the [Performance Telemetry Specification](docs/performance-telemetry.md).

---

## Architecture

Clypra is built with a native Rust/Tauri v2 core for hardware video operations, coupled with a React 19 frontend.

```
┌────────────────────────────────────────────────────────────┐
│                    Frontend (React/TS)                     │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐  │
│  │  Timeline UI │  │ Preview Canvas│  │ Filmstrip Cache │  │
│  └──────┬───────┘  └──────┬────────┘  └────────┬────────┘  │
│         └─────────────────┴────────────────────┘           │
│                           │                                │
│                    Tauri IPC Layer                         │
└───────────────────────────┼────────────────────────────────┘
                            │
┌───────────────────────────┼────────────────────────────────┐
│                  Backend (Rust/FFmpeg)                     │
│         ┌─────────────────┴──────────────────┐             │
│         │     Decoder Pool (LRU Cache)       │             │
│         │  (VideoToolbox / D3D11VA / VAAPI)  │             │
│         └─────────────┬────────────────────┬─┘             │
│         ┌─────────────▼────────┐  ┌────────▼──────────┐    │
│         │  Frame Decoder       │  │  Export Pipeline  │    │
│         └──────────────────────┘  └───────────────────┘    │
└────────────────────────────────────────────────────────────┘
```

For performance benchmarks and technical deep-dives, see the
[Clypra Runtime Performance Architecture](docs/clypra-runtime-performance-architecture.md),
[Native Performance Contract](docs/performance-contract.md), the
[Performance Telemetry Specification](docs/performance-telemetry.md), and the
[Program Preview Performance Runbook](docs/program-preview-performance-runbook.md).

---

## Installation

Download pre-built binaries from [Latest Releases](https://github.com/AIEraDev/Clypra/releases/latest).

- **macOS (Homebrew)**: `brew install AIEraDev/tap/clypra` or download `Clypra-universal.dmg`.
- **Windows**: Download and run `Clypra-x64.msi`.
- **Linux**: Download `Clypra-x86_64.AppImage` (`chmod +x` and run).

---

## Development

### Prerequisites

- Node.js 18+ & npm
- Rust 1.70+ (`rustup`)
- FFmpeg 6.0+ with development headers

### Quick Start

```bash
# Clone repository
git clone https://github.com/AIEraDev/clypra.git
cd clypra

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env

# Run development mode
npm run tauri dev
```

### Repository Structure

- `src/` — React 19 + TypeScript frontend (UI, timeline, canvas renderer, Zustand state).
- `src-tauri/` — Native Rust backend (FFmpeg decoder pool, hardware acceleration, Tauri IPC commands).

### Scripts & Testing

```bash
npm test                 # Run frontend tests
cd src-tauri && cargo test # Run Rust backend tests
npx tsc --noEmit         # Type check
npm run format           # Format codebase
```

---

## Contributing & License

- **Contributing**: Contributions are welcome! Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for guidelines and code standards.
- **License**: Clypra is open source under the [MIT License](./LICENSE). FFmpeg dependencies are licensed under LGPL v2.1+.
- **Sponsorship**: Help sustain Clypra by sponsoring on [GitHub Sponsors](https://github.com/sponsors/AIEraDev) or reading [`SPONSORS.md`](./SPONSORS.md).
