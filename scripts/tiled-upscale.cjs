#!/usr/bin/env node
"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const core = require("./image-core.cjs");
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
const fileHash = async (file) => sha(await fs.readFile(file));
const rootDir = path.dirname(__dirname);
let stopped = false,
  child;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopped = true;
    if (child) child.kill();
  });
function checkStop() {
  if (stopped)
    throw new Error("已停止；已提交请求可能仍会完成并计费，请检查未确定分块。");
}
function args(argv) {
  const result = { command: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error("无效参数：" + key);
    const next = argv[i + 1];
    result[key.slice(2)] = next && !next.startsWith("--") ? argv[++i] : true;
  }
  return result;
}
const positive = (value, fallback) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error("参数必须为正整数。");
  return n;
};
const exists = (p) =>
  fs.access(p).then(
    () => true,
    () => false,
  );
const atomic = async (p, object) => {
  const temp = p + "." + crypto.randomUUID() + ".tmp";
  await fs.writeFile(temp, JSON.stringify(object, null, 2) + "\n", {
    flag: "wx",
  });
  try {
    await fs.rename(temp, p);
  } finally {
    await fs.rm(temp, { force: true });
  }
};
async function lock(work, action) {
  await fs.mkdir(work, { recursive: true });
  const lockPath = path.join(work, ".lock");
  let handle;
  try {
    handle = await fs.open(lockPath, "wx");
  } catch {
    throw new Error(
      "工作目录已被锁定。确认没有其他进程运行后，才可移除 .lock。",
    );
  }
  await handle.writeFile(String(process.pid));
  try {
    return await action();
  } finally {
    await handle.close();
    await fs.rm(lockPath, { force: true });
  }
}
function local(work, relative) {
  if (typeof relative !== "string") throw new Error("无效工作清单路径。");
  const file = path.resolve(work, relative);
  if (!file.startsWith(work + path.sep))
    throw new Error("工作清单路径超出工作目录。");
  return file;
}
async function load(work) {
  const manifest = JSON.parse(
    await fs.readFile(path.join(work, "manifest.json"), "utf8"),
  );
  if (
    manifest.version !== 1 ||
    !manifest.config ||
    !Array.isArray(manifest.tiles)
  )
    throw new Error("工作清单版本不受支持。");
  const source = path.join(work, "source.png");
  if ((await fileHash(source)) !== manifest.sourceHash)
    throw new Error("工作原图已变化，不能复用旧分块。请使用新的工作目录。");
  const expected = core.buildTiledUpscalePlan({
    width: manifest.plan.sourceWidth,
    height: manifest.plan.sourceHeight,
    scale: manifest.plan.scale,
  });
  if (
    JSON.stringify(expected) !== JSON.stringify(manifest.plan) ||
    manifest.tiles.length !== expected.tiles.length ||
    manifest.tiles.some((tile, i) => tile.id !== expected.tiles[i].id)
  )
    throw new Error("分块计划被修改，请恢复原清单或使用新工作目录。");
  if (
    sha(
      JSON.stringify({
        sourceHash: manifest.sourceHash,
        plan: manifest.plan,
        config: manifest.config,
      }),
    ) !== manifest.identity
  )
    throw new Error("任务配置已变化，不能复用旧分块。");
  return manifest;
}
const save = (work, m) => atomic(path.join(work, "manifest.json"), m);
async function validTile(work, m, tile) {
  const record = m.completed[tile.id];
  if (!record) return null;
  try {
    const file = local(work, record.file);
    if ((await fileHash(file)) !== record.sha256) return null;
    const size = await core.validateTiledUpscaleGenerated(file, {
      sourcePath: path.join(work, "source.png"),
      plan: m.plan,
      tileId: tile.id,
    });
    return { file, ...size };
  } catch {
    return null;
  }
}
async function summary(work, m) {
  const complete = [],
    missing = [],
    native = [];
  for (const tile of m.tiles) {
    const found = await validTile(work, m, tile);
    if (found) {
      complete.push(tile.id);
      native.push({
        id: tile.id,
        width: found.nativeWidth,
        height: found.nativeHeight,
      });
    } else missing.push(tile.id);
  }
  return {
    ok: true,
    workDir: work,
    target: [m.plan.targetWidth, m.plan.targetHeight],
    scale: m.plan.scale,
    total: m.tiles.length,
    completed: complete.length,
    remaining: missing.length,
    completedTileIds: complete,
    missingTileIds: missing,
    nativeSizes: native,
    model: m.config.model,
    inFlight: m.inFlight || null,
    estimatedNewRequests: missing.length,
    warning:
      "请求尺寸不保证实际生成尺寸。缺块不能导出成品；尺寸不足的块可能包含插值。",
  };
}
async function prepare(work, a) {
  if (typeof a.input !== "string")
    throw new Error("prepare 需要 --input 原图。");
  const input = path.resolve(a.input);
  const scale = positive(a.scale, 2),
    size = positive(a.size, 2048),
    refs = positive(a.references, 2);
  if (size > 8192 || refs > 2)
    throw new Error("--size 不超过8192，--references 仅支持1或2。");
  const prompt =
    typeof a["prompt-file"] === "string"
      ? await fs.readFile(path.resolve(a["prompt-file"]), "utf8")
      : core.TILED_UPSCALE_PROMPT;
  const providerScript = path.resolve(
    typeof a["provider-script"] === "string"
      ? a["provider-script"]
      : path.join(
          rootDir,
          "..",
          "image-gen",
          "scripts",
          "node",
          "image-gen.js",
        ),
  );
  const config = {
    model: String(a.model || "gpt-image-2.5-sunburst"),
    size,
    quality: String(a.quality || "high"),
    references: refs,
    prompt,
    providerScript,
    timeout: positive(a.timeout, 900),
    coreVersion: core.TILED_UPSCALE_VERSION,
  };
  if (await exists(providerScript))
    config.providerScriptHash = await fileHash(providerScript);
  const temporary = path.join(
    work,
    "source.pending." + crypto.randomUUID() + ".png",
  );
  try {
    const normalized = await core.normalizeTiledUpscaleSource({
      sourcePath: input,
      outputPath: temporary,
      scale,
    });
    const identity = sha(
      JSON.stringify({
        sourceHash: normalized.digest,
        plan: normalized.plan,
        config,
      }),
    );
    if (await exists(path.join(work, "manifest.json"))) {
      const old = await load(work);
      if (old.identity !== identity)
        throw new Error(
          "此工作目录已有不同原图、倍率或模型配置。请使用新的 --work-dir，原有缓存已保留。",
        );
      return summary(work, old);
    }
    await fs.rename(temporary, path.join(work, "source.png"));
    await fs.mkdir(path.join(work, "crops"), { recursive: true });
    await fs.mkdir(path.join(work, "generated"), { recursive: true });
    const tiles = [];
    for (const tile of normalized.plan.tiles) {
      checkStop();
      const images = await core.readTiledUpscaleCrop({
        sourcePath: path.join(work, "source.png"),
        plan: normalized.plan,
        tileId: tile.id,
      });
      const relative = "crops/" + tile.id + ".png";
      await fs.writeFile(
        local(work, relative),
        Buffer.from(images.imageDataUrl.split(",")[1], "base64"),
      );
      if (!tiles.length)
        await fs.writeFile(
          path.join(work, "context.png"),
          Buffer.from(images.contextDataUrl.split(",")[1], "base64"),
        );
      tiles.push({
        ...tile,
        crop: relative,
        cropHash: await fileHash(local(work, relative)),
      });
    }
    const manifest = {
      version: 1,
      identity,
      sourceHash: normalized.digest,
      sourceInput: input,
      plan: normalized.plan,
      config,
      tiles,
      completed: {},
      inFlight: null,
    };
    await save(work, manifest);
    return summary(work, manifest);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
async function accept(work, m, id, image) {
  const tile = m.tiles.find((tile) => tile.id === id);
  if (!tile) throw new Error("未知分块编号。");
  const native = await core.validateTiledUpscaleGenerated(image, {
    sourcePath: path.join(work, "source.png"),
    plan: m.plan,
    tileId: id,
  });
  const file = "generated/" + id + ".png",
    destination = local(work, file),
    temp = destination + "." + crypto.randomUUID() + ".tmp";
  await fs.copyFile(image, temp);
  try {
    await fs.rename(temp, destination);
  } finally {
    await fs.rm(temp, { force: true });
  }
  m.completed[id] = {
    file,
    sha256: await fileHash(destination),
    ...native,
    acceptedAt: new Date().toISOString(),
  };
  if (m.inFlight?.tileId === id) m.inFlight = null;
  await save(work, m);
}
function providerEnvironment() {
  const env = { ...process.env };
  if (!env.IMAGE_GEN_API_KEY && process.platform === "win32") {
    try {
      env.IMAGE_GEN_API_KEY = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[Environment]::GetEnvironmentVariable('IMAGE_GEN_API_KEY','User')",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
    } catch {
      throw new Error("无法读取 Windows 用户环境中的 IMAGE_GEN_API_KEY。");
    }
  }
  if (!env.IMAGE_GEN_API_KEY)
    throw new Error(
      "缺少 IMAGE_GEN_API_KEY。请配置专用环境变量；不要把密钥放进参数或文件。",
    );
  return env;
}
async function invokeProvider(script, argv, env) {
  checkStop();
  const { handleProviderResult } = require('./provider-result.cjs');
  const output = argv[argv.lastIndexOf('--out') + 1];
  if (!output) throw new Error('缺少生图输出路径。');
  await new Promise((resolve, reject) => {
    const streams = { stdout: [], stderr: [] };
    const counts = { stdout: 0, stderr: 0 };
    const maxBytes = 32 * 1024 * 1024;
    let truncated = false;
    child = spawn(process.execPath, [script, ...argv], {
      env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false,
    });
    for (const name of ['stdout', 'stderr']) {
      child[name].on('data', (chunk) => {
        const bytes = Buffer.from(chunk);
        const remaining = maxBytes - counts[name];
        if (bytes.length > remaining) truncated = true;
        if (remaining > 0) {
          streams[name].push(bytes.subarray(0, remaining));
          counts[name] += Math.min(bytes.length, remaining);
        }
      });
    }
    child.once('error', () => {
      child = null;
      reject(new Error('无法启动 image-gen 生图脚本。'));
    });
    child.once('close', (code) => {
      child = null;
      if (stopped) {
        reject(new Error('已停止；当前请求状态未确定，重试可能重复计费。'));
        return;
      }
      handleProviderResult({
        code, output, truncated,
        stdout: Buffer.concat(streams.stdout).toString('utf8'),
        stderr: Buffer.concat(streams.stderr).toString('utf8'),
        secret: env.IMAGE_GEN_API_KEY || '',
      }).then((result) => {
        if (result.recovered)
          process.stderr.write('已从截断的流式消息救回完整图片，未补发生图请求。\n');
        resolve();
      }, reject);
    });
  });
}
async function generate(work, m, a) {
  const provider = m.config.providerScript;
  if (!(await exists(provider)))
    throw new Error(
      "找不到 image-gen 脚本，请用 prepare --provider-script 指定已安装脚本，并使用新工作目录。",
    );
  if (
    m.config.providerScriptHash &&
    (await fileHash(provider)) !== m.config.providerScriptHash
  )
    throw new Error(
      "生图脚本已变化，请使用新的工作目录，避免混用不同路由的缓存。",
    );
  const limit = positive(a["max-new"], m.tiles.length),
    env = providerEnvironment();
  const recoveryTile = m.inFlight
    ? m.tiles.find((tile) => tile.id === m.inFlight.tileId)
    : null;
  if (m.inFlight && !recoveryTile)
    throw new Error("未确定请求的分块编号无效，请检查清单。");
  const orderedTiles = recoveryTile
    ? [recoveryTile, ...m.tiles.filter((tile) => tile.id !== recoveryTile.id)]
    : m.tiles;
  let submitted = 0;
  for (const tile of orderedTiles) {
    checkStop();
    if (await validTile(work, m, tile)) {
      if (m.inFlight?.tileId === tile.id) {
        m.inFlight = null;
        await save(work, m);
      }
      continue;
    }
    const pending = path.join(work, "generated", tile.id + ".pending.png");
    if (m.inFlight?.tileId === tile.id) {
      if (await exists(pending)) {
        try {
          await accept(work, m, tile.id, pending);
          await fs.rm(pending, { force: true });
          continue;
        } catch {}
      }
      if (!a["retry-uncertain"])
        throw new Error(
          "分块 " +
            tile.id +
            " 的上次请求状态未确定。先查询供应商或导入结果；明确决定补发时加 --retry-uncertain，可能重复计费。",
        );
      if (await exists(pending))
        await fs.rename(pending, pending + ".rejected." + crypto.randomUUID());
    }
    if (submitted >= limit) break;
    const crop = local(work, tile.crop);
    if ((await fileHash(crop)) !== tile.cropHash)
      throw new Error("裁剪文件已变化，停止提交。");
    if (await exists(pending))
      throw new Error(
        "存在未登记生成文件，请先检查并 import，避免覆盖已有结果。",
      );
    m.inFlight = { tileId: tile.id, startedAt: new Date().toISOString() };
    await save(work, m);
    const argv = [
      "--mode",
      "image-prompt",
      "--prompt",
      m.config.prompt,
      "--model",
      m.config.model,
      "--size",
      m.config.size + "x" + m.config.size,
      "--quality",
      m.config.quality,
      "--n",
      "1",
      "--timeout",
      String(m.config.timeout),
      "--image",
      crop,
    ];
    if (m.config.references === 2)
      argv.push("--image", path.join(work, "context.png"));
    argv.push("--out", pending);
    submitted++;
    await invokeProvider(provider, argv, env);
    checkStop();
    await accept(work, m, tile.id, pending);
    await fs.rm(pending, { force: true });
    process.stderr.write("已缓存 " + tile.id + "\n");
  }
  return { ...(await summary(work, m)), submittedThisRun: submitted };
}
async function stitch(work, m, a) {
  const state = await summary(work, m);
  if (state.remaining)
    throw new Error(
      "仍缺少 " + state.remaining + " 个有效分块，不能导出成品。",
    );
  const side = m.plan.tileSize * m.plan.scale;
  const undersized = state.nativeSizes.some(
    (tile) => tile.width < side || tile.height < side,
  );
  if (a["no-interpolation"] && undersized)
    throw new Error("存在尺寸不足的分块，--no-interpolation 禁止插值输出。");
  const output = path.resolve(
    typeof a.output === "string" ? a.output : path.join(work, "result.png"),
  );
  if (
    [path.join(work, "source.png"), m.sourceInput].includes(output) ||
    output === path.join(work, "manifest.json") ||
    output.startsWith(path.join(work, "generated") + path.sep) ||
    output.startsWith(path.join(work, "crops") + path.sep)
  )
    throw new Error("输出路径不能覆盖原图或分块缓存。");
  if ((await exists(output)) && !a.overwrite)
    throw new Error("输出文件已存在；请选择新路径，或明确使用 --overwrite。");
  const tilePaths = Object.fromEntries(
    m.tiles.map((tile) => [tile.id, local(work, m.completed[tile.id].file)]),
  );
  const result = await core.stitchTiledUpscaleImages({
    sourcePath: path.join(work, "source.png"),
    plan: m.plan,
    tilePaths,
    outputPath: output,
  });
  m.output = { path: output, ...result, sha256: await fileHash(output) };
  await save(work, m);
  return { ok: true, output, ...result, nativeSizes: state.nativeSizes };
}
async function main() {
  const a = args(process.argv.slice(2));
  if (!a.command || a.command === "help" || a.command === "--help" || a.help) {
    console.log(
      "tiled-upscale: prepare --input FILE --scale 2|3|4|6|8|10 --work-dir DIR [--model MODEL --size 2048 --quality high --references 2 --provider-script FILE]\nstatus --work-dir DIR\nimport --work-dir DIR --tile r1c1 --image FILE\ngenerate --work-dir DIR [--max-new N] [--retry-uncertain]\nstitch --work-dir DIR --output FILE [--no-interpolation] [--overwrite]",
    );
    return;
  }
  const allowed = {
    prepare: [
      "input",
      "scale",
      "work-dir",
      "model",
      "size",
      "quality",
      "references",
      "prompt-file",
      "provider-script",
      "timeout",
    ],
    status: ["work-dir"],
    import: ["work-dir", "tile", "image"],
    generate: ["work-dir", "max-new", "retry-uncertain"],
    stitch: ["work-dir", "output", "no-interpolation", "overwrite"],
  }[a.command];
  if (!allowed) throw new Error("未知命令。使用 help 查看。");
  for (const key of Object.keys(a))
    if (key !== "command" && !allowed.includes(key))
      throw new Error(
        "此命令不支持 --" + key + "。配置只能在 prepare 阶段设置。",
      );
  if (typeof a["work-dir"] !== "string")
    throw new Error("需要 --work-dir 独立工作目录。");
  const work = path.resolve(a["work-dir"]);
  const result = await lock(work, async () => {
    if (a.command === "prepare") return prepare(work, a);
    const m = await load(work);
    if (a.command === "status") return summary(work, m);
    if (a.command === "import") {
      if (typeof a.image !== "string" || typeof a.tile !== "string")
        throw new Error("import 需要 --tile 和 --image。");
      await accept(work, m, a.tile, path.resolve(a.image));
      return summary(work, m);
    }
    if (a.command === "generate") return generate(work, m, a);
    if (a.command === "stitch") return stitch(work, m, a);
    throw new Error("未知命令。使用 help 查看。");
  });
  console.log(JSON.stringify(result));
}
main().catch((error) => {
  process.stderr.write(
    JSON.stringify({ ok: false, error: error.message }) + "\n",
  );
  process.exitCode = 1;
});
