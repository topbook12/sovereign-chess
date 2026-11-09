/**
 * Sovereign Chess — PWA icon forge.
 *
 * Renders the royal emerald-and-gold king mark into every icon the
 * platform needs. Runs entirely on-device with sharp (already a project
 * dependency) — zero external services, zero cost.
 *
 * Usage: bun scripts/generate-icons.mjs
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

/* ------------------------------------------------------------------ */
/* Vector artwork (512 viewBox)                                        */
/* ------------------------------------------------------------------ */

/** The king mark, drawn in a 512-box. `scale` shrinks it for safe zones. */
function kingMark(scale = 1) {
  const cx = 256;
  const cy = 268; // visual centre of the piece
  const k = scale;
  const t = `translate(${cx * (1 - k)} ${cy * (1 - k)}) scale(${k})`;
  return `
  <g transform="${t}" stroke="#5d4315" stroke-width="6" stroke-linejoin="round">
    <!-- ground shadow -->
    <ellipse cx="256" cy="468" rx="128" ry="14" fill="#000000" opacity="0.4" stroke="none"/>
    <!-- top cross -->
    <rect x="245" y="74" width="22" height="74" rx="8" fill="url(#gold)"/>
    <rect x="218" y="96" width="76" height="22" rx="8" fill="url(#gold)"/>
    <!-- crown side orbs -->
    <circle cx="148" cy="180" r="16" fill="url(#gold)"/>
    <circle cx="364" cy="180" r="16" fill="url(#gold)"/>
    <!-- crown body -->
    <path d="M 156,284 C 156,206 198,158 256,150 C 314,158 356,206 356,284 Z" fill="url(#gold)"/>
    <!-- crown highlight -->
    <path d="M 186,262 C 186,212 212,176 244,164" fill="none" stroke="#fbeab5" stroke-width="9" stroke-linecap="round" opacity="0.75"/>
    <!-- collar -->
    <rect x="140" y="284" width="232" height="30" rx="14" fill="url(#goldDeep)"/>
    <!-- body -->
    <path d="M 182,314 L 330,314 L 306,404 L 206,404 Z" fill="url(#gold)"/>
    <!-- base 1 -->
    <rect x="192" y="404" width="128" height="26" rx="10" fill="url(#goldDeep)"/>
    <!-- base 2 -->
    <rect x="166" y="430" width="180" height="30" rx="12" fill="url(#gold)"/>
  </g>`;
}

function iconSvg({ scale = 0.78, radius = 108, rings = true, glow = true }) {
  const ringA = rings
    ? `<rect x="14" y="14" width="484" height="484" rx="${Math.max(radius - 12, 0)}" fill="none" stroke="#c69c3f" stroke-opacity="0.6" stroke-width="4"/>
       <rect x="24" y="24" width="464" height="464" rx="${Math.max(radius - 22, 0)}" fill="none" stroke="#f9e7a8" stroke-opacity="0.16" stroke-width="2"/>`
    : "";
  const glowLayer = glow
    ? `<rect width="512" height="512" rx="${radius}" fill="url(#glow)"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#12201a"/>
      <stop offset="0.55" stop-color="#0a1410"/>
      <stop offset="1" stop-color="#040806"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.66">
      <stop offset="0" stop-color="#2a5c40" stop-opacity="0.55"/>
      <stop offset="0.6" stop-color="#1d3a2c" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#1d3a2c" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbeab5"/>
      <stop offset="0.42" stop-color="#ecca6f"/>
      <stop offset="0.78" stop-color="#c69c3f"/>
      <stop offset="1" stop-color="#a9832f"/>
    </linearGradient>
    <linearGradient id="goldDeep" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d9b45c"/>
      <stop offset="1" stop-color="#8a6a24"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#bg)"/>
  ${glowLayer}
  ${ringA}
  ${kingMark(scale)}
</svg>`;
}

/* ------------------------------------------------------------------ */
/* Render targets                                                      */
/* ------------------------------------------------------------------ */

const targets = [
  // classic "any" icons — squircle, framed
  { name: "icon-512.png", size: 512, opts: { scale: 0.8, radius: 108, rings: true } },
  { name: "icon-192.png", size: 192, opts: { scale: 0.8, radius: 108, rings: true } },
  // maskable — full bleed, content deep inside the safe zone, no rings
  { name: "icon-maskable-512.png", size: 512, opts: { scale: 0.62, radius: 0, rings: false } },
  { name: "icon-maskable-192.png", size: 192, opts: { scale: 0.62, radius: 0, rings: false } },
  // iOS home screen — full bleed, generous margin, Apple applies its own mask
  { name: "apple-touch-icon.png", size: 180, opts: { scale: 0.72, radius: 0, rings: false } },
  // generic favicon raster fallback
  { name: "icon-32.png", size: 32, opts: { scale: 0.8, radius: 108, rings: false } },
];

// render at 2x for crisp downsampling
const RENDER_DENSITY = 144; // 72dpi * 2 → 1024px raster

for (const t of targets) {
  const svg = Buffer.from(iconSvg(t.opts));
  await sharp(svg, { density: RENDER_DENSITY })
    .resize(t.size, t.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, t.name));
  console.log(`✓ public/icons/${t.name} (${t.size}×${t.size})`);
}

console.log("\nAll PWA icons forged.");
