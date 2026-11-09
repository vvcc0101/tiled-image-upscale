var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// <stdin>
var stdin_exports = {};
__export(stdin_exports, {
  TILED_UPSCALE_PROMPT: () => TILED_UPSCALE_PROMPT,
  TILED_UPSCALE_VERSION: () => TILED_UPSCALE_VERSION,
  assertTiledUpscaleDiskBudget: () => assertTiledUpscaleDiskBudget,
  assertTiledUpscaleMemoryBudget: () => assertTiledUpscaleMemoryBudget,
  buildTiledUpscalePlan: () => buildTiledUpscalePlan,
  normalizeTiledUpscaleSource: () => normalizeTiledUpscaleSource,
  readTiledUpscaleCrop: () => readTiledUpscaleCrop,
  stitchTiledUpscaleImages: () => stitchTiledUpscaleImages,
  validateTiledUpscaleGenerated: () => validateTiledUpscaleGenerated
});
module.exports = __toCommonJS(stdin_exports);

// src/main/tiled-upscale-images.ts
var import_sharp = __toESM(require("sharp"));
var import_node_crypto = require("node:crypto");
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var import_node_os = require("node:os");

// src/shared/tiledUpscale.ts
var TILED_UPSCALE_VERSION = 1;
var TILED_UPSCALE_SCALES = [2, 3, 4, 6, 8, 10];
var TILED_UPSCALE_TARGET_TILE_SIZE = 2048;
var TILED_UPSCALE_MAX_PIXELS = 1e8;
var TILED_UPSCALE_MAX_SIDE = 2e4;
var TILED_UPSCALE_MAX_TILES = 256;
var isScale = (value) => TILED_UPSCALE_SCALES.some((scale) => scale === value);
var starts = (length, side, overlap) => {
  if (length <= side) return [0];
  const intervals = Math.ceil((length - side) / (side - overlap));
  return Array.from(
    { length: intervals + 1 },
    (_, index) => Math.round(index * (length - side) / intervals)
  );
};
function buildTiledUpscalePlan(input) {
  const { width, height, scale } = input;
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("\u56FE\u7247\u5C3A\u5BF8\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u539F\u56FE\u3002");
  }
  if (!isScale(scale)) throw new Error("\u8BF7\u9009\u62E9\u652F\u6301\u7684\u653E\u5927\u500D\u7387\u3002");
  const targetWidth = width * scale;
  const targetHeight = height * scale;
  if (targetWidth > TILED_UPSCALE_MAX_SIDE || targetHeight > TILED_UPSCALE_MAX_SIDE) {
    throw new Error("\u653E\u5927\u540E\u8FB9\u957F\u8D85\u8FC7 20000 \u50CF\u7D20\uFF0C\u8BF7\u964D\u4F4E\u500D\u7387\u3002");
  }
  if (targetWidth * targetHeight > TILED_UPSCALE_MAX_PIXELS) {
    throw new Error("\u653E\u5927\u540E\u8D85\u8FC7 1 \u4EBF\u50CF\u7D20\uFF0C\u8BF7\u964D\u4F4E\u500D\u7387\u3002");
  }
  const tileSize = Math.max(192, Math.floor(TILED_UPSCALE_TARGET_TILE_SIZE / scale));
  const overlap = Math.floor(tileSize * 0.2);
  const xs = starts(width, tileSize, overlap);
  const ys = starts(height, tileSize, overlap);
  if (xs.length * ys.length > TILED_UPSCALE_MAX_TILES) {
    throw new Error("\u9884\u8BA1\u5206\u5757\u8FC7\u591A\uFF0C\u8BF7\u964D\u4F4E\u500D\u7387\u3002");
  }
  return {
    sourceWidth: width,
    sourceHeight: height,
    targetWidth,
    targetHeight,
    scale,
    tileSize,
    overlap,
    tiles: ys.flatMap(
      (y, row) => xs.map((x, col) => ({
        id: `r${row + 1}c${col + 1}`,
        x,
        y,
        width: Math.min(tileSize, width - x),
        height: Math.min(tileSize, height - y)
      }))
    )
  };
}

