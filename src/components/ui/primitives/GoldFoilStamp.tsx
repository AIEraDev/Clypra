import React, { useEffect, useRef } from "react";

interface GoldFoilProps {
  text?: string;
  fontSize?: number;
  letterSpacing?: number;
  goldTone?: string;
  foilContrast?: number;
  debossDepth?: number;
  bevelHighlight?: number;
  bgColor?: string;
  paperTexture?: number;
}

export const GoldFoilStamp: React.FC<GoldFoilProps> = ({
  text = "PRESTIGE",
  fontSize = 100,
  letterSpacing = 14,
  goldTone = "#e5c158",
  foilContrast = 0.85,
  debossDepth = 3.5,
  bevelHighlight = 0.7,
  bgColor = "transparent",
  paperTexture = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16),
          }
        : { r: 229, g: 193, b: 88 };
    };

    const render = () => {
      const w = canvas.width / window.devicePixelRatio;
      const h = canvas.height / window.devicePixelRatio;

      ctx.clearRect(0, 0, w, h);
      if (bgColor && bgColor !== "transparent") {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, w, h);
      }
      if (bgColor && bgColor !== "transparent" && paperTexture > 0) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
        for (let i = 0; i < w; i += 3) {
          for (let j = 0; j < h; j += 3) {
            if (Math.random() < paperTexture) ctx.fillRect(i, j, 1.5, 1.5);
          }
        }
        ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
        for (let i = 0; i < w; i += 4) {
          for (let j = 0; j < h; j += 4) {
            if (Math.random() < paperTexture) ctx.fillRect(i, j, 2, 2);
          }
        }
      }
      ctx.font = `900 ${fontSize}px 'Cinzel', Georgia, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.letterSpacing = `${letterSpacing}px`;
      ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
      ctx.shadowBlur = debossDepth * 1.5;
      ctx.shadowOffsetX = -debossDepth * 0.4;
      ctx.shadowOffsetY = -debossDepth * 0.4;
      ctx.fillStyle = "#000000";
      ctx.fillText(text, w / 2 + debossDepth, h / 2 + debossDepth);
      ctx.shadowColor = `rgba(255, 255, 255, ${bevelHighlight * 0.45})`;
      ctx.shadowBlur = debossDepth * 0.8;
      ctx.shadowOffsetX = debossDepth * 0.5;
      ctx.shadowOffsetY = debossDepth * 0.5;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, w / 2 - debossDepth * 0.2, h / 2 - debossDepth * 0.2);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      const baseGold = hexToRgb(goldTone);
      const goldGrad = ctx.createLinearGradient(w / 2 - 300, h / 2 - 100, w / 2 + 300, h / 2 + 100);
      goldGrad.addColorStop(
        0,
        `rgb(${Math.max(0, baseGold.r - 120 * foilContrast)}, ${Math.max(
          0,
          baseGold.g - 100 * foilContrast
        )}, ${Math.max(0, baseGold.b - 60 * foilContrast)})`
      );
      goldGrad.addColorStop(
        0.2,
        `rgb(${Math.min(255, baseGold.r + 20)}, ${Math.min(
          255,
          baseGold.g + 20
        )}, ${Math.min(255, baseGold.b + 10)})`
      );
      goldGrad.addColorStop(
        0.4,
        `rgb(${Math.min(255, baseGold.r + 110 * foilContrast)}, ${Math.min(
          255,
          baseGold.g + 110 * foilContrast
        )}, ${Math.min(255, baseGold.b + 90 * foilContrast)})`
      );
      goldGrad.addColorStop(0.45, `rgb(255, 255, 220)`);
      goldGrad.addColorStop(
        0.5,
        `rgb(${Math.max(0, baseGold.r - 40 * foilContrast)}, ${Math.max(
          0,
          baseGold.g - 35 * foilContrast
        )}, ${Math.max(0, baseGold.b - 20 * foilContrast)})`
      );
      goldGrad.addColorStop(0.7, `rgb(${baseGold.r}, ${baseGold.g}, ${baseGold.b})`);
      goldGrad.addColorStop(
        1,
        `rgb(${Math.max(0, baseGold.r - 130 * foilContrast)}, ${Math.max(
          0,
          baseGold.g - 110 * foilContrast
        )}, ${Math.max(0, baseGold.b - 70 * foilContrast)})`
      );
      ctx.fillStyle = goldGrad;
      ctx.fillText(text, w / 2, h / 2);
      const foilNoise = ctx.createRadialGradient(w / 2, h / 2, 5, w / 2, h / 2, 400);
      foilNoise.addColorStop(0, "rgba(255,255,255,0.06)");
      foilNoise.addColorStop(1, "rgba(0,0,0,0.12)");
      ctx.fillStyle = foilNoise;
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillText(text, w / 2, h / 2);
      ctx.globalCompositeOperation = "source-over";
    };

    const handleResize = () => {
      canvas.width = window.innerWidth * window.devicePixelRatio;
      canvas.height = window.innerHeight * window.devicePixelRatio;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      render();
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [
    text,
    fontSize,
    letterSpacing,
    goldTone,
    foilContrast,
    debossDepth,
    bevelHighlight,
    bgColor,
    paperTexture,
  ]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
};
