# 🎤 集成语音输入功能 —— 完整实施提示词

> 本文档是给**其他项目**集成语音输入功能时的参考实现指南，可直接作为 prompt 喂给 AI 让它照着实现。
> 基于本知识库项目（Tauri 2 + Rust + React）实战经验沉淀，已抽象掉 Tauri 特定细节，跨栈通用。

---

## 核心目标

在应用中接入云端语音识别（ASR），让用户可以在所有文本输入位置点击麦克风按钮录音 → 自动转成文字写回输入框。可选加全局快捷键 + 独立快速捕获 Modal + AI 智能解析。

---

## 1. ASR 服务选型（关键决策）

**首选阿里云百炼 DashScope**（理由：注册送免费额度 / 后付费按用量 / 中文识别一流 / API 简洁 / 支持 base64 直传无需 OSS）。

**必须用以下组合**（其他组合会踩坑）：

| 项 | 必选值 |
|----|-------|
| **端点** | `POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`（OpenAI 兼容模式） |
| **模型** | `qwen3-asr-flash`（**不是** `-filetrans` 后缀的版本） |
| **音频字段** | `messages[].content[].input_audio.data`（**不是** `audio` / `file_url`） |

**避坑清单**：
- ❌ `paraformer-v2` 不支持 base64（必须 OSS URL）
- ❌ `qwen3-asr-flash-filetrans` 是异步任务模式，要轮询，且 base64 会触发 `url error`
- ❌ 原生 `/services/aigc/multimodal-generation/generation` 端点 base64 会触发 `url error`
- ✅ **只有** `OpenAI 兼容端点 + qwen3-asr-flash + input_audio.data` 这条路是同步且接受 base64 的

### 完整请求示例

```bash
POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
Authorization: Bearer {API_KEY}
Content-Type: application/json

{
  "model": "qwen3-asr-flash",
  "messages": [{
    "role": "user",
    "content": [{
      "type": "input_audio",
      "input_audio": { "data": "data:audio/webm;base64,XXX..." }
    }]
  }],
  "stream": false,
  "extra_body": { "asr_options": { "enable_itn": false } }
}
```

**响应结构**：`choices[0].message.content` 直接是字符串（OpenAI 兼容）。

**音频规格**：≤ 10MB / ≤ 5 分钟；支持 webm/wav/mp3/aac/flac/ogg/opus 等。

---

## 2. 架构设计

### 2.1 后端抽象（关键：未来扩展不破坏调用方）

定义 `AsrProvider` trait/interface：

```rust
trait AsrProvider {
    async fn transcribe(audio_b64: &str, mime: &str, language: Option<&str>) -> Result<TranscribeResult>;
    async fn probe(api_key: &str) -> Result<()>;  // 测试连接，不消耗用量
}
```

- 第一个实现：`DashScopeAsr`
- 后续可加：`XfyunAsr` / `VolcanoAsr` / 自建本地 whisper.cpp server，**调用层零改动**

### 2.2 配置存储

KV 表存：

- `asr.provider` = `"dashscope"`
- `asr.api_key` = 明文（与一般 AI 模型 Key 同级别）
- `asr.model` = `"qwen3-asr-flash"`
- `asr.region` = `"beijing"` | `"singapore"`
- `asr.enabled` = `"1"` | `"0"`

### 2.3 对前端暴露的 4 个 API

| Command | 用途 |
|---------|------|
| `asr_get_config` | 读配置（默认值兜底） |
| `asr_save_config(config)` | 保存配置（启用时强校验 api_key） |
| `asr_test_connection(config)` | 走 `GET /compatible-mode/v1/models`：401/403 = 鉴权失败；其他 = 通过 |
| `asr_transcribe_audio({ audioBase64, mime, language? })` | 主调用 |

### 2.4 关键 Trait 实现要点

```rust
async fn transcribe(cfg, audio_b64, mime, lang) -> Result<...> {
    let data_url = format!("data:{};base64,{}", mime, audio_b64);
    POST /compatible-mode/v1/chat/completions
        body: {
          model,
          messages: [{
            role: "user",
            content: [{ type: "input_audio", input_audio: { data: data_url } }]
          }],
          stream: false,
          extra_body: { asr_options: { enable_itn: false, language: lang.filter(|l| l != "auto") } }
        }
        header: Authorization: Bearer {api_key}
    // 解析 choices[0].message.content
}
```

错误处理：HTTP 状态非 2xx → 返回带 status + body 的错误；响应 JSON 含 `error.message` → 透传给前端。

---

## 3. 前端通用 MicButton 组件（关键复用件）

### 3.1 状态机

```
idle ─click→ recording ─click→ transcribing ─done→ idle
                                              └─error→ error
disabled (ASR 未启用 / 浏览器不支持)
```

### 3.2 录音流程

