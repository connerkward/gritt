import { App } from "@modelcontextprotocol/ext-apps";

// --- Color math ---

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

interface ColorInfo {
  r: number; g: number; b: number;
  hex: string;
  hsl: { h: number; s: number; l: number };
  weight: number;
}

function kMeans(
  data: Uint8ClampedArray,
  startX: number, startY: number, w: number, h: number,
  canvasW: number, k: number,
): ColorInfo[] {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 800)));
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];

  for (let row = 0; row < h; row += step) {
    for (let col = 0; col < w; col += step) {
      const idx = ((startY + row) * canvasW + (startX + col)) * 4;
      rs.push(data[idx]);
      gs.push(data[idx + 1]);
      bs.push(data[idx + 2]);
    }
  }

  const n = rs.length;
  if (n === 0) return [];
  k = Math.min(k, n);

  const cStep = Math.floor(n / k);
  const cr = new Float64Array(k), cg = new Float64Array(k), cb = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    cr[i] = rs[i * cStep]; cg[i] = gs[i * cStep]; cb[i] = bs[i * cStep];
  }

  const assign = new Int32Array(n);
  for (let iter = 0; iter < 8; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let j = 0; j < k; j++) {
        const d = (rs[i] - cr[j]) ** 2 + (gs[i] - cg[j]) ** 2 + (bs[i] - cb[j]) ** 2;
        if (d < bestD) { bestD = d; best = j; }
      }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }
    if (!changed) break;
    const sr = new Float64Array(k), sg = new Float64Array(k), sb = new Float64Array(k);
    const cnt = new Float64Array(k);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      sr[c] += rs[i]; sg[c] += gs[i]; sb[c] += bs[i]; cnt[c]++;
    }
    for (let j = 0; j < k; j++) {
      if (cnt[j] > 0) { cr[j] = sr[j] / cnt[j]; cg[j] = sg[j] / cnt[j]; cb[j] = sb[j] / cnt[j]; }
    }
  }

  const counts = new Float64Array(k);
  for (let i = 0; i < n; i++) counts[assign[i]]++;

  return Array.from({ length: k }, (_, i) => {
    const r = Math.round(cr[i]), g = Math.round(cg[i]), b = Math.round(cb[i]);
    return { r, g, b, hex: rgbToHex(r, g, b), hsl: rgbToHsl(r, g, b), weight: counts[i] / n };
  })
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}

function generateCss(colors: ColorInfo[]) {
  const gradient = `linear-gradient(135deg, ${colors.map((c, i) => `${c.hex} ${Math.round((i / Math.max(colors.length - 1, 1)) * 100)}%`).join(", ")})`;
  const noise = colors.map((c, i) => {
    const x = 20 + ((i * 37) % 60), y = 20 + ((i * 53) % 60);
    return `radial-gradient(ellipse at ${x}% ${y}%, ${c.hex}88 0%, transparent 60%)`;
  }).join(", ");
  const mesh = colors.map((c, i) => `linear-gradient(${(i * 360) / colors.length}deg, ${c.hex}cc 0%, transparent 70%)`).join(", ");
  return { gradient, noise, mesh };
}

