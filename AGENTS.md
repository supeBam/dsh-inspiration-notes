# AGENTS.md — 给 AI Agent 的安装与维护手册

本文件写给读代码的 Agent：目标是把本仓库（一个 DSH cordis 插件 bundle）装进某个 DSH profile，并确认界面上出现「灵感便签」入口。

## 先了解这个包

- 包名 `@local/inspiration-notes`，`private: true`，**不是** npm 公开包，不要 `npm publish`。
- **无构建步骤**：`client.js` 用 `window.__ModuleLoader__.load()` 注册浏览器半边，`index.js` 是宿主侧空壳（`apply()` 为空）。
- 两处声明缺一不可：`cordis.patch.yml` 负责把 bundle 行插入 Cordis 树；`package.json` 里的 `dsh.client` 让 web app 加载 `./client.js`。
- 便签数据在浏览器 `localStorage`（键 `dsh.inspiration-notes.v1`，按 origin 隔离），不写 session 日志；卸载插件不会删除数据。

## 前置条件

- 已安装 DeepSeek Harness（桌面端或 CLI）。
- 有一个可写的 profile，下面以 `desktop` 为例。
- 找到 CLI：`command -v dsh`；桌面端自带一份在
  `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`。

## 安装（一条命令）

```bash
git clone https://github.com/supeBam/dsh-inspiration-notes.git ~/code/dsh-plugins/inspiration-notes

DSH_CLI="$(command -v dsh || echo '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh')"
"$DSH_CLI" plugin --profile desktop add link:"$HOME/code/dsh-plugins/inspiration-notes"
```

**为什么一条就够**：`dsh plugin` 只是把剩余参数转发给 profile 目录里的 pnpm。实测 `add link:<目录>` 会同时写入

1. `~/.dsh/profiles/desktop/package.json` 的 `dependencies`（`"@local/inspiration-notes": "link:/..."`），
2. 同一文件的 `dsh.profile.bundles` 数组（自动启用）。

不需要手改 JSON。若包已装好却没有出现在 `dsh.profile.bundles` 里（例如有人手动改过 `package.json`），再手工补一行 `"@local/inspiration-notes"` 即可。

## 生效

- **Web**：刷新页面。
- **Desktop**：`⌘Q` 完全退出再打开（只关窗口不够），client bundle 才会重新加载。

## 验证

```bash
# 1. 软链可解析、包信息读得出来
node -e "console.log(require(process.env.HOME + '/.dsh/profiles/desktop/node_modules/@local/inspiration-notes/package.json').name)"
# 期望输出：@local/inspiration-notes

# 2. profile 已启用该 bundle
grep -n '"@local/inspiration-notes"' ~/.dsh/profiles/desktop/package.json
```

3. 界面上：左侧边栏出现便签图标，点开主区显示面板。

## 更新

```bash
cd ~/code/dsh-plugins/inspiration-notes && git pull
```

之后按「生效」一节刷新 / 重启。

## 卸载

```bash
"$DSH_CLI" plugin --profile desktop remove @local/inspiration-notes
```

若 `dsh.profile.bundles` 里仍留有一行，手工删除。

## 排障

| 现象 | 原因与处理 |
| --- | --- |
| 侧边栏没有图标 | `dsh.profile.bundles` 未包含该包；或软链指向的目录已被移动 / 重命名 |
| `EPERM`、`unable to open database file` | profile 目录或 pnpm store 不可写；桌面端优先用应用自带 CLI |
| 图标在、面板空白 | `client.js` 的注册 id 必须保持 `inspiration-notes`（等于面板 key 与 locale 命名空间） |
| 改了代码不生效 | 桌面端没完全退出；仅关闭窗口不会重载 client bundle |

## 不要做

- 不要改包名 `@local/inspiration-notes`：profile 的 `dependencies`、`bundles` 和软链都依赖它。
- 不要提交 `node_modules/`，不要引入构建步骤——本插件刻意保持「改完刷新即生效」。
- 不要把便签数据改成写文件或 session 日志：它是浏览器状态，这是设计约束。
