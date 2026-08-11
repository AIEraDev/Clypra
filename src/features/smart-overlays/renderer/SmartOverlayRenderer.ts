import type { SmartOverlayClip } from "@/types/smartOverlay";

export class SmartOverlayRenderer {
  private clip: SmartOverlayClip;

  constructor(clip: SmartOverlayClip) {
    this.clip = clip;
  }

  public updateClip(clip: SmartOverlayClip) {
    this.clip = clip;
  }

  /**
   * Universal rendering entry point for drawing any Smart Overlay type on 2D canvas context.
   */
  public draw(
    ctx: CanvasRenderingContext2D,
    relativeTime: number,
    canvasWidth: number,
    canvasHeight: number
  ) {
    if (!this.clip || !this.clip.content) return;

    ctx.save();

    const type = this.clip.overlayType;
    const content = this.clip.content;

    switch (type) {
      case "stat":
        if (content.type === "stat") {
          this.drawStatCard(ctx, relativeTime, canvasWidth, canvasHeight, content.data);
        }
        break;
      case "quote":
        if (content.type === "quote") {
          this.drawQuoteCard(ctx, relativeTime, canvasWidth, canvasHeight, content.data);
        }
        break;
      case "comparison":
        if (content.type === "comparison") {
          this.drawComparisonCard(ctx, relativeTime, canvasWidth, canvasHeight, content.data);
        }
        break;
      case "code":
        if (content.type === "code") {
          this.drawCodeCard(ctx, relativeTime, canvasWidth, canvasHeight, content.data);
        }
        break;
      case "list":
        if (content.type === "list") {
          this.drawListCard(ctx, relativeTime, canvasWidth, canvasHeight, content.data);
        }
        break;
      case "timeline":
        if (content.type === "timeline") {
          this.drawTimelineCard(ctx, relativeTime, canvasWidth, canvasHeight, content.data);
        }
        break;
      case "social":
        if (content.type === "social") {
          this.drawSocialCard(ctx, relativeTime, canvasWidth, canvasHeight, content.data);
        }
        break;
      case "lower-third":
        if (content.type === "lower-third") {
          this.drawLowerThirdCard(ctx, relativeTime, canvasWidth, canvasHeight, content.data);
        }
        break;
    }

    ctx.restore();
  }

  // --- STAT CARD RENDERER ---
  private drawStatCard(
    ctx: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    data: { value: string; label: string; delta?: string }
  ) {
    const style = this.clip.style;
    const progress = Math.min(1, Math.max(0, t / 0.35));
    const scale = 0.85 + progress * 0.15;

    const cardW = Math.min(620, w * 0.75);
    const cardH = 240;
    const x = (w - cardW) / 2;
    const y = (h - cardH) / 2;

    ctx.globalAlpha = style.cardOpacity * progress;
    ctx.fillStyle = style.cardBackgroundColor;
    this.drawRoundedRect(ctx, x, y, cardW, cardH, 20);
    ctx.fill();

    if (style.cardBorderColor) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = style.cardBorderColor;
      ctx.stroke();
    }

    // Big Value Text
    ctx.fillStyle = style.highlightColor;
    ctx.font = `bold ${Math.round(72 * scale)}px ${style.fontFamily}, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(data.value, w / 2, y + 80);

    // Label Subtitle
    ctx.fillStyle = style.textColor;
    ctx.font = `semibold 22px ${style.fontFamily}, sans-serif`;
    ctx.fillText(data.label, w / 2, y + 155);

    // Delta badge
    if (data.delta) {
      ctx.fillStyle = style.highlightColor;
      ctx.globalAlpha = 0.2 * progress;
      this.drawRoundedRect(ctx, w / 2 - 60, y + 185, 120, 30, 15);
      ctx.fill();
      ctx.globalAlpha = progress;

      ctx.fillStyle = style.highlightColor;
      ctx.font = `bold 13px ${style.fontFamily}, sans-serif`;
      ctx.fillText(data.delta, w / 2, y + 200);
    }
  }

  // --- QUOTE CARD RENDERER ---
  private drawQuoteCard(
    ctx: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    data: { quote: string; author: string; title?: string }
  ) {
    const style = this.clip.style;
    const progress = Math.min(1, Math.max(0, t / 0.4));

    const cardW = Math.min(740, w * 0.85);
    const cardH = 260;
    const x = (w - cardW) / 2;
    const y = (h - cardH) / 2;

    ctx.globalAlpha = style.cardOpacity * progress;
    ctx.fillStyle = style.cardBackgroundColor;
    this.drawRoundedRect(ctx, x, y, cardW, cardH, 20);
    ctx.fill();

    if (style.cardBorderColor) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = style.cardBorderColor;
      ctx.stroke();
    }

    // Large Quotation Mark Badge
    ctx.fillStyle = style.highlightColor;
    ctx.font = `bold 80px ${style.fontFamily}, serif`;
    ctx.textAlign = "left";
    ctx.fillText("“", x + 35, y + 80);

    // Quote Text
    ctx.fillStyle = style.textColor;
    ctx.font = `italic 24px ${style.fontFamily}, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    this.wrapText(ctx, `"${data.quote}"`, x + 90, y + 45, cardW - 130, 34);

