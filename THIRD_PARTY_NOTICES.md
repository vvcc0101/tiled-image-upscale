# 第三方组件说明

本项目自己的代码按MIT授权，见LICENSE。依赖保留各自许可证，不被重新授权为MIT。

## 安装时的依赖

| 组件 | 许可 | 用途与来源 |
| --- | --- | --- |
| sharp 0.35.5 | Apache-2.0 | 本地图像处理；https://github.com/lovell/sharp |
| @img/colour | MIT | sharp依赖；以package-lock.json固定的版本为准 |
| detect-libc | Apache-2.0 | 原生运行时识别；https://github.com/lovell/detect-libc |
| semver | ISC | 版本判断；https://github.com/npm/node-semver |

平台相关可选二进制包由sharp安装流程选择，包含libvips等原生组件（含LGPL等许可）；本源码包不附带这些二进制。具体依赖版本、平台包及完整许可文件以package-lock.json和安装后各包的LICENSE/NOTICE文件为准。若另行分发原生二进制，需要重新核对并履行其许可义务，不能只附本项目MIT许可。

## 外部程序与服务（不打包）

- image-gen：用户自行安装的APIKEY.FAN技能，https://apikey.fan/install/skill/image-gen 。本项目仅调用其命令行接口；没有确认其开源授权，不复制、不打包，也不为其赋予MIT许可。
- APIKEY.FAN及模型服务：受各自服务条款、账号权限和计费规则约束，不包含在本项目软件许可内。
- Node.js与npm：用户自行安装，遵守其各自许可。

图片、商标与示例素材不因代码开源而自动获得授权。本版本没有附带用户照片或付费生成图。
