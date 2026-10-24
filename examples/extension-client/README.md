# 浏览器扩展认证桥接 recipe

session.ts 是可导入的、无框架 TypeScript 客户端，连接主模板已存在的安全扩展认证入口。它不是完整 MkExt 产品，不包含商店上传、OAuth 授权弹窗、打包器或持久账号同步。不要把 Google client secret 放进扩展。

## 本地可运行验证

```sh
npx vitest run tests/developer-recipes.test.ts
npx vitest run tests/auth.integration.test.ts --testNamePattern 'extension|signed bearer'
```

前者实测客户端请求和并发/退出状态，使用明确的假响应；后者验证真实本地 Better Auth 会话和已验证 profile 边界。二者都不证明浏览器安装、真实 Google 授权或 Chrome Web Store 发布通过。

## 主站配置

1. 启用 websiteConfig.auth.enable 和 enableGoogleLogin。已有普通 Google Web client 的 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 仅留服务器。
2. 配置 GOOGLE_EXTENSION_CLIENT_ID 为你的扩展 Google OAuth client ID。扩展与 Web client 不是可混用的受众。
3. EXTENSION_ORIGINS 只填精确 chrome-extension:// 的 32 字符 ID 或支持的 moz-extension:// UUID。空白为禁用，不允许 *、网页域名或通配后缀。
4. APP_URL 为应用真实 HTTPS origin。本地仅 http://localhost 或 127.0.0.1。扩展 manifest 的 host_permissions 只列你的应用 origin，不要使用 <all_urls>。完成 Google OAuth client/extension ID 绑定的实际授权由操作者负责。

## 在自己的扩展中集成

将 session.ts 加入你现有的 TypeScript 扩展构建。在 background/service worker 模块创建一个会话对象，而不是在每次渲染时创建：

```ts
import { createExtensionSession } from './session';
const session = createExtensionSession('https://YOUR-OWN-APP.example');
// OAuth SDK/浏览器 identity API 在用户明确点击登录后返回 access token：
const user = await session.signIn(accessTokenFromYourOAuthFlow);
// 后续从受信的 background 处理明确的扩展 UI 请求：
const currentUser = await session.getMe();
// 用户明确退出，清除内存并向主站撤销当前会话：
await session.signOut();
```

上面 OAuth 取得 token 的部分是你的现有授权流，不是模板假装实现的 helper。不要将这段含占位 origin 的代码直接部署。身份传递协议已经在可运行 session.ts 中实现，测试不会使用这些占位值访问外网。

## 安全边界

- Google token 只发送到 /api/extension/auth/google。主站核对精确 Origin、Google token 受众/签发方/到期和 verified email，再让 Better Auth 建立会话；客户端本身不能验证自己是否付费或管理员。
- 只读取 set-auth-token 响应头里的签名主站 token，不使用 JSON body 里的原始 session token。之后 /api/me 使用 Authorization: Bearer、credentials: omit、redirect: error、no-store。
- 客户端不写 cookie、localStorage、chrome.storage 或日志；service worker 停止会丢失内存会话，需要重新登录。clearLocalSession 只清本地状态，不承诺撤销服务端会话。
- signOut 向 /api/auth/sign-out 请求撤销当前会话；失败仍清本地，并明确要求从账号设置撤销。它不是退出 Google 或撤销全部会话。
- 不手工伪造浏览器 Origin header；由浏览器携带并由服务器检查。不把扩展 CORS 放宽到全部 /api，不关闭普通同源 CSRF。
- 不从任意网页/content script 转发任意 URL、token 或用户 ID。真实扩展消息通道还必须检查 sender、消息 schema 和允许动作；本 recipe 未实现通用代理。
- signIn/getMe/clear/logout 的并发修订号阻止已取消的旧登录响应重新恢复会话。网络错误不能自动重试 OAuth 交换，也不能当成成功。

现有 /api/me 是只读账号能力。若要让扩展写业务数据，应另设计窄范围、显式允许 Origin、只接受签名 Bearer、不接受 Cookie 的端点，并补鉴权/所有权/方法/CORS 回归；不要把私人笔记同源 API 原样改为跨域可写。
