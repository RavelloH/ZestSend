# ZestSend

ZestSend 是一个开源的 WebRTC 点对点连接网页工具，可自行部署在 Cloudflare 上。

支持端对端加密的匿名实时聊天、文件互传、语音通话、视频通话、屏幕共享、同播共享、文本协作、画板等功能，支持点对点直连或 Cloudflare TURN 中转。

无任何账号 / 数据记录机制、完全匿名，两位参与者输入相同的四位房间号后即可连接。直接使用 Cloudflare 部署，即可建立点对点直连连接。配置 Cloudflare TURN 服务器后，可每月免费获得 1000GB 中转连接流量。

延续并改进了 [RavelloH/TimePulse](https://github.com/RavelloH/TimePulse) 的玻璃态设计美学。

## 部署

Fork 本仓库后，在 Cloudflare Dashboard 的 **Workers & Pages** 中依次选择 **Create application** → **Import a repository**，选择自己的 Fork 并完成 GitHub 授权。

在部署设置中保留 Worker 名称为 `zestsend`（需与 `wrangler.jsonc` 一致），选择 `main` 作为生产分支，并设置：

| 配置 | 值 |
| --- | --- |
| Package manager | `pnpm` |
| Build command | 留空 |
| Deploy command | `pnpm deploy` |

### 可选：配置 Cloudflare TURN

未配置 TURN 时，应用仍会使用公共 STUN 尝试直连；如需在受限网络中使用中继，请先在 Cloudflare Dashboard 的 **Realtime** → **TURN** 创建凭证，然后在已部署 Worker 的 **Settings** → **Variables and Secrets** 中添加两个 **Secret**：

| 名称 | 值 |
| --- | --- |
| `TURN_ID` | TURN 凭证的 Key ID |
| `TURN_TOKEN` | TURN 凭证的 API Token |

后续更新时，在 GitHub 通过 **Sync fork** 拉取上游提交并合并到 `main`；Cloudflare 会自动构建并部署。

## 预览

前往 https://send.ravelloh.com 查看效果。

<img width="2478" height="1455" alt="image" src="https://github.com/user-attachments/assets/c842bdce-a80c-4760-947d-b601b1023b1f" />
<img width="2478" height="1455" alt="image" src="https://github.com/user-attachments/assets/578cf5c6-5ec1-4ba5-a490-a3052cc9bc25" />
<img width="2478" height="1455" alt="image" src="https://github.com/user-attachments/assets/90ba302f-a5ed-4e9a-98c0-f2fcc2f0484a" />
<img width="2478" height="1455" alt="image" src="https://github.com/user-attachments/assets/ea9522f1-e074-4d6b-8d4c-26963523d044" />
<img width="2560" height="1528" alt="image" src="https://github.com/user-attachments/assets/db5058f0-96ab-43f2-bbea-802ada0e25f1" />
<img width="2478" height="1455" alt="image" src="https://github.com/user-attachments/assets/d8524922-8792-45c1-9196-36585af365b2" />
<img width="2478" height="1455" alt="image" src="https://github.com/user-attachments/assets/d3fd6f95-285a-49be-9c59-d6ae7a63ed3e" />
<img width="2478" height="1455" alt="image" src="https://github.com/user-attachments/assets/a9c5cde1-74f1-4b72-9bdc-4c4e3a484d1b" />
<img width="2478" height="1455" alt="image" src="https://github.com/user-attachments/assets/6004e9f8-8b6e-4fee-99e8-000107e96524" />
<img width="2478" height="1455" alt="image" src="https://github.com/user-attachments/assets/5fdd10e9-b273-4c8d-a5d1-5f579ec4cd91" />
<img width="2478" height="1455" alt="image" src="https://github.com/user-attachments/assets/808932dc-671d-4dec-9a3a-8ac7e08282e0" />



## 技术栈

- Cloudflare Workers、Durable Objects、Realtime TURN
- Hono、Wrangler、Cloudflare Vite Plugin
- 原生 WebRTC 的 `RTCPeerConnection`、`RTCDataChannel`、MediaStream
- React、Vite、TypeScript、Tailwind CSS、TanStack Router
- Tiptap、Yjs
- Framer Motion

## 本地开发

```bash
pnpm install
pnpm dev
```

打开 [http://127.0.0.1:8787](http://127.0.0.1:8787)。

可选的 Cloudflare TURN 配置写入 `.env`：

```dotenv
TURN_ID=your_cloudflare_turn_key_id
TURN_TOKEN=your_cloudflare_turn_api_token
```

未配置 TURN 时，应用仍会使用公共 STUN 尝试直连；受限网络无法穿透时则不会启用中继。

## 许可证

本项目采用 [MIT License](LICENSE)。
