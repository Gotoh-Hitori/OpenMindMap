> 历史独立参考：本文件描述聊天 API 示例。OpenMindMap v1.0 是纯前端项目，没有该后端、AI 调用或 API Key 配置；此文档不属于部署步骤。

# DeepSeek Web Chat API 使用指南

## 1. 项目里的 API 架构

这个项目采用的是：

- 前端只请求自己的后端
- 后端代理请求 DeepSeek 或兼容 OpenAI Chat Completions 的服务
- API Key 不放前端
- 每个会话可以绑定不同的 API 配置、模型、思考模式

调用链路：

```txt
Browser
  -> POST /api/chat
  -> Node/Express Backend
  -> {baseURL}/chat/completions
```

---

## 2. 当前项目实际暴露的接口

### `POST /api/chat`

用途：

- 发送一轮聊天请求
- 支持系统 Prompt
- 支持多轮消息
- 支持切换模型
- 支持自定义 API 配置
- 支持 DeepSeek thinking / reasoning_effort

请求体：

```json
{
  "model": "deepseek-v4-flash",
  "systemPrompt": "You are a concise and reliable Chinese assistant.",
  "apiConfig": {
    "baseURL": "https://api.deepseek.com",
    "apiKey": "sk-xxx"
  },
  "deepseekOptions": {
    "thinkingEnabled": true,
    "reasoningEffort": "high"
  },
  "messages": [
    {
      "role": "user",
      "content": "你好，你是谁？"
    }
  ]
}
```

说明：

- `apiConfig` 可选
- 不传 `apiConfig` 时，后端使用服务端 `.env` 里的默认 `DEEPSEEK_API_KEY`
- 传了 `apiConfig` 时，后端使用该配置代理请求
- `messages` 里只传 `role` 和 `content`
- 不要把上一轮返回的 `reasoningContent` 再传回去

返回体：

```json
{
  "reply": "我是你的智能助手，可以帮助你回答问题、整理信息和完成任务。",
  "reasoningContent": "可选，模型返回的推理过程",
  "usage": {
    "promptTokens": 120,
    "completionTokens": 45,
    "totalTokens": 165,
    "promptCacheHitTokens": 0,
    "promptCacheMissTokens": 120,
    "reasoningTokens": 30
  },
  "model": "deepseek-v4-flash"
}
```

---

## 3. 模型使用规则

### 内置 DeepSeek 模式

当不传 `apiConfig` 时，只允许这些模型：

- `deepseek-v4-flash`
- `deepseek-v4-pro`
- `deepseek-chat`
- `deepseek-reasoner`

其中：

- `deepseek-chat` 会被后端映射为 `deepseek-v4-flash`，并关闭 thinking
- `deepseek-reasoner` 会被后端映射为 `deepseek-v4-flash`，并开启 thinking
- `deepseek-chat` 和 `deepseek-reasoner` 属于兼容别名

### 自定义 API 模式

当传入 `apiConfig` 时：

- 模型名不再受内置白名单限制
- 后端会直接拿你传的 `model` 去请求对应服务
- 适合接入其他兼容 OpenAI Chat Completions 的平台

---

## 4. DeepSeek 参数处理规则

如果模型属于 DeepSeek 规则范围，后端会构造：

```json
{
  "model": "deepseek-v4-pro",
  "messages": [...],
  "thinking": {
    "type": "enabled"
  },
  "reasoning_effort": "high",
  "stream": false
}
```

规则如下：

- `thinkingEnabled = true` -> `thinking.type = "enabled"`
- `thinkingEnabled = false` -> `thinking.type = "disabled"`
- 开启 thinking 时才会附带 `reasoning_effort`
- 当前项目固定走非流式：`stream: false`

---

## 5. 后端对上游地址的处理

项目支持两种 `baseURL` 写法：

### 推荐写法

```txt
https://api.deepseek.com
```

### 也能自动兼容的写法

```txt
https://api.deepseek.com/chat/completions
```

后端会自动归一化，最终拼成：

```txt
{baseURL}/chat/completions
```

也就是说：

- 末尾多写了 `/chat/completions` 也能处理
- 末尾多余 `/` 也会被清理

---

## 6. 请求校验规则

后端会校验：

- `model` 必须是非空字符串
- `systemPrompt` 必须是字符串
- `messages` 必须是非空数组
- `messages[].role` 只能是 `user` 或 `assistant`
- `messages[].content` 必须是非空字符串
- `apiConfig.baseURL` 必须是合法 URL
- `apiConfig.apiKey` 必须是非空字符串
- `deepseekOptions.thinkingEnabled` 必须是布尔值
- `deepseekOptions.reasoningEffort` 只能是：
  - `high`
  - `max`

---

## 7. 前端实际调用方式

当前项目前端调用：

```ts
await fetch("/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});
```

其中：

