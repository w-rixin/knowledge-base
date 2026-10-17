# GitHub Token 登录指引（绕开设备码流程）

## 为什么不用设备码登录

实测你的网络环境下：

| 端点 | 结果 |
|---|---|
| `api.github.com` | ✔ 正常，0.6 秒 |
| `github.com/login/oauth/access_token` | ✘ **三次全部超时** |

设备码流程的最后一步必须访问上面那个超时的端点来交换 token，
所以**网页点完「Authorize」后，CLI 收不到响应**，页面就卡住/置灰。

这不是你的操作问题，是网络对该端点的限制。改用 Personal Access Token
（PAT）可完全绕开——PAT 由你在网页生成，直接给我，不需要走这个换 token 接口。

---

## 生成 PAT（3 步）

### 第 1 步：打开设置

https://github.com/settings/tokens/new

### 第 2 步：填写

| 字段 | 填什么 |
|---|---|
| Note | `kylin-build` （随便写，便于日后识别） |
| Expiration | 选 **30 days** 或 **90 days**（用完可吊销） |
| Repository permissions → **Contents** | 勾 **Read and write** ← 最关键 |
| 其他权限 | 全部不勾 |

> 只需要 Contents 读写权限 —— 就是能推代码、创建 Release 所需的最小权限。

### 第 3 步：生成并复制

点底部 **Generate token**，页面顶部会显示一串以 `ghp_` 开头的字符。

**立刻复制它**（关掉页面就再也看不到了）。

---

## 安全提醒

生成的 Token 等同于你的账号密码。拿到后可随时在
https://github.com/settings/tokens 页面一键吊销。

用完之后建议去吊销掉——反正安装包构建完就不需要了。

---

## 接下来

把 Token 发给我，我会：

1. 用它配置 git 凭据
2. 创建 GitHub 仓库
3. 推送代码
4. 触发 ARM 构建
5. 等待构建完成（约 15-20 分钟）
6. 下载 `KnowledgeBase_1.65.0_arm64.deb`

全程不需要你再操作。

> 如果你不想把 Token 发给我，另一条路是：你在自己终端执行
> `gh auth login`（在你自己的窗口里跑，不受我这边的超时限制）。
> 但既然设备码流程在这个网络下握手失败，PAT 是更可靠的选择。