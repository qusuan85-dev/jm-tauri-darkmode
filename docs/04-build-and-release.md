# JM (Tauri) 定制版 — 产物与安装

基于 [alexsunxl/jm-tauri](https://github.com/alexsunxl/jm-tauri) `v0.1.25` 源码（即你提供的 `jm.apk`）改造，累计包含三批改动：

| 批次 | 内容 | 说明文档 |
| --- | --- | --- |
| 1 | 暗色模式 + 界面观感 | [`README-darkmode.md`](./README-darkmode.md) |
| 2 | 搜索增强：结果条数 / 触底翻页 / 切页保留 | [`README-search.md`](./README-search.md) |
| 3 | 圆角 / 液态玻璃 / 主题色 / 导出到目录与 PDF / 应用图标 | [`README-ui-export.md`](./README-ui-export.md) |

---

## 产物

| 文件 | ABI | 大小 | sha256 |
| --- | --- | --- | --- |
| `jm-0.1.25-darkmode-universal.apk` | arm64-v8a / armeabi-v7a / x86 / x86_64 | 68.76 MB | `127d243731a95bc0a4f0788f05e2962c13fb57e81a0508b06d3c36e1f98175a6` |
| `jm-0.1.25-darkmode-arm64.apk` | arm64-v8a | 20.55 MB | `fc5bf41f252e904aa4913f5e2160bc0deed31c7800108cfef84b3fa391ac2a4a` |

> 这一版含：应用图标更换、底部导航「阅读」菜单被裁剪的修复、导出图片/PDF 全部失败的修复
>（根因是章节返回的是裸文件名，Rust 侧没拼 CDN 前缀就直接请求）、
>**导出图片是错位条带的修复**（根因是分块数用了带扩展名的文件名去算，详见
> [`README-ui-export.md`](./README-ui-export.md) 的「真机反馈修复记录」第 3 条）。
>
> 上一版的两个 APK（`70a1640d…` / `f1ff4515…`）已被这一版取代，请用上表新的校验值。

`screenshots/` 里是各页面的浅色/深色整页截图、PDF 渲染验证截图，以及真实下载页面的
解密修复前后对照（`uifix-descramble-before-after.png`）。

## 安装

- 包名 `com.aa.jm`，版本名 `0.1.25+darkmode`，`versionCode` 从 `1784734357` 提升到 `1784900000`
- 使用**仓库自带的官方签名密钥**签名（APK Signature Scheme v2），证书 SHA-256：
  `cfadb4b5ce805ea6250ab5e5d55ba84562772b7f32f560792c90fc52bb64621b`
- 该指纹与**你提供的原 APK 完全一致**，因此可以**直接覆盖安装**，无需卸载，登录态 / 收藏 / 阅读进度都不会丢

> 版本名刻意不带 `jm-` 前缀：应用内"检查更新"会把 `0.1.25+jm-xxx` 判定为正式渠道并提示升级回官方版，`+darkmode` 会被判定为 dev 渠道从而跳过检查，避免自建版本被官方包覆盖。

## 上游 CI 的官方构建配方

`.github/workflows/*.yml`：Node 24 + pnpm 9、Rust stable（4 个 Android target）、JDK 17、
`platforms;android-36` + `build-tools;35.0.0` + `ndk;29.0.13846066`、`cargo install tauri-cli --locked`，
最后 `cargo tauri android build`。

本机（Windows）复现时踩到的坑与处理见 [`README-darkmode.md`](./README-darkmode.md) 的「如何复现构建」一节，
其中 `jm/tauri.override.json` 是本地构建覆盖（版本号 / versionCode / beforeBuildCommand），不参与运行时逻辑。

## 总量验证

`jm/e2e/` 下共 **27 个 Playwright 用例，连续 4 次全绿**：

```bash
cd jm
node ./node_modules/@playwright/test/cli.js test
# 想看截图：先设 JM_SHOT_DIR 环境变量
```

另有纯逻辑单元测试（`jm/src-tauri/src/paths.rs`：图片 URL 拼接、图片分块数、标题清洗、页序；
`jm/src-tauri/src/scramble.rs`：拆条拼回、未加密直通、解码失败报错）。
它们同样会随 `cargo test -p jm` 在 Linux/macOS 上跑，但链接 WebView2 的测试二进制在本机 Windows 上无法启动，
所以本地是用一个独立 harness 跑的（`jmwork/pathcheck`，把这两个文件以 `#[path]` 引入）：

```bash
cd jmwork/pathcheck && cargo test   # 11 passed（其中 12 个向量来自真实下载页面的实测分块数）
cargo run --release                 # 真机数据端到端：3 张真实 WebP 走完整 Rust 解密链路
```

产物侧静态校验（每次重建后都会做）：签名 v2 通过、证书与原 APK 一致、ABI 齐全、
各 ABI 的 `libjm_lib.so` 里能找到本次构建的前端哈希文件名与 Rust 新增代码
（含 `/media/photos/` —— 即图片 URL 拼接修复）、`classes.dex` 里全部原生桥方法未被 R8 剥离。