```ts
// 启动
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const recorder = new MediaRecorder(stream);
recorder.ondataavailable = e => chunks.push(e.data);
recorder.start();

// 停止
recorder.stop();
const blob = new Blob(chunks, { type: recorder.mimeType });

// blob → base64（用 FileReader.readAsDataURL，避免大文件 btoa 栈溢出）
const dataUrl = await new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result as string);
  r.readAsDataURL(blob);
});
const audioBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

// 调后端
const { text } = await asrApi.transcribe({ audioBase64, mime: blob.type, language: "auto" });
onTranscribed(text);
```

### 3.3 Props 设计

```ts
interface MicButtonProps {
  onTranscribed: (text: string) => void;  // 必传，回调拿到文字怎么用调用方决定
  size?: "small" | "middle" | "large";
  disabled?: boolean;                     // 外部强制禁用
  language?: string;                      // 默认 "auto"
}
```

### 3.4 资源回收（必做，否则录完音红灯不灭）

- 卸载时 `stream.getTracks().forEach(t => t.stop())`
- 切走页面时同样释放
- 关闭时立即停 AudioContext + cancelAnimationFrame

---

## 4. 录音可视化（必做，体验关键）

### 4.1 实现：Web Audio API + AnalyserNode

抽成 hook（**MicButton 和 Modal 都要复用同一份，避免视觉不一致**）：

```ts
function useAudioLevel(stream, active, bandCount = 3) {
  // 创建 AudioContext + AnalyserNode (fftSize=256)
  // requestAnimationFrame 循环 getByteFrequencyData
  // 整体平均 → level（0-1，一阶低通平滑 alpha=0.5）
  // 分频段平均 → bands[]（低频在前、高频在后）
  // active=false 或 stream=null 自动清理
  return { level, bands };
}
```

### 4.2 UI 表现（统一风格）

**所有位置都用 3 条柱**（视觉一致性的关键）：

| 位置 | 样式 |
|------|------|
| **嵌入式 MicButton**（输入框旁） | 录音时按钮内 3 条 mini 柱（宽 2px，最大高 14px）+ 红色 `box-shadow` 光晕脉动 |
| **Modal 全屏录音** | 同 3 条柱（宽 6px，最大高 52px）放大版，外面胶囊容器 |

box-shadow 公式：

```css
box-shadow: 0 0 0 ${2 + level * 9}px rgba(255, 77, 79, ${0.18 + level * 0.35});
```

---

## 5. 接入策略（按位置归类）

### 5.1 短输入框（首选 `suffix`）

```tsx
<Input
  value={value}
  onChange={e => setValue(e.target.value)}
  suffix={
    <MicButton onTranscribed={text => setValue(prev => prev ? `${prev} ${text}` : text)} />
  }
  allowClear  // 别忘了清空按钮（与 suffix 可共存）
/>
```

适用：搜索框 / 标题 / 标签筛选 / 命令面板。

### 5.2 长 TextArea（label 标签栏挂按钮）

TextArea 不支持 suffix，把 mic 放到 label 行右侧：

```tsx
<div className="flex justify-between items-center">
  <span>描述</span>
  <MicButton onTranscribed={text => setDesc(prev => prev ? `${prev}\n${text}` : text)} />
</div>
<Input.TextArea value={desc} onChange={...} />
```

适用：任务描述 / AI 弹窗的目标 / 笔记参考材料。

### 5.3 AI 聊天输入框（特殊：mic 在发送按钮左侧）

```tsx
<TextArea ... />
<MicButton size="middle" />  // 在 TextArea 右侧、发送/停止按钮左侧
{streaming ? <Button>停止</Button> : <Button>发送</Button>}
```

### 5.4 受控 Form（antd Form / react-hook-form 等）

```tsx
<Form.Item name="title">
  <Input
    suffix={
      <MicButton onTranscribed={text => {
        const cur = form.getFieldValue("title") || "";
        form.setFieldValue("title", cur ? `${cur} ${text}` : text);
      }} />
    }
  />
</Form.Item>
```

### 5.5 富文本编辑器（Tiptap / ProseMirror / Slate）

工具栏单独一组，调编辑器命令插入文字到光标处：

```tsx
<MicButton onTranscribed={text => editor.chain().focus().insertContent(text).run()} />
```

### 5.6 不适合接入的位置（明确避免）

- ❌ API URL / API Key / 文件路径输入（结构化字符不好语音）
- ❌ 密码框
- ❌ Code 输入

---

## 6. 设置页 ASR 配置区

必备元素：

- 启用开关
- Provider 下拉（默认只有「阿里云百炼 DashScope」一项，预留扩展）
- API Key 输入（`Input.Password`，旁边一个**蓝色链接**「去申请」跳 `https://bailian.console.aliyun.com/`，必须用 `inline-flex + nowrap` 防止「去申请」和外链图标换行）
- 模型下拉（`qwen3-asr-flash` 唯一推荐）
- 区域下拉（北京 / 新加坡）
- 「保存」+「测试连接」按钮

链接打开方式：

- Tauri：`tauri-plugin-opener.openUrl(url)`
- Electron：`shell.openExternal(url)`
- Web：`window.open(url, "_blank")`

