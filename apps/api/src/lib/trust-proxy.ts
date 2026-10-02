/**
 * Fastify `trustProxy`：只信任私有網段與本機的代理（change add-login-brute-force-protection，AUDIT SEC-04）。
 *
 * 原本是 `true`：request.ip 取 X-Forwarded-For 最左邊的值，使用者可以自己帶這個標頭偽造 IP，
 * 依 IP 的速率限制形同虛設。改為信任清單後，proxy-addr 從連線來源往左逐一略過受信任的代理，
 * 停在第一個不受信任的位址，也就是最外層代理（主機 nginx）附加的真實 IP；最左邊的偽造值不會被採用。
 *
 * 部署路徑：使用者 → 主機 nginx → Caddy（docker 閘道 172.18.0.1）→ api；Caddy 須設定 trusted_proxies
 * 保留 nginx 的 X-Forwarded-For（Caddyfile.local），否則所有請求的 IP 都會是 docker 閘道。
 * 限制：
 *   - 真實使用者本身在私有網段（例如同一個 VPC 或經 VPN）時會被當成代理略過，改採更左邊、可由使用者偽造的值。
 *   - 前面若加上 Cloudflare 等公網 CDN，所有人的 IP 都會變成 CDN 節點；屆時要把 CDN 的 IP 段加進清單。
 */
export const TRUSTED_PROXIES = ['loopback', 'linklocal', 'uniquelocal'];
