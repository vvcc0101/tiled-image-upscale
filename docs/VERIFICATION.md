# 验证记录

日期：2026-11-10（Asia/Shanghai）。版本：1.0.1。

## 已完成的本地验证

- Windows x64 / Node.js 24.15.0。
- npm依赖安装、JavaScript语法检查通过。
- 14项离线测试通过：PNG恢复、残图拒绝、错误码/状态保留、密钥脱敏、不覆盖已有结果、不自动重发、计划约束、配置防篡改、离线裁剪/导入/拼接、缺块/插值/覆盖保护和缓存复用。
- sharp固定0.35.5；npm audit --omit=dev在本次检查返回0项漏洞（时间点快照）。

## GitHub Actions 远程验证

- 仓库 [vvcc0101/tiled-image-upscale](https://github.com/vvcc0101/tiled-image-upscale) 首次推送触发 `offline-tests`：**4/4 job 全部 success**。
- 覆盖矩阵：`ubuntu-latest` / `windows-latest` × Node.js 22 / 24。
- 每个 job 执行 `npm ci` → `npm run check` → `npm test` → `npm audit --omit=dev`。

## 明确未完成或不代表的事项

- 本公开版本未新增在线生成请求，测试不验证真实供应商可用性、计费或最终画质。
- 不在 CI 矩阵内的平台与 Node 版本不属于已通过证据。
- 不宣称文字百分百准确或普遍优于其他放大算法。
- `examples/demo-01/` 的4张图片为维护者本人生成并授权公开的效果案例，尺寸已核实；各块真实返回尺寸未核实，故不宣称全部为原生生成细节。该案例不构成质量基准。
- 未执行 npm 发布。MIT版权署名采用tiled-image-upscale contributors，维护者可按实际权利主体调整。

安全扫描与压缩包哈希另见发布包旁的校验文件。工作目录、依赖缓存与日志不应上传。

