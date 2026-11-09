# 安装与配置

## 1. 本地运行环境

Node.js >=20.9.0，推荐22/24。在本技能根目录执行 `npm ci --omit=dev`。公开包不附带 node_modules；不要拷贝其他操作系统的原生依赖。

## 2. 外部 image-gen

本技能不包含生图能力，也不打包、不代理、不背书任何具体供应商或中转服务。你需要自备一个 **image-gen 脚本**：由它负责把提示词发给模型，并把结果图片写到指定路径。

默认查找当前技能的同级 `image-gen/scripts/node/image-gen.js`，也可以用 `prepare --provider-script` 指定任意路径。

### 2.1 接口约定

脚本以 Node.js 子进程方式调起，参数如下（按名称解析，不依赖顺序）：

```text
node <provider-script> --mode image-prompt --prompt <PROMPT> --model <MODEL> \
  --size <N>x<N> --quality <QUALITY> --n 1 --timeout <SECONDS> \
  --image <CROP> [--image <CONTEXT>] --out <OUTPUT>
```

- `--image` 可能出现两次：第一次是待放大的分块，第二次（可选）是上下文参考图。按出现顺序读取。
- 成功时把 PNG 写到 `--out`；非 0 退出码或未产出文件均视为失败。
- 密钥只通过环境变量 `IMAGE_GEN_API_KEY` 传入，不要写进命令行参数或清单文件。
- 供应商返回的 `size` 可能与请求值不同，这不视为错误，将在拼接阶段按需插值并给出 warning。

该文件会作为子进程执行：**只使用可信来源**，不接受陌生人提供的任意脚本。

### 2.2 查找顺序

1. `prepare --provider-script <绝对路径>` 显式指定；
2. 同级目录 `image-gen/scripts/node/image-gen.js`。

脚本内容会被记录哈希；更换脚本后请使用新的工作目录，详见 [常见问题](docs/FAQ.md)。

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
