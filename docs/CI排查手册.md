# GitHub Actions 排查手册（本项目实战记录）

本项目为麒麟 aarch64 出包时，在 CI 上绕了三圈才打通。此文记录症状与根因，
**下次改工作流前先看这篇，并先跑 actionlint**。

---

## 核心原则：先 lint，再触发

改 `.github/workflows/*.yml` 之前，先跑：

```bash
actionlint .github/workflows/*.yml
```

**为什么必须用 actionlint**：`pyyaml` 只能验 YAML 语法，**验不出表达式上下文可用性**。
本项目的根因就是语法完全合法、上下文却非法，导致连续三轮误判。

获取 actionlint（直连 GitHub releases 会被代理挡，必须走 API）：

```bash
gh api repos/rhysd/actionlint/releases/tags/v1.7.7 \
  --jq '.assets[] | select(.name|test("windows_amd64.zip")) | .id'
# 用返回的 id 下载
gh api repos/rhysd/actionlint/releases/assets/<id> \
  -H "Accept: application/octet-stream" > al.zip
```

---

## 🔴 坑一：`matrix` 上下文在 job 级不可用（本次真正的根因）

```yaml
release:
  if: matrix.platform != 'windows-latest'   # ❌ 致命
```

actionlint 报错：

```
context "matrix" is not allowed here.
available contexts are "github", "inputs", "needs", "vars".
```

**规则**：job 级可用上下文只有 `github` / `inputs` / `needs` / `vars`；
`matrix` **只在 step 级可用**。

**后果**：不是某个 job 跳过，而是**整个工作流解析失败，所有 job 都不创建**。

症状极具迷惑性：

| 现象 | 说明 |
|---|---|
| run 秒 failure | 没有任何编译日志 |
| 页面提示 | "This run likely failed because of a workflow file issue" |
| `prepare-release` | **绿色成功** |
| `release` | **完全空白**（一个 job 都没有） |
| `gh run rerun` | 报 "its workflow file may be broken" |
| 远端 YAML 取回本地解析 | **完全正常** |

> 极易误判为「构建失败」或「JSON 格式问题」，实际是工作流解析期就挂了。

**正确写法**：条件放step 级

```yaml
steps:
  - name: Build
    if: matrix.platform != 'windows-latest'
    run: ...
```

---

## 🔴 坑二：`fromJSON(needs.*.outputs.*)` 动态矩阵不可靠

```yaml
matrix: ${{ fromJSON(needs.prepare-release.outputs.matrix) }}   # ❌ 本项目实测不工作
```

即使 prepare-release 日志确认输出 JSON 完全合法（5 项齐全），`release` 作业**依然不被创建**，
症状与坑一几乎一样（prepare 绿 / release 空白 / workflow file may be broken）。

**建议**：矩阵用**静态 YAML 列表**声明。好处：

- 问题从运行期挪到解析期，能被 actionlint 检出
- Actions 页面直接列出各 job，不用猜
- 不依赖 shell / jq / 字符串拼接

---

## 🔴 坑三：字符串拼 JSON

```bash
INCLUDE="[$A,$B]"
INCLUDE="$INCLUDE,$C"      # ❌ 拼出 [..,..],{..}
```

产出：

```json
[{"platform":"win",...},{"platform":"ubuntu",...}],{"platform":"arm",...}
     ↑ 数组提前闭合 + 尾部孤立对象
```

这是**非法 JSON**，`fromJSON` 解析失败时 GitHub **不报 fromJSON 的错**，
只是静默不建 job。

若必须动态生成，至少用 `jq` 生成并校验：

```bash
INCLUDE="$(printf '%s\n' "${ITEMS[@]}" | jq -s -c '{include: .}')"
echo "$INCLUDE" | jq -e . > /dev/null || { echo "::error::矩阵 JSON 非法"; exit 1; }
```

但更好的做法是：**别动态生成**（见坑二）。

---

## 坑四：CRLF 破坏 Linux 上的脚本

Windows 上 `git add` 报 `LF will be replaced by CRLF` 时，
CI 上 `.sh` 会报 `bad interpreter: /bin/bash^M`，YAML 也可能解析异常。

**解决**：加 `.gitattributes`

```gitattributes
* text=auto eol=lf
*.sh text eol=lf
*.yml text eol=lf
*.bat text eol=crlf
```

同时设 `git config core.autocrlf false`。

---

## 坑五：`repo` 权限不含 `public_repo`

创建**公开**仓库的 PAT 必须单独勾 `public_repo`，否则报：

```
GraphQL: Your token has not been granted the required scopes...
the 'createRepository' field requires one of the following scopes: ['public_repo']
```

验证权限范围：

```bash
curl -sI -H "Authorization: Bearer <TOKEN>" https://api.github.com/user | grep -i x-oauth-scopes
```

| 需求 | 勾选 |
|---|---|
| 推代码、建私有仓 | `repo` |
| 建**公开**仓 | `repo` + `public_repo` |
| 推送 `.github/workflows/` | `workflow` |

---

## 排查信号速查

| 页面/命令显示 | 实际含义 |
|---|---|
| `workflow file may be broken` | **解析期**失败，不是构建失败 |
| prepare 绿 + release 空白 | 矩阵/上下文问题，绝不是编译问题 |
| `unexpected EOF`（设备码登录） | 网络断了 OAuth 端点，改用 PAT |
| `CONNECT tunnel failed, 502` | git 走代理失败，用 `gh api` 替代 |

---

## 受限网络下的替代通道

若 `git push` 反复 502 / TLS 中断，但 `gh api` 可用：

```bash
# 直接提交文件
gh api repos/<owner>/<repo>/contents/<path> --method PUT --input payload.json
# payload: {message, content(base64), sha(远端 blob sha), branch}

# 直接打标签触发构建
gh api repos/<owner>/<repo>/git/refs -f ref="refs/tags/<tag>" -f sha="<commit sha>"
```

取远端 blob sha：

```bash
gh api repos/<owner>/<repo>/contents/<path> --jq .sha
```

> 安全提醒：不要把 Token 写进 remote URL。用
> `git config --global credential.https://github.com.helper "!gh auth git-credential"`