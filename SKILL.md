---
name: tiled-image-upscale
description: Use when a user asks for overlapping crop/image-to-image/stitch upscaling, 分块生图放大、裁剪后生图再拼接、超大图细节增强，或继续未完成的分块任务；也适用于需要明确区分原生生成尺寸与插值放大的交付。
---

# 分块生图放大

将原图按重叠方块裁剪，逐块图生图，再进行有限位置校正、低频颜色约束和羽化拼接。附带可独立运行的 Node.js 工具。支持 **2、3、4、6、8、10 倍**，默认2倍；最大输出1亿像素、最长边20000、最多256块。

## 使用

将下文的 `<skill>` 替换为本 SKILL.md 所在目录。Node.js 20.9+（推荐22或24）；若 `node_modules/sharp` 不存在，在技能目录运行 `npm ci --omit=dev`。公开包不附带 node_modules；每台机器均需安装对应平台依赖。

1. 先执行离线准备，查看 `target`、`total` 和 `estimatedNewRequests`：

```text
node <skill>/scripts/tiled-upscale.cjs prepare --input 原图.jpg --scale 2 --work-dir 独立任务目录
```

可在 prepare 时设置 `--model`、`--size 2048`、`--quality high`、`--references 1|2`、`--prompt-file`、`--provider-script`。默认使用同级 `image-gen/scripts/node/image-gen.js`，模型 `gpt-image-2.5-sunburst`，请求2048方图。需要其他模型时按用户选择配置，勿静默换模型继续旧任务。

2. 用户已授权实际生成时，执行：

```text
node <skill>/scripts/tiled-upscale.cjs generate --work-dir 独立任务目录
```

调用生图前读取已安装的 **image-gen** 技能。这里只编排该技能，不复制或修改它的接口实现。密钥仅通过专用进程环境变量 `IMAGE_GEN_API_KEY` 传递；Windows 进程未继承时，工具自动读取 Windows 用户环境变量。不要把密钥写入参数、清单或文件。当前用户已经要求生图时无需重复确认；仍须遵守用户给定的费用/请求上限。可用 `--max-new 1` 限制本轮新请求数。

3. 全部分块完成后导出：

```text
node <skill>/scripts/tiled-upscale.cjs stitch --work-dir 独立任务目录 --output 成品.png
```

默认会将尺寸不足的块插值到目标像素，并返回中文 `warning`。用户要求全部原生尺寸时添加 `--no-interpolation`；它会拒绝尺寸不足的成品。已有文件默认不覆盖，只有明确需要覆盖时使用 `--overwrite`。

## 恢复与导入

```text
node <skill>/scripts/tiled-upscale.cjs status --work-dir 独立任务目录
node <skill>/scripts/tiled-upscale.cjs import --work-dir 独立任务目录 --tile r1c1 --image 已生成分块.png
```

- 使用同一工作目录恢复；只跳过哈希及图像结构检查均通过的块。不同原图、倍率或请求配置必须使用新目录，不要手改 manifest 混用缓存。
- 有旧裁剪时先核对原始坐标、尺寸和块编号。相同文件名不代表相同视野；布局不符的旧块不可直接套入。默认每块约2048目标像素，20%起始重叠，再均匀分配边缘起点；实际坐标以 `manifest.json` 为准。
- Ctrl+C停止后不提交新块。远端已受理请求可能仍完成并计费。上次请求不确定时，优先查询供应商并导入结果；明确决定补发时才加 `generate --retry-uncertain`，该选项可能重复计费。失败默认停止，不无限重试。
- 退出时保留工作目录。残留 `.lock` 只有确认没有执行进程后才可移除。

## 交付检查

打开成品，检查全图和100%局部：人物身份、五官、文字、接缝重影、颜色和画面边缘。配准只能修正小范围平移，无法保证任意模型重绘后无缝；明显结构变化会拒绝该块。不能用原图补缺块后声称全部完成AI增强。

报告最终尺寸、所用模型、真实返回块尺寸、是否插值和缓存复用情况。请求2048并不等于返回2048；1254生成后插值到2048应明确说明，不能称为原生2048细节。纯离线导入/拼接不能声称已验证在线供应商。

导入外部分块只校验图像与布局，不证明它实际使用过哪个模型。来源未知时说明“导入分块，模型来源未核实”；清单里的 model 是任务请求配置。

调用示例：“用 $tiled-image-upscale 把这张图分块放大4倍，先看预计块数，保留已完成缓存。”

## 流式错误记录与图片恢复

- 生图调用的输出记录保存在工作目录 generated 下的 `*.provider.json`，会遮盖本次传入的 IMAGE_GEN_API_KEY。记录可能含原始图片 base64、供应商信息和本地路径，不要直接提交到公共仓库。
- 当前支持一种经过测试的异常恢复：已完成图片事件中的 PNG 完整，但消息末尾的 usage 对象被截断。只有前面的 JSON 字段完整、事件为 completed、PNG 签名和 IEND 正常且完整解码成功，才保存图片并继续原有图像/布局验收。不是对所有畸形响应的宽松放行。
- 无法恢复时明确输出错误码、HTTP 状态（若有）及记录路径，保留不确定请求标记，不自动付费重试。
- 记录每个输出流最多 32 MiB；超过上限会标记 truncated，禁止从被截断的捕获记录中恢复。
- 不改变模型、提示词和尺寸，不把返回小图声称为原生大图，也不修改外部 image-gen 技能。

离线回归：在技能目录运行 `node --test tests/provider-result.test.cjs`，不需要真实密钥，不发送网络请求。


