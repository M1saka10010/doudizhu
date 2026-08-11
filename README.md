# AI 斗地主

用户与两个 AI 玩家进行斗地主对局的纯静态网页游戏。React + Vite，浏览器直接调用 OpenAI 兼容接口，不需要自建后端。

## 特性

- 随机发牌、叫地主与完整斗地主状态机
- 两个 AI 的叫地主和出牌全部由模型通过 tool call 决策
  - 叫地主：`decide_bid`
  - 出牌：`play_cards`
- 浏览器本地校验 AI 决策；非法决定反馈给模型重试，最多三次
- 默认 `reasoning_effort: high`
- `max_tokens: 128000`
- 整次决策最多等待五分钟
- 牌局、设置和对局记录保存在浏览器 `localStorage`

## 使用要求

模型接口必须：

1. 兼容 OpenAI `chat/completions`
2. 支持 `tools` / function calling
3. 允许浏览器跨域请求（CORS）

静态网页无法隐藏 API Key。请让每个使用者填写自己的 Key，不要把公共密钥写入源码、构建变量或仓库。

## 本地开发

```bash
npm install
npm run dev
```

浏览器打开终端显示的地址（通常是 `http://localhost:5173`），点击右上角“AI 设置”，填写：

- Base URL：例如 `https://api.openai.com/v1`
- API Key
- 模型名称

## 构建静态页面

```bash
npm run build
npm run preview
```

构建结果位于 `dist/`。Vite 使用相对资源路径，因此可以放在根域名、GitHub Pages 子目录、Vercel、Netlify 或普通静态文件服务器上。

## 部署到 GitHub Pages

仓库已包含 `.github/workflows/deploy-pages.yml`。将代码推送到 `main` 后：

1. 打开 GitHub 仓库的 `Settings → Pages`
2. 将 Source 设为 `GitHub Actions`
3. 重新运行 `Deploy GitHub Pages` 工作流

无需配置服务器地址或 API Key。

## 部署到 Vercel

1. 在 Vercel 导入 GitHub 仓库
2. Framework Preset 选择 `Vite`
3. Build Command 使用 `npm run build`
4. Output Directory 使用 `dist`
5. 点击 Deploy

不需要配置 Functions 或环境变量；部署结果是纯静态站点。

## 测试

```bash
npm test
npm run typecheck
npm run build
```

## 项目结构

```text
game/                  游戏引擎与规则
src/
  ai/
    client.ts          浏览器设置、连接检测和 AI 调用入口
    decision.ts        prompt、tools、模型请求、重试与合法性校验
  hooks/useGame.ts     牌局编排、持久化、请求取消
  components/          牌桌、手牌、座位和设置界面
dist/                  静态生产构建
```
