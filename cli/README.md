# create-askc-app

初始化一个 askc 应用（guest）工程，等价于 askit CLI 的 `askc init`。

## 用法

```bash
bunx create-askc-app my-app

# bun 的脚手架约定（bun create 会解析 create-* 包）
bun create askc-app my-app
```

生成内容：

- `manifest.json` —— 应用元信息与面板布局声明
- `package.json` —— 构建脚本与依赖（keel bundler 出 `app.js`，askc 打包出 `.askc`）
- `src/unified-app.tsx` —— 统一入口组件
- `README.md`

初始化完成后：

```bash
cd my-app
bun install
bun run build        # 只产出中间产物 app.js（预览 / 调试用）
bun run build:askc   # 产出可交付包 <name>.askc
```

依赖中的 `keel` 是私有仓库（scp 形式 git 地址），执行 `bun install` 需要有对应 SSH 访问权限。

## 运行环境

CLI 使用 Bun API（`Bun.write` 等）并以 TypeScript 直接运行，**必须用 Bun 执行**；`npx` 走 Node，无法运行本 CLI。
