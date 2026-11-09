# 安装与配置

## 1. 本地运行环境

Node.js >=20.9.0，推荐22/24。在本技能根目录执行 `npm ci --omit=dev`。公开包不附带 node_modules；不要拷贝其他操作系统的原生依赖。

## 2. 外部 image-gen

由用户自行从 https://apikey.fan/install/skill/image-gen 安装完整技能，包括 `scripts/node/image-gen.js`。本仓库不打包该技能，未声明其许可证，也不将本项目 MIT 许可扩展给它。

默认查找当前技能的同级 `image-gen/scripts/node/image-gen.js`。可以在 prepare 时用 `--provider-script` 指定脚本绝对路径。该文件会作为子进程执行：只使用可信来源，不接受陌生人提供的任意脚本。

## 3. 私密配置

使用专用环境变量 `IMAGE_GEN_API_KEY`；从供应商获取自己的密钥。不要提交到 Git，不要放在命令行参数或聊天中。

PowerShell（只对当前终端生效，通过隐藏输入避免密钥落入命令历史）：

```powershell
$credential = Get-Credential -UserName 'image-gen' -Message '在密码栏填写生图密钥'
$env:IMAGE_GEN_API_KEY = $credential.GetNetworkCredential().Password
Remove-Variable credential
```

macOS / Linux 的 Bash（只对当前终端生效）：

```bash
read -rsp 'IMAGE_GEN_API_KEY: ' IMAGE_GEN_API_KEY; echo
export IMAGE_GEN_API_KEY
```

Windows 也支持提前在用户环境变量中配置同名变量；当前进程未继承时，本技能会读取 Windows User 范围，不写回任何密钥文件。将环境变量传入客户端会话的方法取决于客户端，请不要假设所有已打开进程会自动读取新配置。

供应商账号权限、余额和模型是否开放需要分别核实；`/models` 列表不等于生图权限。实际生成可能收费。

## 4. 使用 Codex

将技能放入 `~/.codex/skills/tiled-image-upscale/`，将外部技能放入 `~/.codex/skills/image-gen/`。安装依赖后新建聊天，例如：

> 使用 $tiled-image-upscale 将这张图放大4倍，先给出预计分块数；确认后本轮最多6次新请求。

Codex 是执行客户端，不是必须的生图服务；此工具也可以不通过 Codex，直接在命令行执行。