- 默认开发环境可走 `/api/chat`
- 如果配置了 `VITE_API_BASE_URL`，会优先走该地址
- 适合前后端分离部署

---

## 8. 在其他项目中复用的推荐方式

## 方案 A：继续复用这个后端代理

适合：

- 你要保证 API Key 不暴露
- 你要支持多 API、多模型、多会话
- 你要统一处理错误和 token usage

你的其他项目只需要请求：

```http
POST /api/chat
```

前端不用直接连 DeepSeek。

### 推荐请求示例

```json
{
  "model": "deepseek-v4-flash",
  "systemPrompt": "你是一个专业助手。",
  "deepseekOptions": {
    "thinkingEnabled": true,
    "reasoningEffort": "high"
  },
  "messages": [
    {
      "role": "user",
      "content": "帮我总结下面这段文字"
    }
  ]
}
```

### 适合做成通用 SDK 的字段

建议在其他项目里统一封装一个：

- `model`
- `systemPrompt`
- `messages`
- `apiConfig`
- `deepseekOptions`

---

## 方案 B：直接照抄这个后端逻辑

适合：

- 你在做新项目
- 你也想做代理层
- 你要兼容 DeepSeek 和其他 OpenAI-compatible 服务

核心逻辑只有 4 步：

1. 校验前端请求
2. 解析模型与 thinking 规则
3. 归一化 `baseURL`
4. 请求 `{baseURL}/chat/completions`

---

## 9. 其他项目最小实现模板

## Node.js 后端最小代理示例

```ts
app.post("/api/chat", async (req, res) => {
  const { model, systemPrompt, messages, apiConfig, deepseekOptions } = req.body;

  const baseURL = (apiConfig?.baseURL || "https://api.deepseek.com")
    .replace(/\/chat\/completions\/?$/i, "")
    .replace(/\/+$/, "");

  const apiKey = apiConfig?.apiKey || process.env.DEEPSEEK_API_KEY;

  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content
      }))
    ],
    stream: false
  };

  if (deepseekOptions) {
    payload.thinking = {
      type: deepseekOptions.thinkingEnabled ? "enabled" : "disabled"
    };

    if (deepseekOptions.thinkingEnabled) {
      payload.reasoning_effort = deepseekOptions.reasoningEffort;
    }
  }

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  res.json(data);
});
```

---

## 10. 推荐的前端封装方式

```ts
type ChatPayload = {
  model: string;
  systemPrompt: string;
  apiConfig?: {
    baseURL: string;
    apiKey: string;
  };
  deepseekOptions?: {
    thinkingEnabled: boolean;
    reasoningEffort: "high" | "max";
  };
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
};

export async function sendChatMessage(payload: ChatPayload) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || "Request failed.");
  }

  return data;
}
```

---

## 11. 接入其他项目时的注意事项

- 不要把 API Key 放前端源码
- 不要把 `reasoningContent` 回传到下一轮消息中
- `baseURL` 最好传根地址，不要手动拼 `/chat/completions`
- 内置 DeepSeek 模式下，模型要受白名单控制
- 自定义 API 模式下，要自己保证模型名和平台兼容
- 最好统一把上游错误转成友好的业务错误
- 建议保留 `usage` 字段，方便做 token 统计和成本控制

---

## 12. 本项目的最佳实践总结

这个项目的 API 使用方式，适合抽象成一个“统一聊天代理层”：

- 前端只管会话和 UI
- 后端统一管理 API Key、模型规则、错误处理、usage 返回
- 用 `apiConfig` 支持不同供应商
- 用 `deepseekOptions` 支持 DeepSeek 专有参数
- 用统一的 `/api/chat` 对外暴露能力

如果你要把这套方案迁移到其他项目，最推荐保留的就是这 3 个设计：

1. 统一后端入口：`POST /api/chat`
2. 请求结构统一：`model + systemPrompt + messages + apiConfig + deepseekOptions`
3. 响应结构统一：`reply + reasoningContent + usage + model`

---

## 13. 一句话复用建议

如果你要在其他项目继续用这套能力，直接复用下面这个契约最稳：

### 请求

```json
{
  "model": "deepseek-v4-flash",
  "systemPrompt": "string",
  "apiConfig": {
    "baseURL": "string",
    "apiKey": "string"
  },
  "deepseekOptions": {
    "thinkingEnabled": true,
    "reasoningEffort": "high"
  },
  "messages": [
    {
      "role": "user",
      "content": "string"
    }
  ]
}
```

### 响应

```json
{
  "reply": "string",
  "reasoningContent": "string",
  "usage": {
    "promptTokens": 0,
    "completionTokens": 0,
    "totalTokens": 0,
    "promptCacheHitTokens": 0,
    "promptCacheMissTokens": 0,
    "reasoningTokens": 0
  },
  "model": "string"
}
```