    // Author Line
    ctx.fillStyle = style.highlightColor;
    ctx.font = `bold 18px ${style.fontFamily}, sans-serif`;
    ctx.fillText(`— ${data.author}`, x + 90, y + cardH - 60);

    if (data.title) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.font = `14px ${style.fontFamily}, sans-serif`;
      ctx.fillText(data.title, x + 90, y + cardH - 36);
    }
  }

  // --- COMPARISON CARD RENDERER ---
  private drawComparisonCard(
    ctx: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    data: { title: string; left: any; right: any }
  ) {
    const style = this.clip.style;
    const progress = Math.min(1, Math.max(0, t / 0.35));

    const cardW = Math.min(840, w * 0.9);
    const cardH = 340;
    const x = (w - cardW) / 2;
    const y = (h - cardH) / 2;

    ctx.globalAlpha = style.cardOpacity * progress;
    ctx.fillStyle = style.cardBackgroundColor;
    this.drawRoundedRect(ctx, x, y, cardW, cardH, 20);
    ctx.fill();

    // Title Header
    ctx.fillStyle = style.textColor;
    ctx.font = `bold 22px ${style.fontFamily}, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(data.title.toUpperCase(), w / 2, y + 40);

    const colW = (cardW - 80) / 2;

    // Left Column
    ctx.fillStyle = data.left.color || "#EF4444";
    ctx.font = `bold 20px ${style.fontFamily}, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(data.left.title, x + 40 + colW / 2, y + 95);

    // Right Column
    ctx.fillStyle = data.right.color || "#10B981";
    ctx.font = `bold 20px ${style.fontFamily}, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(data.right.title, x + 40 + colW + 40 + colW / 2, y + 95);

    // Divider Line
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 2;
    ctx.moveTo(w / 2, y + 75);
    ctx.lineTo(w / 2, y + cardH - 30);
    ctx.stroke();
  }

  // --- CODE CARD RENDERER ---
  private drawCodeCard(
    ctx: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    data: { title?: string; language: string; code: string }
  ) {
    const style = this.clip.style;
    const progress = Math.min(1, Math.max(0, t / 0.3));

    const cardW = Math.min(760, w * 0.85);
    const cardH = 280;
    const x = (w - cardW) / 2;
    const y = (h - cardH) / 2;

    ctx.globalAlpha = style.cardOpacity * progress;
    ctx.fillStyle = style.cardBackgroundColor;
    this.drawRoundedRect(ctx, x, y, cardW, cardH, 16);
    ctx.fill();

    // IDE Header Buttons (Red, Yellow, Green)
    const btnY = y + 22;
    const colors = ["#FF5F56", "#FFBD2E", "#27C93F"];
    colors.forEach((c, idx) => {
      ctx.beginPath();
      ctx.arc(x + 24 + idx * 20, btnY, 6, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    });

    // Window Title
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = `13px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(data.title || `${data.language}.sh`, w / 2, btnY);

    // Code lines typewriter
    const lines = data.code.split("\n");
    const lineH = 28;
    const startY = y + 65;

    lines.forEach((line, idx) => {
      ctx.fillStyle = style.textColor;
      ctx.font = `16px monospace`;
      ctx.textAlign = "left";

      // Line number
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.fillText(`${idx + 1}`.padStart(2, " "), x + 24, startY + idx * lineH);

      // Code text
      ctx.fillStyle = style.textColor;
      ctx.fillText(line, x + 60, startY + idx * lineH);
    });
  }

  // --- LIST CARD RENDERER ---
  private drawListCard(
    ctx: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    data: { title: string; items: any[] }
  ) {
    const style = this.clip.style;
    const cardW = Math.min(760, w * 0.85);
    const cardH = Math.min(680, h * 0.75);
    const x = (w - cardW) / 2;
    const y = (h - cardH) / 2;

    ctx.globalAlpha = style.cardOpacity;
    ctx.fillStyle = style.cardBackgroundColor;
    this.drawRoundedRect(ctx, x, y, cardW, cardH, 16);
    ctx.fill();

    ctx.fillStyle = style.textColor;
    ctx.font = `bold 26px ${style.fontFamily}, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(data.title.toUpperCase(), x + 32, y + 45);

    data.items.forEach((item, idx) => {
      const itemY = y + 90 + idx * 55;
      const isActive = t >= item.startTime && t <= item.endTime + 0.5;

      ctx.fillStyle = isActive ? style.highlightColor : style.textColor;
      ctx.font = `${isActive ? "bold" : "normal"} 22px ${style.fontFamily}, sans-serif`;
      ctx.fillText(`${idx + 1}. ${item.text}`, x + 32, itemY);
    });
  }

  // --- TIMELINE CARD RENDERER ---
  private drawTimelineCard(
    ctx: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    data: { title: string; nodes: any[] }
  ) {
    const style = this.clip.style;
    const cardW = w - 80;
    const cardH = 180;
    const x = 40;
    const y = h - cardH - 40;

    ctx.globalAlpha = style.cardOpacity;
    ctx.fillStyle = style.cardBackgroundColor;
    this.drawRoundedRect(ctx, x, y, cardW, cardH, 16);
    ctx.fill();

    ctx.fillStyle = style.textColor;
    ctx.font = `bold 20px ${style.fontFamily}, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(data.title, x + 30, y + 35);
  }

  // --- SOCIAL CARD RENDERER ---
  private drawSocialCard(
    ctx: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    data: { name: string; handle: string; message?: string }
  ) {
    const style = this.clip.style;
    const cardW = 580;
    const cardH = 200;
    const x = (w - cardW) / 2;
    const y = (h - cardH) / 2;

    ctx.globalAlpha = style.cardOpacity;
    ctx.fillStyle = style.cardBackgroundColor;
    this.drawRoundedRect(ctx, x, y, cardW, cardH, 16);
    ctx.fill();

    ctx.fillStyle = style.textColor;
    ctx.font = `bold 22px ${style.fontFamily}, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(data.name, x + 30, y + 45);
    ctx.fillStyle = style.highlightColor;
    ctx.font = `16px ${style.fontFamily}, sans-serif`;
    ctx.fillText(data.handle, x + 30, y + 72);
  }

  // --- LOWER THIRD CARD RENDERER ---
  private drawLowerThirdCard(
    ctx: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    data: { name: string; title: string }
  ) {
    const style = this.clip.style;
    const cardW = 480;
    const cardH = 100;
    const x = 50;
    const y = h - cardH - 50;

    ctx.globalAlpha = style.cardOpacity;
    ctx.fillStyle = style.cardBackgroundColor;
    this.drawRoundedRect(ctx, x, y, cardW, cardH, 12);
    ctx.fill();

    ctx.fillStyle = style.highlightColor;
    ctx.font = `bold 24px ${style.fontFamily}, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(data.name, x + 24, y + 42);

    ctx.fillStyle = style.textColor;
    ctx.font = `16px ${style.fontFamily}, sans-serif`;
    ctx.fillText(data.title, x + 24, y + 72);
  }

  private drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number
  ) {
    const words = text.split(" ");
    let line = "";
    let currentY = y;

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + " ";
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        ctx.fillText(line, x, currentY);
        line = words[n] + " ";
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
  }
}
