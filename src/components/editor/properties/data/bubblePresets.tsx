/**
 * bubblePresets.ts
 *
 * Authentic CapCut-parity Bubble Presets catalog.
 * Covers speech bubbles, comic bursts, cute pastels, notes/paper, ribbons,
 * neon glows, and floral banners.
 */

import React from "react";
import type { TextClip } from "@/types";

export type BubbleCategory =
  | "all"
  | "speech"
  | "paper"
  | "notes"
  | "labels"
  | "decorative"
  | "comic"
  | "cute"
  | "banner"
  | "neon"
  | "floral";

export interface BubblePreset {
  id: string;
  name: string;
  category: BubbleCategory;
  tags?: string[];
  isReset?: boolean;
  textColor?: string;
  defaultTextStyle?: {
    color?: string;
    fontStyle?: "normal" | "italic";
    textDecoration?: "none" | "underline" | "line-through";
  };
  background?: {
    color: string;
    padding: number;
    borderRadius: number;
    opacity?: number;
    height?: number;
    width?: number;
    yOffset?: number;
    style?: "rectangle" | "split" | string;
    bubblePresetId?: string;
  };
  sampleText: string;
  renderPreview: (active: boolean) => React.ReactNode;
}

export const BUBBLE_CATEGORIES: Array<{ id: BubbleCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "speech", label: "Speech" },
  { id: "paper", label: "Paper" },
  { id: "labels", label: "Labels" },
  { id: "decorative", label: "Decorative" },
  { id: "comic", label: "Comic" },
  { id: "cute", label: "Cute" },
  { id: "banner", label: "Ribbon & Banner" },
  { id: "neon", label: "Neon & Glow" },
];

