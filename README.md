# 棉鞋编织花样设计器（本地版）

这是一个纯静态的棉鞋编织花样设计网页，适合直接在本地打开或部署为普通静态页面。项目只保留前端与本地文件读写所需的结构，不包含服务端、部署脚本、运行数据、SSH 密钥或其他凭据。

## 功能

- 120 × 200 默认网格，可新建 400 × 400 以内的尺寸
- 选择填色、画笔、橡皮、油漆桶、套索、直线、矩形和吸管
- 选区复制、剪切、粘贴、翻转、旋转
- 左右镜像、上下镜像、中心对称和单元图案重复
- 浏览器自动保存、JSON 文件保存与载入
- PNG 图表导出，适合打印后对照编织
- 手机、平板和桌面端自适应

## 本地运行

需要 Python 3 或任意静态文件服务器。在项目根目录执行：

```powershell
py -m http.server 8787 --directory public
```

然后打开：

```text
http://127.0.0.1:8787
```

也可以把 `public/` 目录直接发布到 GitHub Pages、Cloudflare Pages、Netlify 等静态托管服务。

不建议直接双击 `index.html`。通过本地 HTTP 地址打开时，剪贴板、Service Worker 和离线缓存等浏览器能力更完整。

## 目录结构

```text
mianxie-pattern-public/
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── manifest.webmanifest
│   ├── sw.js
│   └── icons/
├── .gitignore
├── LICENSE
├── README.md
└── SECURITY.md
```

## 数据位置

草稿默认保存在当前浏览器的 `localStorage` 中。需要跨浏览器、换设备或长期归档时，请使用页面里的“保存到本地”和“载入文件”，文件扩展名为 `.mianxie.json`。

浏览器本地存储可能在清理站点数据、更换浏览器或使用隐私模式后丢失，重要花样请同时保存为本地文件。

## 安全边界

公开仓库不包含服务端程序、部署配置、服务器地址、密码、API 令牌、SSH 私钥或 TLS 私钥。提交前仍建议执行一次敏感信息检查；具体规则见 [SECURITY.md](SECURITY.md)。

## 许可证

本项目采用 GNU Affero General Public License v3.0 only
（SPDX：`AGPL-3.0-only`）授权，完整条款见 [LICENSE](LICENSE)。

如果修改本程序并通过网络向用户提供服务，需要按照 AGPL
向这些用户提供对应的完整源码。
