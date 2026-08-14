# ZestSend

ZestSend 是一个开源的 WebRTC 点对点连接工具。两位参与者输入相同的四位房间号后，通过原生 WebRTC 建立端到端加密的数据通道；Cloudflare Durable Objects 仅用于 WebSocket 信令，不存储传输内容。

## 当前 MVP

- 中文与英文首页、房间路由
- 四位房间号连接与最多两人房间限制
- Durable Object WebSocket 信令
- 原生 `RTCPeerConnection` 与 `RTCDataChannel`
- Cloudflare TURN 短时凭证与多供应商 STUN 测速
- 自动选择最快的三个不同 STUN 供应商
- 连接状态、WebSocket RTT、直连/中继实际路径识别
- 主题、玻璃态界面与连接诊断

## 技术栈

- Cloudflare Workers、Durable Objects、Realtime TURN
- Hono
- TanStack Router
- React、Vite、TypeScript、Tailwind CSS
- pnpm

## 本地开发

```bash
pnpm install
pnpm dev:worker
```

打开 [http://127.0.0.1:8787](http://127.0.0.1:8787)。

可选的 Cloudflare TURN 配置写入 `.env`：

```dotenv
TURN_ID=your_cloudflare_turn_key_id
TURN_TOKEN=your_cloudflare_turn_api_token
```

未配置 TURN 时，应用仍会使用公共 STUN 尝试直连；受限网络无法穿透时则不会启用中继。

## 检查与部署

```bash
pnpm check
pnpm deploy
```

部署前请将 `TURN_ID` 和 `TURN_TOKEN` 设置为 Cloudflare Worker secrets，而不是提交到仓库。

## 许可证

本项目采用 [MIT License](LICENSE)。