---

## 7. 全局快捷键 + QuickCaptureAsrModal（可选高级功能）

### 7.1 注册系统级热键

如 `Ctrl+Shift+V`，触发后：

1. 唤起主窗口（前置 + 取消最小化）
2. 通过事件机制通知前端打开 Modal

### 7.2 Modal 行为

- 打开后**自动开始录音**（无需用户再点）
- 显示放大版 3 条柱波形 + 时长 + 大胶囊光晕
- 点「停止并识别」→ 转写 → 显示文字 textarea（可手动编辑）
- 提供 4-5 个动作：
  1. **AI 智能解析为任务**（默认推荐，主按钮）
  2. **直接保存为任务**
  3. **保存为笔记**
  4. **复制到剪贴板**
  5. 重新录音
- 关闭 Modal 必须释放麦克风

---

## 8. AI 智能解析任务（可选高级功能）

新增一个 Command：`ai_extract_task_from_text(text) → TaskSuggestion`。

### 8.1 Prompt 设计要点

```
当前时间: {now}
今天日期: {today}

返回 JSON（不要 markdown 代码块）：
{
  "title": "任务标题（去掉时间/提醒等元信息）",
  "dueDate": "YYYY-MM-DD HH:MM:SS" 或 null,
  "remindBefore": null|0|15|30|60|180|1440|10080,
  "priority": 0|1|2,
  "important": true|false,
  "reason": "简短解释"
}

时间解析规则（关键，要写详细）：
- "明天下午三点" → today+1 15:00:00
- "30 分钟后" → now + 30min
- "周五" → 本周或下周最近周五
- 没明确时间 → null
- 只有日期没时间 → 当天 23:59:59

🔴 JSON 字符串字段严禁用英文双引号 "，引用名称用中文「」或『』。
```

### 8.2 解析容错

写一个 `parse_task_suggestion_response` 函数，做三轮兜底：

1. 直接 JSON.parse
2. 剥 ```` ```json ... ``` ```` 围栏
3. 截取首个 `{` 到最后一个 `}` 的子串再 parse

---

## 9. 浏览器/平台 注意事项

- **Windows WebView2**：getUserMedia 默认允许（首次会弹系统权限框）
- **macOS WKWebView / 打包应用**：需要在 `Info.plist` / `entitlements` 加 `NSMicrophoneUsageDescription`，否则首次录音被拒
- **Linux WebKitGTK**：通常默认允许
- **CSP**：`media-src 'self' blob:` 允许 blob URL（录音的 MediaRecorder 输出）

---

## 10. 实施顺序建议

按优先级落地（每个阶段独立可发版）：

| 阶段 | 内容 | 工时 |
|------|------|------|
| **P1** | 后端 ASR 抽象 + DashScope 实现 + 设置页配置 | 1 天 |
| **P2** | 通用 MicButton 组件（含波形可视化）+ 接入 5-8 个核心输入位置 | 0.5-1 天 |
| **P3** | 全局快捷键 + QuickCaptureAsrModal | 0.5 天 |
| **P4** | AI 智能解析任务 | 0.5 天 |

P1+P2 完成就能 80% 满足需求，P3/P4 是体验提升项。

---

## 11. 验收清单

- [ ] 设置页填入 API Key 后「测试连接」返回成功
- [ ] 任意接入位置点 mic → 录音时按钮变红 + 波形跳动
- [ ] 停止录音后 1-3 秒文字写入输入框
- [ ] 关闭 Modal/切页面后系统状态栏录音灯熄灭（资源释放）
- [ ] 未启用 ASR 时点击 mic 提示并引导到设置页
- [ ] 麦克风权限被拒时给清晰错误提示
- [ ] 全局快捷键能在应用最小化时唤起 Modal

---

## 12. 关键字段命名约定（避免 serde 坑）

如果用 Rust + serde，`TaskSuggestion` 结构体的 `remind_before_minutes` 字段：

```rust
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSuggestion {
    pub title: String,
    // 关键：rename + alias 同时用，前后端 / AI prompt 统一为 remindBefore
    #[serde(default, rename = "remindBefore", alias = "remindBeforeMinutes")]
    pub remind_before_minutes: Option<i32>,
    // ... 其他字段
}
```

否则 camelCase 默认会变成 `remindBeforeMinutes`，跟 prompt / 前端 TS 类型对不上，AI 输出的字段会被 serde 忽略变成 `None`。

---

## 参考实现（本项目）

- 后端：`src-tauri/src/services/asr/`、`src-tauri/src/commands/asr.rs`
- 前端：`src/components/MicButton.tsx`、`src/components/QuickCaptureAsrModal.tsx`
- 设置页：`src/components/settings/AsrSection.tsx`
- 全局快捷键：`src-tauri/src/services/shortcut.rs` 中 `global.asrCapture` binding
- AI 解析：`src-tauri/src/services/ai.rs::extract_task_from_text`
