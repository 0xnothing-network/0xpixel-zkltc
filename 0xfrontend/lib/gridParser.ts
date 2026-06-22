/**
 * Grid data parser & exporter for pixel art.
 * Converts pixelData (string[][]) to PNG base64 or JSON for export/sharing.
 */

/** Convert pixelData 2D array to a PNG data URL (base64). */
export function pixelDataToPNG(pixelData: string[][], gridSize: number, outputSize = 512): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const pixelSize = outputSize / gridSize;

  ctx.fillStyle = "#0F0F23";
  ctx.fillRect(0, 0, outputSize, outputSize);

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const color = pixelData[y]?.[x];
      if (color && color !== "transparent") {
        ctx.fillStyle = color;
        ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
      }
    }
  }

  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

/** Convert pixelData 2D array to the compact on-chain text format. */
export function pixelDataToOnchainText(pixelData: string[][], gridSize: number): string {
  const lines: string[] = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const color = pixelData[y]?.[x];
      if (color && color !== "transparent") {
        lines.push(`[${x},${y}]=${color.toUpperCase()}`);
      }
    }
  }
  return lines.join(" ");
}

/**
 * Pack pixelData into RLE binary form for on-chain storage.
 *
 * Format: rows of runs. Each pixel is a horizontal run of identical color.
 * Each run = 5 bytes: [x(1)] [y(1)] [count(1)] [r,g,b(3)]
 *   - count: number of consecutive pixels (1..64), unsigned
 *   - x: starting x, 0..63
 *   - y: row index, 0..63
 *
 * Worst case (alternating colors per pixel): 64*64 runs * 5B = 20480 bytes
 * (same as previous format).
 * Realistic art: typically 60-90% smaller.
 *
 * Returns "0x" + lowercase hex string, suitable for viem bytes arg.
 */
export function pixelDataToPackedBytes(pixelData: string[][], gridSize: number): `0x${string}` {
  const parts: number[] = [];
  for (let y = 0; y < gridSize; y++) {
    let x = 0;
    while (x < gridSize) {
      const color = pixelData[y]?.[x];
      if (!color || color === "transparent") {
        x++;
        continue;
      }
      const m = /^#?([0-9a-fA-F]{6})$/.exec(color);
      if (!m) {
        x++;
        continue;
      }
      const rgb = parseInt(m[1], 16);
      const r = (rgb >> 16) & 0xff;
      const g = (rgb >> 8) & 0xff;
      const b = rgb & 0xff;
      // Count run length within same row + same color
      let count = 1;
      while (
        x + count < gridSize &&
        pixelData[y]?.[x + count] === color
      ) {
        count++;
        if (count === 64) break;
      }
      parts.push(x & 0xff, y & 0xff, count & 0xff, r, g, b);
      x += count;
    }
  }
  let hex = "0x";
  for (let i = 0; i < parts.length; i++) {
    hex += parts[i].toString(16).padStart(2, "0");
  }
  return hex as `0x${string}`;
}

/**
 * Decode RLE packed bytes back to the on-chain text format:
 *   [x,y]=#RRGGBB (one per pixel, with repeated runs expanded)
 */
export function packedBytesToOnchainText(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length === 0 || clean.length % 12 !== 0) return "";
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += 12) {
    const x = parseInt(clean.slice(i, i + 2), 16);
    const y = parseInt(clean.slice(i + 2, i + 4), 16);
    const count = parseInt(clean.slice(i + 4, i + 6), 16);
    const r = parseInt(clean.slice(i + 6, i + 8), 16);
    const g = parseInt(clean.slice(i + 8, i + 10), 16);
    const b = parseInt(clean.slice(i + 10, i + 12), 16);
    const color =
      "#" +
      r.toString(16).padStart(2, "0") +
      g.toString(16).padStart(2, "0") +
      b.toString(16).padStart(2, "0");
    for (let k = 0; k < count; k++) {
      out.push(`[${x + k},${y}]=${color.toUpperCase()}`);
    }
  }
  return out.join(" ");
}

/** Convert pixelData 2D array to a compact JSON string matching AIPromptGenerator's input format. */
export function pixelDataToJSON(pixelData: string[][], gridSize: number): string {
  return pixelDataToOnchainText(pixelData, gridSize).replaceAll(" ", "\n");
}

/** Parse a compact JSON string back into pixelData 2D array. */
export function jsonToPixelData(json: string, gridSize = 16): { gridSize: number; pixelData: string[][] } | null {
  try {
    const pixelData: string[][] = Array.from({ length: gridSize }, () =>
      Array(gridSize).fill("transparent")
    );
    const pattern = /\[(\d+),(\d+)\]\s*=\s*(#[0-9A-Fa-f]{6})/g;
    let match;
    while ((match = pattern.exec(json)) !== null) {
      const x = parseInt(match[1]);
      const y = parseInt(match[2]);
      const color = match[3].toUpperCase();
      if (y >= 0 && y < gridSize && x >= 0 && x < gridSize) {
        pixelData[y][x] = color;
      }
    }
    return { gridSize, pixelData };
  } catch {
    return null;
  }
}

/** Download a string as a file. */
export function downloadAsFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Convert on-chain pixelData back to SVG string. Accepts text, packed-hex (RLE), and legacy PNG base64. */
export function pixelDataToSVG(pixelData: string, gridSize: number): string {
  if (!pixelData) return "";

  // Packed binary hex (RLE: 12 chars/run = xyRGB counts; legacy per-pixel: 10 chars)
  if (/^(0x)?[0-9a-fA-F]+$/.test(pixelData)) {
    const clean = pixelData.startsWith("0x") ? pixelData.slice(2) : pixelData;
    if (clean.length === 0) return "";
    if (clean.length % 12 === 0) {
      const text = packedBytesToOnchainText(pixelData);
      if (text) return renderTextToSVG(text, gridSize);
    }
    return "";
  }

  // Legacy text format: [x,y]=#RRGGBB
  return renderTextToSVG(pixelData, gridSize);
}

function renderTextToSVG(text: string, gridSize: number): string {
  const rects: string[] = [];
  const re = /\[(\d+),(\d+)\]\s*=\s*(#[0-9A-Fa-f]{6})/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const x = parseInt(match[1]);
    const y = parseInt(match[2]);
    const color = match[3];
    rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`);
  }
  if (rects.length === 0) return "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${gridSize}" height="${gridSize}" viewBox="0 0 ${gridSize} ${gridSize}" shape-rendering="crispEdges">${rects.join("")}</svg>`;
  // Use Buffer in Node (server/Edge), fall back to btoa in the browser.
  const encoded =
    typeof Buffer !== "undefined"
      ? Buffer.from(svg, "utf-8").toString("base64")
      : btoa(svg);
  return `data:image/svg+xml;base64,${encoded}`;
}

/** Download pixelData as a PNG file. */
export function downloadAsPNG(pixelData: string[][], gridSize: number, filename = "pixel-art.png") {
  const base64 = pixelDataToPNG(pixelData, gridSize);
  if (!base64) return;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "image/png" });
  downloadAsFileBlob(blob, filename);
}

/** Download pixelData as a compact JSON file. */
export function downloadAsJSON(pixelData: string[][], gridSize: number, filename = "pixel-art.txt") {
  const content = pixelDataToJSON(pixelData, gridSize);
  const blob = new Blob([content], { type: "text/plain" });
  downloadAsFileBlob(blob, filename);
}

function downloadAsFileBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