export const BUBBLE_PRESETS: BubblePreset[] = [
  // ── 0. None / Reset ────────────────────────────────────────────────────────
  {
    id: "none",
    name: "None",
    category: "all",
    isReset: true,
    sampleText: "",
    renderPreview: () => null,
  },

  // ── ROW 1: Torn Paper & Signature Presets (Matches CapCut Reference) ───────
  {
    id: "bubble-paper-torn",
    name: "Torn Paper",
    category: "paper",
    tags: ["paper", "torn", "grunge", "white", "strip", "caption"],
    sampleText: "Hey Man, I don't care abiut the fuck you doing",
    textColor: "#ef4444",
    defaultTextStyle: {
      color: "#ef4444",
      fontStyle: "italic",
      textDecoration: "underline",
    },
    background: {
      color: "#faf9f6",
      padding: 16,
      borderRadius: 4,
      bubblePresetId: "bubble-paper-torn",
    },
    renderPreview: () => (
      <div className="w-11 h-7 bg-[#faf9f6] text-[#ef4444] border-t border-b border-dashed border-gray-300 flex items-center justify-center px-1 shadow-sm rounded-xs [clip-path:polygon(0%_15%,5%_5%,15%_12%,25%_4%,35%_10%,45%_5%,55%_12%,65%_4%,75%_10%,85%_5%,95%_12%,100%_0%,100%_85%,95%_95%,85%_88%,75%_96%,65%_90%,55%_95%,45%_88%,35%_96%,25%_90%,15%_95%,5%_88%,0%_100%)]">
        <span className="text-[6.5px] font-sans font-bold italic underline text-center leading-tight">
          Hey Man
        </span>
      </div>
    ),
  },

  // ── ROW 1: Speech & Paper ──────────────────────────────────────────────────
  {
    id: "bubble-paper-notebook",
    name: "Lined Notebook",
    category: "notes",
    sampleText: "What a nice day",
    textColor: "#1f2937",
    background: {
      color: "#ffffff",
      padding: 12,
      borderRadius: 4,
      bubblePresetId: "bubble-paper-notebook",
    },
    renderPreview: () => (
      <div className="w-10 h-10 rounded-[3px] bg-white text-[#1f2937] p-1 shadow-xs flex flex-col justify-between border border-black/10">
        <div className="space-y-0.5">
          <div className="h-0.5 w-full bg-blue-100 rounded-full" />
          <div className="h-0.5 w-3/4 bg-blue-100 rounded-full" />
        </div>
        <span className="text-[7px] font-bold text-center leading-tight">
          What a<br />nice day
        </span>
        <div className="h-0.5 w-full bg-blue-100 rounded-full" />
      </div>
    ),
  },
  {
    id: "bubble-cloud-dotted",
    name: "Dotted Cloud",
    category: "cute",
    sampleText: "Don't worry be happy",
    textColor: "#111827",
    background: {
      color: "#ffffff",
      padding: 14,
      borderRadius: 20,
      bubblePresetId: "bubble-cloud-dotted",
    },
    renderPreview: () => (
      <div className="w-10 h-11 rounded-[16px] bg-white border-2 border-dashed border-gray-800 text-gray-900 p-1 flex flex-col items-center justify-center shadow-xs">
        <span className="text-[6.5px] font-extrabold text-center leading-tight">
          Don't<br />worry<br />happy
        </span>
      </div>
    ),
  },
  {
    id: "bubble-oval-speech",
    name: "Tall Speech Oval",
    category: "speech",
    sampleText: "I love you just the way you are",
    textColor: "#000000",
    background: {
      color: "#ffffff",
      padding: 14,
      borderRadius: 24,
      bubblePresetId: "bubble-oval-speech",
    },
    renderPreview: () => (
      <div className="relative flex flex-col items-center">
        <div className="w-9 h-11 rounded-[18px] bg-white text-black p-1 flex items-center justify-center shadow-xs border border-gray-300">
          <span className="text-[6px] font-bold text-center leading-tight">
            I love<br />you just<br />way you
          </span>
        </div>
        <div className="w-1.5 h-1.5 bg-white border-r border-b border-gray-300 rotate-45 -mt-1" />
      </div>
    ),
  },
  {
    id: "bubble-scallop-cloud",
    name: "Morning Cloud",
    category: "speech",
    sampleText: "Good Morning.",
    textColor: "#0f172a",
    background: {
      color: "#ffffff",
      padding: 14,
      borderRadius: 16,
      bubblePresetId: "bubble-scallop-cloud",
    },
    renderPreview: () => (
      <div className="w-11 h-8 rounded-[12px] bg-white border border-gray-400/60 shadow-xs flex items-center justify-center p-1 text-slate-900">
        <span className="text-[7.5px] font-black text-center">Good Morning.</span>
      </div>
    ),
  },
  {
    id: "bubble-radial-burst",
    name: "Big News",
    category: "comic",
    sampleText: "Big News !!!",
    textColor: "#000000",
    background: {
      color: "#ffffff",
      padding: 12,
      borderRadius: 20,
      bubblePresetId: "bubble-radial-burst",
    },
    renderPreview: () => (
      <div className="w-10 h-10 rounded-full bg-white border-2 border-black flex flex-col items-center justify-center p-0.5 shadow-xs">
        <span className="text-[7px] font-black tracking-tighter text-black uppercase">
          Big News<br />!!!
        </span>
      </div>
    ),
  },
  {
    id: "bubble-dots-oval",
    name: "Dotted Border Oval",
    category: "speech",
    sampleText: "Be the best you can be",
    textColor: "#000000",
    background: {
      color: "#ffffff",
      padding: 14,
      borderRadius: 20,
      bubblePresetId: "bubble-dots-oval",
    },
    renderPreview: () => (
      <div className="w-10 h-11 rounded-[16px] bg-white border-2 border-dotted border-black flex items-center justify-center p-1">
        <span className="text-[6.5px] font-bold text-black text-center leading-tight">
          Be the<br />best you<br />can be
        </span>
      </div>
    ),
  },

  // ── ROW 2: Comic Action & Torn Paper ──────────────────────────────────────
  {
    id: "bubble-comic-bam",
    name: "Comic BAM Burst",
    category: "comic",
    sampleText: "BAM!!!",
    textColor: "#000000",
    background: {
      color: "#ffffff",
      padding: 14,
      borderRadius: 8,
      bubblePresetId: "bubble-comic-bam",
    },
    renderPreview: () => (
      <div className="w-11 h-9 bg-white border-2 border-black flex items-center justify-center shadow-xs [clip-path:polygon(50%_0%,65%_25%,100%_20%,80%_50%,100%_80%,65%_75%,50%_100%,35%_75%,0%_80%,20%_50%,0%_20%,35%_25%)]">
        <span className="text-[7.5px] font-black text-black tracking-tighter">BAM!!!</span>
      </div>
    ),
  },
  {
    id: "bubble-comic-dark-hero",
    name: "Old Superheroes",
    category: "comic",
    sampleText: "Old superheroes don't just fade away",
    textColor: "#ffffff",
    background: {
      color: "#18181b",
      padding: 14,
      borderRadius: 22,
      bubblePresetId: "bubble-comic-dark-hero",
    },
    renderPreview: () => (
      <div className="w-10 h-11 rounded-[18px] bg-zinc-900 border border-zinc-700 text-white p-1 flex items-center justify-center">
        <span className="text-[6px] font-medium text-center text-zinc-200 leading-tight">
          Old<br />superheroes<br />don't fade
        </span>
      </div>
    ),
  },
  {
    id: "bubble-comic-power",
    name: "Great Responsibility",
    category: "comic",
    sampleText: "With great power comes great responsibility.",
    textColor: "#ffffff",
    background: {
      color: "#18181b",
      padding: 14,
      borderRadius: 20,
      bubblePresetId: "bubble-comic-power",
    },
    renderPreview: () => (
      <div className="w-11 h-9 rounded-[14px] bg-zinc-900 border border-zinc-700 text-white p-1 flex items-center justify-center">
        <span className="text-[5.5px] font-medium text-center text-zinc-300 leading-tight">
          With great power<br />responsibility
        </span>
      </div>
    ),
  },
  {
    id: "bubble-comic-heads",
    name: "In Our Heads",
    category: "comic",
    sampleText: "It's all in our heads",
    textColor: "#ffffff",
    background: {
      color: "#18181b",
      padding: 14,
      borderRadius: 24,
      bubblePresetId: "bubble-comic-heads",
    },
    renderPreview: () => (
      <div className="w-9 h-11 rounded-[18px] bg-zinc-900 border border-zinc-700 text-white p-1 flex items-center justify-center">
        <span className="text-[6px] font-medium text-center text-zinc-200 leading-tight">
          It's all<br />in our<br />heads
        </span>
      </div>
    ),
  },
  {
    id: "bubble-torn-beige",
    name: "Torn Paper Beige",
    category: "notes",
    sampleText: "Missing you",
    textColor: "#44403c",
    background: {
      color: "#e7e5e4",
      padding: 10,
      borderRadius: 2,
      bubblePresetId: "bubble-torn-beige",
    },
    renderPreview: () => (
      <div className="w-11 h-7 bg-[#e7e5e4] border-t border-b border-[#d6d3d1] text-[#44403c] flex items-center justify-center px-1 shadow-xs [clip-path:polygon(0%_10%,100%_0%,98%_90%,2%_100%)]">
        <span className="text-[7px] font-serif font-semibold">Missing you</span>
      </div>
    ),
  },
  {
    id: "bubble-torn-grey",
    name: "Torn Rough Kraft",
    category: "notes",
    sampleText: "You're my sweetheart",
    textColor: "#3f3f46",
    background: {
      color: "#d4d4d8",
      padding: 10,
      borderRadius: 2,
      bubblePresetId: "bubble-torn-grey",
    },
    renderPreview: () => (
      <div className="w-11 h-7 bg-[#d4d4d8] text-[#3f3f46] flex items-center justify-center px-1 shadow-xs [clip-path:polygon(2%_0%,98%_10%,100%_90%,0%_100%)]">
        <span className="text-[6.5px] font-sans font-medium text-center">sweetheart</span>
      </div>
    ),
  },
  {
    id: "bubble-coupon-sale",
    name: "Discount Ticket",
    category: "notes",
    sampleText: "SALE 20% ¥2300",
    textColor: "#09090b",
    background: {
      color: "#ffffff",
      padding: 8,
      borderRadius: 6,
      bubblePresetId: "bubble-coupon-sale",
    },
    renderPreview: () => (
      <div className="w-11 h-7 bg-white rounded-[3px] border border-gray-300 flex items-center justify-between p-0.5 text-zinc-900 shadow-xs">
        <span className="bg-yellow-400 text-[6px] font-black px-0.5 rounded-xs">20%</span>
        <span className="text-[7px] font-black">¥2300</span>
      </div>
    ),
  },

  // ── ROW 3: Pills, Badges & Ribbons ─────────────────────────────────────────
  {
    id: "bubble-sneakers-pill",
    name: "Sneakers Arrow",
    category: "banner",
    sampleText: "Sneakers ➔",
    textColor: "#ffffff",
    background: {
      color: "#18181b",
      padding: 8,
      borderRadius: 999,
      bubblePresetId: "bubble-sneakers-pill",
    },
    renderPreview: () => (
      <div className="w-11 h-5 rounded-full bg-zinc-900 border border-zinc-700 text-white flex items-center justify-between px-1.5">
        <span className="text-[6.5px] font-bold">Sneakers</span>
        <span className="text-[7px]">➔</span>
      </div>
    ),
  },
  {
    id: "bubble-pill-select-again",
    name: "Hearts Pill",
    category: "cute",
    sampleText: "Select again ♡",
    textColor: "#92400e",
    background: {
      color: "#fef3c7",
      padding: 8,
      borderRadius: 999,
      bubblePresetId: "bubble-pill-select-again",
    },
    renderPreview: () => (
      <div className="w-11 h-5 rounded-full bg-amber-100 border border-amber-300 text-amber-800 flex items-center justify-between px-1.5 shadow-xs">
        <span className="text-[6px]">♡</span>
        <span className="text-[6.5px] font-bold">Select</span>
        <span className="text-[6px]">♡</span>
      </div>
    ),
  },
  {
    id: "bubble-pill-beautiful-day",
    name: "Clean White Pill",
    category: "speech",
    sampleText: "Beautiful day",
    textColor: "#1e293b",
    background: {
      color: "#ffffff",
      padding: 8,
      borderRadius: 999,
      bubblePresetId: "bubble-pill-beautiful-day",
    },
    renderPreview: () => (
      <div className="w-11 h-5 rounded-full bg-white border border-slate-300 text-slate-800 flex items-center justify-center px-1 shadow-xs">
        <span className="text-[6.5px] font-bold">Beautiful day</span>
      </div>
    ),
  },
  {
    id: "bubble-travel-plan",
    name: "Travel Plan Tag",
    category: "notes",
    sampleText: "Travel plan",
    textColor: "#9a3412",
    background: {
      color: "#ffedd5",
      padding: 8,
      borderRadius: 6,
      bubblePresetId: "bubble-travel-plan",
    },
    renderPreview: () => (
      <div className="w-11 h-6 rounded-[4px] bg-orange-100 border border-orange-200 text-orange-800 flex flex-col items-center justify-center">
        <span className="text-[6px] font-extrabold uppercase">Travel plan</span>
        <span className="text-[5px] bg-orange-200 px-1 rounded-xs">NEXT</span>
      </div>
    ),
  },
  {
    id: "bubble-my-journey",
    name: "Cyan Journey Card",
    category: "notes",
    sampleText: "My journey",
    textColor: "#0284c7",
    background: {
      color: "#ffffff",
      padding: 10,
      borderRadius: 6,
      bubblePresetId: "bubble-my-journey",
    },
    renderPreview: () => (
      <div className="w-11 h-7 rounded-[4px] bg-white border border-sky-200 text-sky-600 flex items-center justify-center shadow-xs">
        <span className="text-[7px] font-mono font-bold">My journey</span>
      </div>
    ),
  },
  {
    id: "bubble-sunny-day-ribbon",
    name: "Sunny Day Ribbon",
    category: "banner",
    sampleText: "Sunny day",
    textColor: "#ffffff",
    background: {
      color: "#ea580c",
      padding: 8,
      borderRadius: 4,
      bubblePresetId: "bubble-sunny-day-ribbon",
    },
    renderPreview: () => (
      <div className="w-11 h-5 rounded-[2px] bg-orange-500 text-white flex items-center justify-center shadow-xs [clip-path:polygon(0%_0%,100%_0%,93%_50%,100%_100%,0%_100%,7%_50%)]">
        <span className="text-[6.5px] font-black uppercase">Sunny day</span>
      </div>
    ),
  },
  {
    id: "bubble-missing-heart",
    name: "Missing Heart Pill",
    category: "cute",
    sampleText: "Missing you ♥",
    textColor: "#0f172a",
    background: {
      color: "#ffffff",
      padding: 8,
      borderRadius: 999,
      bubblePresetId: "bubble-missing-heart",
    },
    renderPreview: () => (
      <div className="w-11 h-5 rounded-full bg-white border border-slate-300 text-slate-900 flex items-center justify-center gap-0.5 px-1 shadow-xs">
        <span className="text-[6.5px] font-bold">Missing you</span>
        <span className="text-[6px] text-red-500">♥</span>
      </div>
    ),
  },

  // ── ROW 4: Receipts, Tags, Notes & Floral ──────────────────────────────────
  {
    id: "bubble-floral-banner",
    name: "Botanical Floral",
    category: "floral",
    sampleText: "Make you feel",
    textColor: "#15803d",
    background: {
      color: "#f0fdf4",
      padding: 8,
      borderRadius: 4,
      bubblePresetId: "bubble-floral-banner",
    },
    renderPreview: () => (
      <div className="w-11 h-6 rounded-[3px] bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-between px-1">
        <span className="text-[7px]">🌿</span>
        <span className="text-[6px] font-bold italic">feel</span>
        <span className="text-[7px]">🌸</span>
      </div>
    ),
  },
  {
    id: "bubble-kraft-cardboard",
    name: "Kraft Torn Tape",
    category: "notes",
    sampleText: "Be mine lover",
    textColor: "#ffffff",
    background: {
      color: "#b45309",
      padding: 8,
      borderRadius: 4,
      bubblePresetId: "bubble-kraft-cardboard",
    },
    renderPreview: () => (
      <div className="w-11 h-6 bg-[#b45309] text-white flex items-center justify-center px-1 shadow-xs [clip-path:polygon(3%_0%,97%_5%,100%_95%,0%_100%)]">
        <span className="text-[6.5px] font-serif font-bold italic">Be mine</span>
      </div>
    ),
  },
  {
    id: "bubble-great-day-memo",
    name: "Great Day Memo",
    category: "notes",
    sampleText: "Have a great day!",
    textColor: "#0369a1",
    background: {
      color: "#e0f2fe",
      padding: 10,
      borderRadius: 4,
      bubblePresetId: "bubble-great-day-memo",
    },
    renderPreview: () => (
      <div className="w-11 h-7 rounded-[4px] bg-sky-100 border border-sky-300 text-sky-800 flex flex-col items-center justify-center p-0.5">
        <div className="w-4 h-1 bg-amber-300 rounded-xs mb-0.5" />
        <span className="text-[6px] font-bold">great day!</span>
      </div>
    ),
  },
  {
    id: "bubble-receipt-list",
    name: "Shopping Receipt",
    category: "notes",
    sampleText: "egg milk bread...",
    textColor: "#1e293b",
    background: {
      color: "#ffffff",
      padding: 10,
      borderRadius: 4,
      bubblePresetId: "bubble-receipt-list",
    },
    renderPreview: () => (
      <div className="w-10 h-11 bg-white border border-gray-300 text-slate-800 p-1 flex flex-col justify-between shadow-xs">
        <span className="text-[5.5px] font-mono font-bold text-center border-b border-gray-200">LIST</span>
        <div className="text-[5px] font-mono leading-[5px] space-y-0.5">
          <div>• egg</div>
          <div>• milk</div>
          <div>• bread</div>
        </div>
        <div className="h-1 bg-black/80 w-full" />
      </div>
    ),
  },
  {
    id: "bubble-skirt-tag",
    name: "Pink Price Tag",
    category: "banner",
    sampleText: "Skirt",
    textColor: "#ffffff",
    background: {
      color: "#ec4899",
      padding: 8,
      borderRadius: 6,
      bubblePresetId: "bubble-skirt-tag",
    },
    renderPreview: () => (
      <div className="w-9 h-11 rounded-[6px] bg-pink-500 text-white flex flex-col items-center justify-between p-1 shadow-xs [clip-path:polygon(30%_0%,70%_0%,100%_20%,100%_100%,0%_100%,0%_20%)]">
        <div className="w-1.5 h-1.5 rounded-full bg-white mt-0.5" />
        <span className="text-[7px] font-black uppercase">Skirt</span>
        <div className="h-1 bg-white/70 w-full" />
      </div>
    ),
  },
  {
    id: "bubble-binder-study",
    name: "Study Binder",
    category: "notes",
    sampleText: "Learning Dating Cooking",
    textColor: "#b45309",
    background: {
      color: "#fef9c3",
      padding: 10,
      borderRadius: 6,
      bubblePresetId: "bubble-binder-study",
    },
    renderPreview: () => (
      <div className="w-10 h-11 rounded-[4px] bg-amber-50 border border-amber-300 text-amber-800 p-1 flex flex-col justify-between shadow-xs">
        <div className="flex gap-1 justify-center">
          <div className="w-1 h-1 rounded-full bg-amber-400" />
          <div className="w-1 h-1 rounded-full bg-amber-400" />
        </div>
        <span className="text-[6px] font-bold text-center leading-tight">Study<br />Notes</span>
        <div className="h-0.5 w-full bg-amber-200" />
      </div>
    ),
  },
  {
    id: "bubble-note-coral",
    name: "Coral Note",
    category: "notes",
    sampleText: "NOTE: Please enter content",
    textColor: "#ffffff",
    background: {
      color: "#f87171",
      padding: 10,
      borderRadius: 6,
      bubblePresetId: "bubble-note-coral",
    },
    renderPreview: () => (
      <div className="w-11 h-8 rounded-[4px] bg-red-400 text-white p-1 flex flex-col justify-between shadow-xs">
        <span className="text-[6.5px] font-black italic">NOTE:</span>
        <span className="text-[5.5px] leading-tight">Please enter...</span>
      </div>
    ),
  },

  // ── ROW 5: Happy Clouds, 3D & Neon ─────────────────────────────────────────
  {
    id: "bubble-yellow-note-scallop",
    name: "Yellow Cloud Note",
    category: "notes",
    sampleText: "NOTE: Please enter content",
    textColor: "#78350f",
    background: {
      color: "#fde047",
      padding: 10,
      borderRadius: 14,
      bubblePresetId: "bubble-yellow-note-scallop",
    },
    renderPreview: () => (
      <div className="w-11 h-8 rounded-[12px] bg-yellow-300 text-yellow-900 p-1 flex flex-col justify-center items-center shadow-xs">
        <span className="text-[6.5px] font-black">NOTE</span>
        <span className="text-[5px]">enter content</span>
      </div>
    ),
  },
  {
    id: "bubble-cloud-happy-blue",
    name: "Happy Blue Cloud",
    category: "cute",
    sampleText: "HAPPY",
    textColor: "#ffffff",
    background: {
      color: "#0ea5e9",
      padding: 12,
      borderRadius: 20,
      bubblePresetId: "bubble-cloud-happy-blue",
    },
    renderPreview: () => (
      <div className="relative flex flex-col items-center">
        <div className="w-11 h-8 rounded-[14px] bg-sky-500 text-white flex items-center justify-center shadow-xs border-2 border-white/40">
          <span className="text-[8px] font-black tracking-wider">HAPPU</span>
        </div>
        <div className="absolute -top-1 -right-0.5 flex gap-0.5">
          <div className="w-1 h-1 rounded-full bg-sky-300" />
          <div className="w-1.5 h-1.5 rounded-full bg-sky-400" />
        </div>
      </div>
    ),
  },
  {
    id: "bubble-burst-wow-yellow",
    name: "Yellow Starburst Wow",
    category: "comic",
    sampleText: "Wow",
    textColor: "#ffffff",
    background: {
      color: "#eab308",
      padding: 12,
      borderRadius: 8,
      bubblePresetId: "bubble-burst-wow-yellow",
    },
    renderPreview: () => (
      <div className="w-11 h-9 bg-yellow-400 border-2 border-amber-600 flex items-center justify-center shadow-xs [clip-path:polygon(50%_0%,65%_25%,100%_20%,80%_50%,100%_80%,65%_75%,50%_100%,35%_75%,0%_80%,20%_50%,0%_20%,35%_25%)]">
        <span className="text-[8px] font-black text-amber-950 italic">Wow</span>
      </div>
    ),
  },
  {
    id: "bubble-3d-purple",
    name: "3D Purple Capsule",
    category: "speech",
    sampleText: "Your Words",
    textColor: "#ffffff",
    background: {
      color: "#9333ea",
      padding: 10,
      borderRadius: 16,
      bubblePresetId: "bubble-3d-purple",
    },
    renderPreview: () => (
      <div className="w-11 h-7 rounded-[10px] bg-purple-600 border-b-2 border-purple-900 text-white flex items-center justify-center shadow-xs">
        <span className="text-[7px] font-extrabold">Your Words</span>
      </div>
    ),
  },
  {
    id: "bubble-angled-shoes",
    name: "Shoes Tag",
    category: "banner",
    sampleText: "Shoes",
    textColor: "#1f2937",
    background: {
      color: "#ffffff",
      padding: 8,
      borderRadius: 4,
      bubblePresetId: "bubble-angled-shoes",
    },
    renderPreview: () => (
      <div className="w-11 h-7 bg-white border border-gray-400 flex items-center justify-between px-1 text-gray-900 [clip-path:polygon(10%_0%,100%_0%,90%_100%,0%_100%)]">
        <span className="text-[7px] text-yellow-500 font-bold">➔</span>
        <span className="text-[7px] font-serif italic font-bold">Shoes</span>
      </div>
    ),
  },
  {
    id: "bubble-lovely-blue",
    name: "Lovely Blue Cloud",
    category: "cute",
    sampleText: "lovely",
    textColor: "#ffffff",
    background: {
      color: "#2563eb",
      padding: 12,
      borderRadius: 20,
      bubblePresetId: "bubble-lovely-blue",
    },
    renderPreview: () => (
      <div className="w-11 h-8 rounded-[14px] bg-blue-600 border border-blue-400 text-white flex items-center justify-center shadow-xs">
        <span className="text-[7.5px] font-black italic">lovely</span>
      </div>
    ),
  },
  {
    id: "bubble-neon-pink-heart",
    name: "Neon Pink Heart",
    category: "neon",
    sampleText: "lovely",
    textColor: "#f43f5e",
    background: {
      color: "#18181b",
      padding: 12,
      borderRadius: 20,
      bubblePresetId: "bubble-neon-pink-heart",
    },
    renderPreview: () => (
      <div className="w-11 h-8 rounded-[12px] bg-zinc-950 border border-pink-500 shadow-[0_0_8px_rgba(236,72,153,0.6)] text-pink-400 flex items-center justify-center">
        <span className="text-[7px] font-serif italic tracking-wide">lovely</span>
      </div>
    ),
  },

  // ── ROW 6: Neon Signs & Pastel Comic ───────────────────────────────────────
  {
    id: "bubble-comic-pastel-wow",
    name: "Pastel Comic Wow",
    category: "comic",
    sampleText: "Wow",
    textColor: "#ffffff",
    background: {
      color: "#6366f1",
      padding: 12,
      borderRadius: 12,
      bubblePresetId: "bubble-comic-pastel-wow",
    },
    renderPreview: () => (
      <div className="w-11 h-8 rounded-[10px] bg-indigo-500 border border-indigo-300 text-white flex items-center justify-center shadow-xs">
        <span className="text-[8px] font-black">Wow</span>
      </div>
    ),
  },
  {
    id: "bubble-cloud-cute-peach",
    name: "Cute Peach Cloud",
    category: "cute",
    sampleText: "Cute",
    textColor: "#e11d48",
    background: {
      color: "#ffe4e6",
      padding: 12,
      borderRadius: 16,
      bubblePresetId: "bubble-cloud-cute-peach",
    },
    renderPreview: () => (
      <div className="w-11 h-8 rounded-[14px] bg-rose-100 border border-rose-300 text-rose-600 flex items-center justify-center shadow-xs">
        <span className="text-[7.5px] font-black">Cute</span>
      </div>
    ),
  },
  {
    id: "bubble-neon-forward-arrow",
    name: "Neon Forward Arrow",
    category: "neon",
    sampleText: "FORWARD ➔",
    textColor: "#22d3ee",
    background: {
      color: "#0f172a",
      padding: 8,
      borderRadius: 6,
      bubblePresetId: "bubble-neon-forward-arrow",
    },
    renderPreview: () => (
      <div className="w-11 h-6 rounded-[4px] bg-slate-950 border border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.5)] flex items-center justify-center px-1">
        <span className="text-[6px] font-mono font-black">FORWARD ➔</span>
      </div>
    ),
  },
  {
    id: "bubble-neon-oops-purple",
    name: "Neon OOPS!",
    category: "neon",
    sampleText: "OOPS!",
    textColor: "#e879f9",
    background: {
      color: "#18181b",
      padding: 10,
      borderRadius: 12,
      bubblePresetId: "bubble-neon-oops-purple",
    },
    renderPreview: () => (
      <div className="w-11 h-7 rounded-[8px] bg-zinc-950 border border-fuchsia-500 text-fuchsia-300 shadow-[0_0_8px_rgba(217,70,239,0.5)] flex items-center justify-center">
        <span className="text-[7px] font-black">OOPS!</span>
      </div>
    ),
  },
  {
    id: "bubble-neon-hello-pink",
    name: "Neon Hello",
    category: "neon",
    sampleText: "HELLO",
    textColor: "#f43f5e",
    background: {
      color: "#18181b",
      padding: 12,
      borderRadius: 999,
      bubblePresetId: "bubble-neon-hello-pink",
    },
    renderPreview: () => (
      <div className="w-9 h-9 rounded-full bg-zinc-950 border-2 border-rose-500 text-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.5)] flex items-center justify-center">
        <span className="text-[6.5px] font-black">HELLO</span>
      </div>
    ),
  },
  {
    id: "bubble-neon-what-burst",
    name: "Neon WHAT Burst",
    category: "neon",
    sampleText: "WHAT",
    textColor: "#38bdf8",
    background: {
      color: "#082f49",
      padding: 12,
      borderRadius: 8,
      bubblePresetId: "bubble-neon-what-burst",
    },
    renderPreview: () => (
      <div className="w-11 h-8 rounded-[6px] bg-sky-950 border border-sky-400 text-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.5)] flex items-center justify-center">
        <span className="text-[7.5px] font-black">WHAT</span>
      </div>
    ),
  },
  {
    id: "bubble-brush-happy-pastel",
    name: "Watercolor Brush",
    category: "floral",
    sampleText: "HAPPY",
    textColor: "#ec4899",
    background: {
      color: "#fce7f3",
      padding: 8,
      borderRadius: 6,
      bubblePresetId: "bubble-brush-happy-pastel",
    },
    renderPreview: () => (
      <div className="w-11 h-6 rounded-[3px] bg-pink-100 border border-pink-200 text-pink-600 flex items-center justify-center shadow-xs">
        <span className="text-[7px] font-black tracking-widest">HAPPY</span>
      </div>
    ),
  },
];

export function isBubblePresetActive(
  preset: BubblePreset,
  clip: TextClip,
): boolean {
  if (preset.isReset) {
    return (
      !clip.background ||
      (clip.background as any).bubblePresetId === undefined ||
      (clip.background as any).bubblePresetId === "none"
    );
  }
  return (clip.background as any)?.bubblePresetId === preset.id;
}