function drawTexturePreview(cvs: HTMLCanvasElement, palette: ColorInfo[]) {
  const W = cvs.width, H = cvs.height;
  const ctx = cvs.getContext("2d")!;
  ctx.fillStyle = palette[0].hex;
  ctx.fillRect(0, 0, W, H);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];
      const count = Math.max(2, Math.round(c.weight * 12));
      for (let j = 0; j < count; j++) {
        const seed = i * 97 + j * 31 + pass * 53;
        const x = ((seed * 7 + j * 137) % W);
        const y = ((seed * 13 + j * 89 + pass * 43) % H);
        const r = 20 + (seed % 40) + pass * 15;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${0.3 + pass * 0.1})`);
        grad.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  }
  const imgData = ctx.getImageData(0, 0, W, H);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(imgData, 0, 0);
}

// --- DOM ---

const root = document.getElementById("root")!;

const style = document.createElement("style");
style.textContent = `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#0e0e0e; color:#ddd; }
#root { display:flex; flex-direction:column; height:100vh; overflow:hidden; }
.status-bar { font-size:10px; color:#666; padding:4px 12px; background:#111; border-bottom:1px solid #222; flex-shrink:0; }
.top { display:flex; gap:12px; flex:1; min-height:0; padding:12px; }
.canvas-wrap { position:relative; flex:1; min-width:0; overflow:hidden; border-radius:8px; background:#1a1a1a; cursor:crosshair; }
.canvas-wrap canvas { display:block; width:100%; height:100%; object-fit:contain; }
.select-rect { position:absolute; border:2px solid rgba(255,255,255,0.7); background:rgba(255,255,255,0.08); pointer-events:none; border-radius:2px; }
.sidebar { width:280px; flex-shrink:0; display:flex; flex-direction:column; gap:6px; overflow-y:auto; padding-bottom:12px; }
h3 { font-size:11px; font-weight:600; color:#777; text-transform:uppercase; letter-spacing:0.5px; margin-top:4px; }
.palette { display:flex; gap:3px; flex-wrap:wrap; }
.swatch { width:36px; height:36px; border-radius:6px; cursor:pointer; transition:transform 0.1s; position:relative; border:1px solid rgba(255,255,255,0.1); }
.swatch:hover { transform:scale(1.15); z-index:1; border-color:rgba(255,255,255,0.4); }
.swatch-hex { font-size:9px; color:#888; }
.swatch-pct { font-size:9px; color:#555; }
.texture-preview { width:100%; height:120px; border-radius:8px; border:1px solid #2a2a2a; overflow:hidden; }
.texture-preview canvas { width:100%; height:100%; display:block; }
.css-previews { display:flex; gap:4px; }
.css-prev { flex:1; height:48px; border-radius:6px; border:1px solid #2a2a2a; }
.css-prev-label { font-size:9px; color:#555; text-align:center; margin-top:1px; }
.css-block { background:#151515; border:1px solid #2a2a2a; border-radius:6px; padding:6px 8px; font:10px/1.4 "SF Mono",monospace; color:#aaa; white-space:pre-wrap; word-break:break-all; cursor:pointer; max-height:48px; overflow:hidden; }
.css-block:hover { border-color:#555; color:#ccc; }
.empty-msg { color:#555; font-size:13px; text-align:center; padding:40px 12px; line-height:1.5; }
.controls { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.controls label { font-size:10px; color:#666; }
.controls input[type=range] { width:70px; accent-color:#0078d6; }
.num-display { font-size:10px; color:#999; min-width:14px; }
.copied { position:fixed; top:12px; right:12px; background:#333; color:#fff; padding:4px 10px; border-radius:4px; font-size:11px; opacity:0; transition:opacity 0.2s; pointer-events:none; z-index:99; }
.copied.show { opacity:1; }
.header-bar { display:flex; align-items:center; justify-content:space-between; padding:6px 12px; border-bottom:1px solid #222; flex-shrink:0; }
.header-bar h1 { font-size:15px; font-weight:700; letter-spacing:0.5px; }
.header-bar h1 span { color:#666; font-weight:400; font-size:11px; margin-left:4px; }
.upload-btn { background:#1a1a1a; border:1px solid #333; color:#aaa; padding:5px 12px; border-radius:6px; font-size:11px; cursor:pointer; }
.upload-btn:hover { background:#252525; border-color:#444; }
.drop-overlay { position:absolute; inset:0; background:rgba(0,120,214,0.15); border:3px dashed #0078d6; display:none; align-items:center; justify-content:center; z-index:10; pointer-events:none; border-radius:8px; }
.drop-overlay.active { display:flex; }
.drop-overlay span { background:#0078d6; color:#fff; padding:6px 16px; border-radius:6px; font-size:12px; }
`;
root.appendChild(style);

// Debug status bar — visible in Claude Desktop so we can see what's happening
const statusBar = document.createElement("div");
statusBar.className = "status-bar";
statusBar.textContent = "Initializing...";
root.appendChild(statusBar);

function setStatus(msg: string) {
  statusBar.textContent = msg;
  console.log("[picker]", msg);
}

// Header with upload button
const headerBar = document.createElement("div");
headerBar.className = "header-bar";
const h1 = document.createElement("h1");
h1.innerHTML = 'Gritt <span>color texture picker</span>';
const uploadLabel = document.createElement("label");
uploadLabel.className = "upload-btn";
uploadLabel.textContent = "Upload Image";
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = "image/*";
fileInput.style.display = "none";
uploadLabel.appendChild(fileInput);
headerBar.append(h1, uploadLabel);
root.appendChild(headerBar);

const topRow = document.createElement("div");
topRow.className = "top";
root.appendChild(topRow);

const canvasWrap = document.createElement("div");
canvasWrap.className = "canvas-wrap";
topRow.appendChild(canvasWrap);

const canvas = document.createElement("canvas");
canvasWrap.appendChild(canvas);

const selectRect = document.createElement("div");
selectRect.className = "select-rect";
selectRect.style.display = "none";
canvasWrap.appendChild(selectRect);

const dropOverlay = document.createElement("div");
dropOverlay.className = "drop-overlay";
dropOverlay.innerHTML = "<span>Drop image here</span>";
canvasWrap.appendChild(dropOverlay);

const sidebar = document.createElement("div");
sidebar.className = "sidebar";
topRow.appendChild(sidebar);

const copiedToast = document.createElement("div");
copiedToast.className = "copied";
copiedToast.textContent = "Copied!";
root.appendChild(copiedToast);

let toastTimer: ReturnType<typeof setTimeout>;
function showCopied(text: string) {
  copiedToast.textContent = `Copied: ${text}`;
  copiedToast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => copiedToast.classList.remove("show"), 1200);
}

// File upload + drag & drop
function loadImageFromFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 1200;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > max || h > max) {
        const s = max / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h);
      fullImageData = ctx.getImageData(0, 0, w, h);
      setStatus(`Image loaded (${w}x${h})`);
      showEmptyMsg("Click or drag on the image to pick a color texture");
    };
    img.src = reader.result as string;
  };
  reader.readAsDataURL(file);
}

fileInput.addEventListener("change", () => {
  if (fileInput.files?.[0]) loadImageFromFile(fileInput.files[0]);
});

canvasWrap.addEventListener("dragover", (e) => { e.preventDefault(); dropOverlay.classList.add("active"); });
canvasWrap.addEventListener("dragleave", () => dropOverlay.classList.remove("active"));
canvasWrap.addEventListener("drop", (e) => {
  e.preventDefault();
  dropOverlay.classList.remove("active");
  if (e.dataTransfer?.files[0]) loadImageFromFile(e.dataTransfer.files[0]);
});

// State
let fullImageData: ImageData | null = null;
let numColors = 6;
let regionSize = 40;

/**
 * Load image from base64. Three strategies tried in order:
 * 1. fetch() data URL → blob → createImageBitmap (fastest, native decode)
 * 2. Blob + createImageBitmap (fast, manual base64 decode)
 * 3. new Image() with data URL (slowest but most compatible)
 */
async function loadImage(base64: string) {
  const t0 = performance.now();
  const sizeMB = (base64.length / 1024 / 1024).toFixed(1);
  setStatus(`Loading image (${sizeMB}MB base64)...`);

  // Detect mime from first bytes of base64
  let mime = "image/png";
  try {
    const probe = atob(base64.slice(0, 16));
    if (probe.charCodeAt(0) === 0xFF && probe.charCodeAt(1) === 0xD8) mime = "image/jpeg";
    else if (probe.charCodeAt(0) === 0x52 && probe.charCodeAt(1) === 0x49) mime = "image/webp";
  } catch { /* default to png */ }

  let bitmap: ImageBitmap | null = null;

  // Strategy 1: fetch data URL (browser-native base64 decode — fastest)
  try {
    setStatus(`Loading (${sizeMB}MB) — trying fetch decode...`);
    const resp = await fetch(`data:${mime};base64,${base64}`);
    const blob = await resp.blob();
    bitmap = await createImageBitmap(blob);
    setStatus(`Decoded via fetch in ${(performance.now() - t0).toFixed(0)}ms`);
  } catch (e1) {
    setStatus(`fetch decode failed: ${e1}, trying Blob...`);

    // Strategy 2: manual decode → Blob → createImageBitmap
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      bitmap = await createImageBitmap(blob);
      setStatus(`Decoded via Blob in ${(performance.now() - t0).toFixed(0)}ms`);
    } catch (e2) {
      setStatus(`Blob decode failed: ${e2}, trying Image...`);

      // Strategy 3: new Image() with data URL (most compatible fallback)
      try {
        bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
          const img = new Image();
          img.onload = async () => {
            try { resolve(await createImageBitmap(img)); }
            catch {
              // Last resort: draw img directly without createImageBitmap
              const tmpC = document.createElement("canvas");
              tmpC.width = img.naturalWidth;
              tmpC.height = img.naturalHeight;
              tmpC.getContext("2d")!.drawImage(img, 0, 0);
              resolve(await createImageBitmap(tmpC));
            }
          };
          img.onerror = reject;
          img.src = `data:${mime};base64,${base64}`;
        });
        setStatus(`Decoded via Image in ${(performance.now() - t0).toFixed(0)}ms`);
      } catch (e3) {
        // Absolute last resort: Image + direct canvas draw (no createImageBitmap)
        try {
          await new Promise<void>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              const maxDim = 1200;
              let dw = img.naturalWidth, dh = img.naturalHeight;
              if (dw > maxDim || dh > maxDim) {
                const scale = maxDim / Math.max(dw, dh);
                dw = Math.round(dw * scale);
                dh = Math.round(dh * scale);
              }
              canvas.width = dw;
              canvas.height = dh;
              const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
              ctx.drawImage(img, 0, 0, dw, dh);
              fullImageData = ctx.getImageData(0, 0, dw, dh);
              setStatus(`Ready (${dw}x${dh}) — decoded via Image fallback in ${(performance.now() - t0).toFixed(0)}ms`);
              showEmptyMsg("Click or drag on the image to pick a color texture");
              resolve();
            };
            img.onerror = reject;
            img.src = `data:${mime};base64,${base64}`;
          });
          return; // Successfully loaded via fallback
        } catch (e4) {
          setStatus(`All decode methods failed: ${e4}`);
          showEmptyMsg(`Failed to load image. Error: ${e4}`);
          return;
        }
      }
    }
  }

  // If we got a bitmap, draw it scaled
  if (bitmap) {
    const maxDim = 1200;
    let dw = bitmap.width, dh = bitmap.height;
    if (dw > maxDim || dh > maxDim) {
      const scale = maxDim / Math.max(dw, dh);
      dw = Math.round(dw * scale);
      dh = Math.round(dh * scale);
    }
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, dw, dh);
    bitmap.close();
    fullImageData = ctx.getImageData(0, 0, dw, dh);
    setStatus(`Ready (${dw}x${dh}) — loaded in ${(performance.now() - t0).toFixed(0)}ms`);
    showEmptyMsg("Click or drag on the image to pick a color texture");
  }
}

function showEmptyMsg(msg: string) {
  sidebar.replaceChildren();
  sidebar.appendChild(buildControls());
  const m = document.createElement("div");
  m.className = "empty-msg";
  m.textContent = msg;
  sidebar.appendChild(m);
}

function buildControls(): HTMLElement {
  const c = document.createElement("div");
  c.className = "controls";
  const lbl1 = document.createElement("label");
  lbl1.textContent = "Colors:";
  const numDisp = document.createElement("span");
  numDisp.className = "num-display";
  numDisp.textContent = String(numColors);
  const slider1 = document.createElement("input");
  slider1.type = "range"; slider1.min = "2"; slider1.max = "12"; slider1.value = String(numColors);
  slider1.addEventListener("input", () => { numColors = +slider1.value; numDisp.textContent = slider1.value; });
  const lbl2 = document.createElement("label");
  lbl2.textContent = "Radius:";
  const radDisp = document.createElement("span");
  radDisp.className = "num-display";
  radDisp.textContent = String(regionSize);
  const slider2 = document.createElement("input");
  slider2.type = "range"; slider2.min = "10"; slider2.max = "150"; slider2.value = String(regionSize);
  slider2.addEventListener("input", () => { regionSize = +slider2.value; radDisp.textContent = slider2.value; });
  c.append(lbl1, slider1, numDisp, lbl2, slider2, radDisp);
  return c;
}

function canvasCoords(e: MouseEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const imgAspect = canvas.width / canvas.height;
  const boxAspect = rect.width / rect.height;
  let drawW: number, drawH: number, offsetX: number, offsetY: number;
  if (imgAspect > boxAspect) {
    drawW = rect.width; drawH = rect.width / imgAspect; offsetX = 0; offsetY = (rect.height - drawH) / 2;
  } else {
    drawH = rect.height; drawW = rect.height * imgAspect; offsetX = (rect.width - drawW) / 2; offsetY = 0;
  }
  const x = ((e.clientX - rect.left - offsetX) / drawW) * canvas.width;
  const y = ((e.clientY - rect.top - offsetY) / drawH) * canvas.height;
  return [Math.round(x), Math.round(y)];
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

let rafId = 0;
function analyzeAt(cx: number, cy: number) {
  if (!fullImageData) return;
  cx = clamp(cx, 0, fullImageData.width - 1);
  cy = clamp(cy, 0, fullImageData.height - 1);
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    if (!fullImageData) return;
    const iw = fullImageData.width, ih = fullImageData.height;
    const x0 = clamp(cx - regionSize, 0, iw - 1);
    const y0 = clamp(cy - regionSize, 0, ih - 1);
    const x1 = clamp(cx + regionSize, 0, iw);
    const y1 = clamp(cy + regionSize, 0, ih);
    const w = x1 - x0, h = y1 - y0;
    if (w < 1 || h < 1) return;
    // Selection rect overlay
    const canvasRect = canvas.getBoundingClientRect();
    const imgAspect = canvas.width / canvas.height;
    const boxAspect = canvasRect.width / canvasRect.height;
    let drawW: number, drawH: number, offX: number, offY: number;
    if (imgAspect > boxAspect) {
      drawW = canvasRect.width; drawH = canvasRect.width / imgAspect; offX = 0; offY = (canvasRect.height - drawH) / 2;
    } else {
      drawH = canvasRect.height; drawW = canvasRect.height * imgAspect; offX = (canvasRect.width - drawW) / 2; offY = 0;
    }
    const sx = drawW / iw, sy = drawH / ih;
    selectRect.style.display = "block";
    selectRect.style.left = `${offX + x0 * sx}px`;
    selectRect.style.top = `${offY + y0 * sy}px`;
    selectRect.style.width = `${w * sx}px`;
    selectRect.style.height = `${h * sy}px`;
    const palette = kMeans(fullImageData!.data, x0, y0, w, h, iw, numColors);
    if (palette.length === 0) return;
    const css = generateCss(palette);
    renderSidebar(palette, css);
  });
}

function renderSidebar(palette: ColorInfo[], css: { gradient: string; noise: string; mesh: string }) {
  sidebar.replaceChildren();
  sidebar.appendChild(buildControls());

  const texLabel = document.createElement("h3");
  texLabel.textContent = "Texture Preview";
  sidebar.appendChild(texLabel);
  const texWrap = document.createElement("div");
  texWrap.className = "texture-preview";
  const texCanvas = document.createElement("canvas");
  texCanvas.width = 280; texCanvas.height = 120;
  texWrap.appendChild(texCanvas);
  sidebar.appendChild(texWrap);
  drawTexturePreview(texCanvas, palette);

  const palLabel = document.createElement("h3");
  palLabel.textContent = `Palette (${palette.length})`;
  sidebar.appendChild(palLabel);
  const palRow = document.createElement("div");
  palRow.className = "palette";
  for (const c of palette) {
    const sw = document.createElement("div");
    sw.className = "swatch";
    sw.style.background = c.hex;
    sw.title = `${c.hex}\nHSL(${c.hsl.h}, ${c.hsl.s}%, ${c.hsl.l}%)\n${Math.round(c.weight * 100)}%`;
    sw.addEventListener("click", () => { navigator.clipboard.writeText(c.hex); showCopied(c.hex); });
    palRow.appendChild(sw);
  }
  sidebar.appendChild(palRow);
  const infoRow = document.createElement("div");
  infoRow.className = "palette";
  infoRow.style.gap = "2px";
  for (const c of palette) {
    const info = document.createElement("div");
    info.style.width = "36px"; info.style.textAlign = "center";
    const hex = document.createElement("div");
    hex.className = "swatch-hex"; hex.textContent = c.hex;
    const pct = document.createElement("div");
    pct.className = "swatch-pct"; pct.textContent = `${Math.round(c.weight * 100)}%`;
    info.append(hex, pct);
    infoRow.appendChild(info);
  }
  sidebar.appendChild(infoRow);

  const cssLabel = document.createElement("h3");
  cssLabel.textContent = "CSS Patterns";
  sidebar.appendChild(cssLabel);
  const prevRow = document.createElement("div");
  prevRow.className = "css-previews";
  const previews: [string, string][] = [
    ["Gradient", css.gradient],
    ["Noise", css.noise],
    ["Mesh", `${css.mesh}, ${palette[0].hex}`],
  ];
  for (const [label, bg] of previews) {
    const col = document.createElement("div");
    col.style.flex = "1";
    const prev = document.createElement("div");
    prev.className = "css-prev";
    prev.style.background = bg;
    prev.style.cursor = "pointer";
    prev.title = `Click to copy ${label} CSS`;
    prev.addEventListener("click", () => { navigator.clipboard.writeText(`background: ${bg};`); showCopied(label); });
    const lbl = document.createElement("div");
    lbl.className = "css-prev-label"; lbl.textContent = label;
    col.append(prev, lbl);
    prevRow.appendChild(col);
  }
  sidebar.appendChild(prevRow);

  const codeLabel = document.createElement("h3");
  codeLabel.textContent = "CSS (click to copy)";
  sidebar.appendChild(codeLabel);
  const snippets: [string, string][] = [
    ["gradient", css.gradient],
    ["noise", css.noise],
    ["mesh", `${css.mesh}, ${palette[0].hex}`],
  ];
  for (const [label, value] of snippets) {
    const block = document.createElement("div");
    block.className = "css-block";
    block.textContent = `/* ${label} */\nbackground: ${value};`;
    block.addEventListener("click", () => { navigator.clipboard.writeText(`background: ${value};`); showCopied(label); });
    sidebar.appendChild(block);
  }
}

// Mouse interaction
let isDown = false;
canvasWrap.addEventListener("mousedown", (e) => {
  isDown = true;
  const [cx, cy] = canvasCoords(e);
  analyzeAt(cx, cy);
});
canvasWrap.addEventListener("mousemove", (e) => {
  if (!isDown) return;
  const [cx, cy] = canvasCoords(e);
  analyzeAt(cx, cy);
});
window.addEventListener("mouseup", () => { isDown = false; });

// --- MCP bridge ---
// Strategy: prefer ontoolresult (server-compressed JPEG, small) over ontoolinput (raw, potentially huge).
// ontoolinput fires first but with raw data. ontoolresult fires after server compresses.
// We stash the raw input and wait briefly for ontoolresult. If it doesn't come, use raw input.

const app = new App({ name: "Gritt", version: "1.0.0" });

app.ontoolinput = () => {
  setStatus("Tool opened — ready for image upload");
  showEmptyMsg("Click or drag an image onto the canvas to start picking color textures");
};

app.ontoolresult = () => {
  setStatus("Tool result received");
};

app.ontoolcancelled = (params) => {
  setStatus(`Tool cancelled: ${params.reason ?? "unknown reason"}`);
};

app.onteardown = async () => {
  return {};
};

setStatus("Connecting to MCP host...");
(async () => {
  try {
    await app.connect();
    setStatus("Connected — upload an image to start");
    showEmptyMsg("Click or drag an image onto the canvas to start picking color textures");
  } catch (err) {
    setStatus(`Connection failed: ${err}`);
  }
})();