// src/main/tiled-upscale-images.ts
var nativePath = (path) => process.platform === "win32" ? (0, import_node_path.toNamespacedPath)(path) : path;
function assertTiledUpscaleMemoryBudget(plan, available = (0, import_node_os.freemem)()) {
  const estimate = 192 * 1024 ** 2 + plan.targetWidth * 128 * 24 + plan.sourceWidth * plan.sourceHeight * 5 + plan.targetWidth * plan.targetHeight * 8;
  if (available < estimate * 1.25)
    throw new Error("\u53EF\u7528\u5185\u5B58\u4E0D\u8DB3\u4EE5\u5B8C\u6210\u672C\u6B21\u62FC\u63A5\uFF0C\u8BF7\u964D\u4F4E\u500D\u7387\u6216\u5173\u95ED\u5176\u4ED6\u7A0B\u5E8F\u3002");
}
function assertTiledUpscaleDiskBudget(plan, available) {
  const tilePixels = (plan.tileSize * plan.scale) ** 2 * plan.tiles.length;
  const required = 64 * 1024 ** 2 + tilePixels * 8 + plan.targetWidth * plan.targetHeight * 12 + plan.sourceWidth * plan.sourceHeight * 8;
  if (available < required) throw new Error("\u9879\u76EE\u78C1\u76D8\u7A7A\u95F4\u4E0D\u8DB3\uFF0C\u8BF7\u91CA\u653E\u7A7A\u95F4\u540E\u91CD\u8BD5\u6216\u964D\u4F4E\u500D\u7387\u3002");
}
async function normalizeTiledUpscaleSource(input) {
  const metadata = await (0, import_sharp.default)(nativePath(input.sourcePath), {
    limitInputPixels: 1e8
  }).metadata();
  const rotated = metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  if (!width || !height) throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u539F\u56FE\u5C3A\u5BF8\u3002");
  const plan = buildTiledUpscalePlan({ width, height, scale: input.scale });
  assertTiledUpscaleMemoryBudget(plan);
  const disk = await (0, import_promises.statfs)((0, import_node_path.dirname)(input.outputPath));
  assertTiledUpscaleDiskBudget(plan, disk.bavail * disk.bsize);
  await (0, import_promises.mkdir)((0, import_node_path.dirname)(input.outputPath), { recursive: true });
  await (0, import_sharp.default)(nativePath(input.sourcePath), { limitInputPixels: 1e8 }).rotate().png().toFile(nativePath(input.outputPath));
  const digest = (0, import_node_crypto.createHash)("sha256").update(await (0, import_promises.readFile)(input.outputPath)).digest("hex");
  return { plan, digest };
}
var findTile = (plan, id) => {
  const tile = plan.tiles.find((item) => item.id === id);
  if (!tile) throw new Error("\u65E0\u6548\u5206\u5757\u3002");
  return tile;
};
var sourceCrop = (sourcePath, plan, tile) => (0, import_sharp.default)(nativePath(sourcePath)).extract({ left: tile.x, top: tile.y, width: tile.width, height: tile.height }).extend({
  top: 0,
  left: 0,
  right: plan.tileSize - tile.width,
  bottom: plan.tileSize - tile.height,
  extendWith: "copy"
});
async function readTiledUpscaleCrop(input) {
  const tile = findTile(input.plan, input.tileId);
  const [crop, context] = await Promise.all([
    sourceCrop(input.sourcePath, input.plan, tile).png().toBuffer(),
    (0, import_sharp.default)(nativePath(input.sourcePath)).resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).png().toBuffer()
  ]);
  return {
    imageDataUrl: `data:image/png;base64,${crop.toString("base64")}`,
    contextDataUrl: `data:image/png;base64,${context.toString("base64")}`
  };
}
async function validateTiledUpscaleGenerated(path, reference) {
  const meta = await (0, import_sharp.default)(nativePath(path), { limitInputPixels: 25e6 }).metadata();
  if (!meta.width || !meta.height || meta.width < 32 || meta.height < 32 || Math.abs(meta.width / meta.height - 1) > 0.025)
    throw new Error("\u751F\u6210\u5206\u5757\u6BD4\u4F8B\u4E0E\u539F\u88C1\u526A\u4E0D\u7B26\uFF0C\u8BF7\u91CD\u8BD5\u8BE5\u5206\u5757\u6216\u66F4\u6362\u56FE\u751F\u56FE\u6A21\u578B\u3002");
  await (0, import_sharp.default)(nativePath(path), { limitInputPixels: 25e6, failOn: "warning" }).resize(32, 32).raw().toBuffer();
  if (reference) {
    const tile = findTile(reference.plan, reference.tileId);
    const side = Math.min(128, reference.plan.tileSize);
    const crop = await sourceCrop(reference.sourcePath, reference.plan, tile).png().toBuffer();
    const [original, generated] = await Promise.all([
      (0, import_sharp.default)(crop).flatten({ background: "#808080" }).resize(side, side).greyscale().raw().toBuffer(),
      (0, import_sharp.default)(nativePath(path)).flatten({ background: "#808080" }).resize(side, side).greyscale().raw().toBuffer()
    ]);
    translation(original, generated, side);
  }
  return { nativeWidth: meta.width, nativeHeight: meta.height };
}
function translation(reference, generated, side) {
  const margin = 5;
  const score = (dx, dy) => {
    let a = 0, b = 0, aa = 0, bb = 0, ab = 0, n = 0;
    for (let y = margin; y < side - margin; y++)
      for (let x = margin; x < side - margin; x++) {
        const av = reference[y * side + x], bv = generated[(y + dy) * side + x + dx];
        a += av;
        b += bv;
        aa += av * av;
        bb += bv * bv;
        ab += av * bv;
        n++;
      }
    const va = aa - a * a / n, vb = bb - b * b / n;
    return {
      correlation: va < 1 || vb < 1 ? 0 : (ab - a * b / n) / Math.sqrt(va * vb),
      variance: va / n,
      generatedVariance: vb / n
    };
  };
  const initial = score(0, 0);
  if (initial.variance < 12) {
    if (initial.generatedVariance > Math.max(40, initial.variance * 5))
      throw new Error("\u751F\u6210\u5206\u5757\u65B0\u589E\u4E86\u539F\u56FE\u4E0D\u5B58\u5728\u7684\u7ED3\u6784\uFF0C\u8BF7\u91CD\u8BD5\u8BE5\u5206\u5757\u6216\u66F4\u6362\u6A21\u578B\u3002");
    return { x: 0, y: 0 };
  }
  let best = { x: 0, y: 0, correlation: initial.correlation };
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const candidate = score(dx, dy);
      if (candidate.correlation > best.correlation + 1e-4)
        best = { x: dx, y: dy, correlation: candidate.correlation };
    }
  if (best.correlation < 0.58 || initial.generatedVariance < 1)
    throw new Error("\u751F\u6210\u5206\u5757\u4E0E\u539F\u56FE\u7ED3\u6784\u5DEE\u5F02\u8FC7\u5927\uFF0C\u8BF7\u91CD\u8BD5\u8BE5\u5206\u5757\u6216\u66F4\u6362\u6A21\u578B\u3002");
  if (initial.correlation > 0.96 || best.correlation < initial.correlation + 8e-3)
    return { x: 0, y: 0 };
  if (Math.abs(best.x) === 3 || Math.abs(best.y) === 3)
    throw new Error("\u751F\u6210\u5206\u5757\u53D1\u751F\u660E\u663E\u4F4D\u7F6E\u504F\u79FB\uFF0C\u65E0\u6CD5\u53EF\u9760\u62FC\u63A5\uFF0C\u8BF7\u91CD\u8BD5\u3002");
  return best;
}
async function prepareAlignedTile(input) {
  const { plan, tile } = input;
  const native = await validateTiledUpscaleGenerated(input.generatedPath);
  const side = plan.tileSize * plan.scale;
  const sampleSide = Math.min(128, plan.tileSize);
  const cropBytes = await sourceCrop(input.sourcePath, plan, tile).png().toBuffer();
  const [referenceGray, generatedGray] = await Promise.all([
    (0, import_sharp.default)(cropBytes).flatten({ background: "#808080" }).resize(sampleSide, sampleSide).greyscale().raw().toBuffer(),
    (0, import_sharp.default)(nativePath(input.generatedPath)).flatten({ background: "#808080" }).resize(sampleSide, sampleSide).greyscale().raw().toBuffer()
  ]);
  const offset = translation(referenceGray, generatedGray, sampleSide);
  const dx = Math.round(offset.x * side / sampleSide), dy = Math.round(offset.y * side / sampleSide);
  const [reference, generated] = await Promise.all([
    (0, import_sharp.default)(cropBytes).resize(side, side).ensureAlpha().raw().toBuffer(),
    (0, import_sharp.default)(nativePath(input.generatedPath)).resize(side, side).ensureAlpha().raw().toBuffer()
  ]);
  const aligned = Buffer.alloc(reference.length);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const i = (y * side + x) * 4, j = (Math.max(0, Math.min(side - 1, y + dy)) * side + Math.max(0, Math.min(side - 1, x + dx))) * 4;
      aligned[i] = generated[j];
      aligned[i + 1] = generated[j + 1];
      aligned[i + 2] = generated[j + 2];
      aligned[i + 3] = reference[i + 3];
    }
  const raw = { width: side, height: side, channels: 4 };
  const [refBlur, genBlur] = await Promise.all([
    (0, import_sharp.default)(reference, { raw }).blur(12).raw().toBuffer(),
    (0, import_sharp.default)(aligned, { raw }).blur(12).raw().toBuffer()
  ]);
  for (let i = 0; i < aligned.length; i += 4)
    for (let c = 0; c < 3; c++)
      aligned[i + c] = Math.max(
        0,
        Math.min(
          255,
          Math.round(
            reference[i + c] + 0.85 * (aligned[i + c] - genBlur[i + c] - reference[i + c] + refBlur[i + c])
          )
        )
      );
  await (0, import_sharp.default)(aligned, { raw }).extract({ left: 0, top: 0, width: tile.width * plan.scale, height: tile.height * plan.scale }).png().toFile(nativePath(input.outputPath));
  return native.nativeWidth < side || native.nativeHeight < side;
}
function axisWeight(position, length, before, after) {
  let weight = 1;
  if (before > 0 && position < before)
    weight *= Math.sin(Math.PI * 0.5 * (position + 0.5) / before) ** 2;
  if (after > 0 && position >= length - after)
    weight *= Math.sin(Math.PI * 0.5 * (length - position - 0.5) / after) ** 2;
  return weight;
}
function tileOverlap(plan, tile) {
  let left = 0, right = 0, top = 0, bottom = 0;
  for (const other of plan.tiles) {
    if (other.y === tile.y) {
      if (other.x < tile.x) left = Math.max(left, other.x + other.width - tile.x);
      if (other.x > tile.x) right = Math.max(right, tile.x + tile.width - other.x);
    }
    if (other.x === tile.x) {
      if (other.y < tile.y) top = Math.max(top, other.y + other.height - tile.y);
      if (other.y > tile.y) bottom = Math.max(bottom, tile.y + tile.height - other.y);
    }
  }
  return {
    left: left * plan.scale,
    right: right * plan.scale,
    top: top * plan.scale,
    bottom: bottom * plan.scale
  };
}
async function stitchTiledUpscaleImages(input) {
  const { plan } = input;
  assertTiledUpscaleMemoryBudget(plan);
  await (0, import_promises.mkdir)((0, import_node_path.dirname)(input.outputPath), { recursive: true });
  const disk = await (0, import_promises.statfs)((0, import_node_path.dirname)(input.outputPath));
  assertTiledUpscaleDiskBudget(plan, disk.bavail * disk.bsize);
  for (const tile of plan.tiles)
    if (!input.tilePaths[tile.id]) throw new Error("\u7F3A\u5C11\u5DF2\u5B8C\u6210\u5206\u5757\uFF0C\u4E0D\u80FD\u8F93\u51FA\u5B8C\u6574\u56FE\u7247\u3002");
  const tempDir = (0, import_node_path.join)((0, import_node_path.dirname)(input.outputPath), `.stitch-${(0, import_node_crypto.randomUUID)()}`);
  await (0, import_promises.mkdir)(tempDir, { recursive: true });
  const rawPath = (0, import_node_path.join)(tempDir, "output.rgba");
  let interpolated = false;
  try {
    for (const tile of plan.tiles) {
      const generatedPath = input.tilePaths[tile.id];
      interpolated = await prepareAlignedTile({
        ...input,
        tile,
        generatedPath,
        outputPath: (0, import_node_path.join)(tempDir, tile.id + ".png")
      }) || interpolated;
    }
    const handle = await (0, import_promises.open)(rawPath, "w");
    try {
      for (let y = 0; y < plan.targetHeight; y += 128) {
        const height = Math.min(128, plan.targetHeight - y);
        const pixelCount = height * plan.targetWidth;
        const colors = new Float32Array(pixelCount * 3), weights = new Float32Array(pixelCount);
        for (const tile of plan.tiles) {
          const tx = tile.x * plan.scale, ty = tile.y * plan.scale, tw = tile.width * plan.scale, th = tile.height * plan.scale;
          const start = Math.max(y, ty), end = Math.min(y + height, ty + th);
          if (start >= end) continue;
          const strip = await (0, import_sharp.default)(nativePath((0, import_node_path.join)(tempDir, tile.id + ".png"))).extract({ left: 0, top: start - ty, width: tw, height: end - start }).ensureAlpha().raw().toBuffer();
          const fade = tileOverlap(plan, tile);
          for (let row = start; row < end; row++)
            for (let x = 0; x < tw; x++) {
              const weight = axisWeight(x, tw, fade.left, fade.right) * axisWeight(row - ty, th, fade.top, fade.bottom);
              const i = (row - y) * plan.targetWidth + tx + x, j = ((row - start) * tw + x) * 4;
              weights[i] += weight;
              for (let c = 0; c < 3; c++) colors[i * 3 + c] += strip[j + c] * weight;
            }
        }
        const original = await (0, import_sharp.default)(nativePath(input.sourcePath)).resize(plan.targetWidth, plan.targetHeight).extract({ left: 0, top: y, width: plan.targetWidth, height }).ensureAlpha().raw().toBuffer();
        for (let i = 0; i < pixelCount; i++) {
          if (weights[i] <= 0) throw new Error("\u5206\u5757\u672A\u8986\u76D6\u5168\u90E8\u753B\u9762\uFF0C\u65E0\u6CD5\u5B8C\u6210\u62FC\u63A5\u3002");
          for (let c = 0; c < 3; c++)
            original[i * 4 + c] = Math.max(
              0,
              Math.min(255, Math.round(colors[i * 3 + c] / weights[i]))
            );
        }
        await handle.write(original);
      }
    } finally {
      await handle.close();
    }
    const pending = (0, import_node_path.join)(tempDir, "result.png");
    await (0, import_sharp.default)(await (0, import_promises.readFile)(rawPath), {
      raw: { width: plan.targetWidth, height: plan.targetHeight, channels: 4 },
      limitInputPixels: 1e8
    }).png().toFile(nativePath(pending));
    await (0, import_promises.rename)(pending, input.outputPath);
    return {
      width: plan.targetWidth,
      height: plan.targetHeight,
      warning: interpolated ? "\u90E8\u5206\u5206\u5757\u5B9E\u9645\u51FA\u56FE\u5C3A\u5BF8\u4F4E\u4E8E\u76EE\u6807\u5C3A\u5BF8\uFF0C\u6210\u54C1\u5305\u542B\u63D2\u503C\u653E\u5927\u3002" : ""
    };
  } finally {
    await (0, import_promises.rm)(tempDir, { recursive: true, force: true });
  }
}

