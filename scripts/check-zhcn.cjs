// 校验 ZH_CN 字典：完整性、重复 key、空值、残留英文
const fs = require("fs");
const p = fs.readFileSync("H:/AI/Clypra/src/i18n/I18nProvider.tsx", "utf8");
const zhCn = p.slice(p.indexOf("const ZH_CN"), p.indexOf("const EN_FROM_ZH_TW"));
const re = /"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
let m, cnt = 0, dup = 0, empty = 0;
const seen = new Set();
const entries = [];
while ((m = re.exec(zhCn))) {
  cnt++;
  if (seen.has(m[1])) dup++;
  seen.add(m[1]);
  entries.push([m[1], m[2]]);
  if (!m[2].trim()) empty++;
}
console.log("ZH_CN 词条:", cnt, "| 重复key:", dup, "| 空值:", empty);

// 残留英文检测（值中出现的纯英文字母串，排除专有名词/技术词）
const whitelist = new Set([
  "English","Whisper","FFmpeg","WebView","GPU","API","IndexedDB","JSON","PATH","Google","Tauri","React","Clypra",
  "LUT","UltraKey","SRT","WebP","GitHub","Patreon","p95","WebGL","OpenCC","L/R","Cmd","Ctrl","Shift","Esc","Alt",
  "CapCut","Pro","S","L","R","I","O","Q","W","F12","Hz","px","EV","iOS","Android","AI","Clip","Studio","MIDI","Ease",
  "Base","Fill","GIF","MP4","MOV","WebM","MKV","MP3","WAV","PNG","H.264","H.265","AV1","HEVC","Patreon","K","M","T",
  "SRT","LUT","3D","S-Curve","X","Y","Z","D","G","B","A","V","IDB","URL","CRT","HTTP","HTTPS","Web","WASM","Metal",
  "DirectX","Vulkan","OpenGL","DVD","NLE","MS","kHz","Hz","ms","KHz","MB","GB","TB","px","fps","HDR","SDR","Lut",
]);
const englishWord = /\b[A-Za-z]{2,}\b/g;
const bad = [];
for (const [k, v] of entries) {
  const words = v.match(englishWord) || [];
  for (const w of words) {
    if (!whitelist.has(w)) {
      bad.push(`${JSON.stringify(k)} => ${JSON.stringify(v)}  (词: ${w})`);
      break;
    }
  }
}
console.log("疑似残留英文的值:", bad.length);
bad.slice(0, 30).forEach((b) => console.log(" ", b));