// src/renderer/src/lib/tiledUpscaleRuntime.ts
var TILED_UPSCALE_PROMPT_VERSION = `tiled-restore-${TILED_UPSCALE_VERSION}`;
var TILED_UPSCALE_PROMPT = `Faithfully restore and upscale IMAGE 1, an overlapping square crop of a larger image. If IMAGE 2 is present, it is the full image for identity, colors and lighting context ONLY. Output ONLY the exact square field of view of IMAGE 1. Keep every feature at the same relative pixel position. Do not reframe, zoom, rotate, add margins, warp, change composition or change the subject's identity or expression. Preserve facial proportions, eyes, mouth, teeth, anatomy, hair silhouette, clothing, text, logos, straight lines, lighting, colors and depth of field. Enhance subtle natural microtexture, hair and material detail without beautification, makeup, plastic skin, exaggerated pores, invented objects, oversharpening or halos. Preserve intentionally defocused areas. The result will be stitched to neighboring crops and must retain the original geometry. Output one square image only, with no annotations or border.`;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TILED_UPSCALE_PROMPT,
  TILED_UPSCALE_VERSION,
  assertTiledUpscaleDiskBudget,
  assertTiledUpscaleMemoryBudget,
  buildTiledUpscalePlan,
  normalizeTiledUpscaleSource,
  readTiledUpscaleCrop,
  stitchTiledUpscaleImages,
  validateTiledUpscaleGenerated
});
