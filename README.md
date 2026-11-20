# Magpie 跨供应商缓存控制

无需额外 npm 依赖的 Magpie gateway middleware 与配置页面。默认关闭缓存控制：请求原样转发，不加入随机标记、不采集缓存使用量，也不输出本插件日志。需要时从「缓存控制」页面主动启用。覆盖 Magpie 的四种客户端协议，并提供 Bedrock Converse、Cohere v2、Ollama Chat/Generate 和 Vertex Gemini 的格式适配。

这是尽量规避提示词缓存的工具，不是清空供应商服务端缓存的接口，也不保证所有供应商的缓存命中数都是零。禁用缓存通常会增加输入费用和延迟；新增标记也可能影响模型行为。

## 安装

在项目根目录执行：

```powershell
magpie plugin add "D:/AI/AI-IDE/Magpie/plugins/cache-control"
```

如需明确保存配置：

```powershell
$cacheOptions = Get-Content -Raw ./plugins/cache-control/options.example.json
magpie plugin options magpie-middleware-cache-control $cacheOptions
```

也可以在 Magpie 的 Plugins → Installed 中编辑该插件的 Options。包名为 magpie-middleware-cache-control。网关中间件继续由 moejs 执行；main 入口由 Magpie 的 Bun 插件宿主启动一个本地配置页面服务，不注册供应商，也不代发模型生成请求。首次升级到包含页面服务的版本后，请重新启用插件或重开配置页。

启用插件后，Magpie 左侧 Plugins 分组里会出现「缓存控制」标签页。首次打开默认选中「关闭（默认）」，其余策略控件停用；切换模式即可编辑。页面读取现有设置，允许配置 Gemini 缓存引用策略、为明确指定的供应商开启 Responses 显式模式，以及控制诊断日志；点「保存设置」后，调用 Magpie 页面桥的 magpie.options.set 写入本插件选项，下一次请求即可使用。已有明确保存的设置会保留，不会被新的默认值覆盖。页面包含中英文文案，跟随 Magpie 语言，并使用 Magpie 主题变量。

本项目不自动改动现有供应商、密钥或插件配置。模型过滤在 2026-11-20 使用 Magpie Web 0.1.4582、运行中的网关 0.1.4574 和真实插件配置验证：providers:list 仍返回 Kiro，但 /v1/models 的 owned_by 中没有 Kiro，页面最终将其隐藏。

配置页提供实时策略预览：轮数策略显示固定的 N+1 轮干预起点，比例策略显示允许缓存与逐请求扰动的估算范围，预览不会发送模型请求或自动保存。供应商选择旁标明默认、继承或独立策略；Gemini 与 Responses 专项设置可按需展开。底部保存栏持续显示未保存、保存中、成功或失败状态，保存会处理所有配置范围的修改。校验失败时展开对应设置并聚焦错误字段，草稿保持可编辑。

设置内容在独立区域滚动，保存栏单独占位，不覆盖策略选项或错误字段。下拉框使用统一的 44px 高度和随主题变化的箭头，保留原生菜单及键盘选择，避免 macOS / WebKit 原生外观导致控件高度不一致。读取及保存期间，保存按钮保持禁用。

## 配置

```json
{
  "mode": "passthrough",
  "log": false,
  "pageServicePort": 3489,
  "cachedContent": "reject",
  "openaiExplicitProviders": [],
  "rotation": { "strategy": "request", "turns": 10, "tokens": 8000, "style": "marker" },
  "providers": {}
}
```

| 配置 | 默认值 | 作用 |
| --- | --- | --- |
| mode | passthrough | 默认关闭；可改为 disable-explicit 或 bust |
| log | false | 启用控制后，可单独打开以记录措施和可观察到的缓存 token 数 |
| cachedContent | reject | Gemini 显式缓存引用的处理：reject 或 drop |
| openaiExplicitProviders | [] | 明确支持新版 Responses 显式缓存模式的供应商 id 列表；默认不注入专有字段 |
| rotation.strategy | request | bust 的干预起点，可选 request（立即）、turns（轮数）、tokens（估算 Token）或 percent（输入比例） |
| rotation.turns | 10 | 允许缓存的前 N 个用户轮次，1 到 1000000 的整数 |
| rotation.tokens | 8000 | 允许缓存的估算历史 Token 上限，1 到 1000000000 的整数 |
| rotation.percent | 5 | 使用 percent 策略时保留的输入前缀比例，支持 0 到 100 及小数 |
| rotation.style | marker | 文本扰动形式：marker、punctuation、whitespace；旧配置保留原标记行为 |
| providers | {} | 按 Magpie 供应商 id 保存的独立策略；初始为空，未配置的供应商使用默认策略 |
| pageServicePort | 3489 | 本地配置页面服务端口，1 到 65535；只在根级配置，修改后需重新启用插件 |

未保存任何 Options、选项为空，或未指定 mode 时，也默认关闭。只设置 log 不会自动开启缓存控制。主动选择 bust 才会修改系统提示词。未知配置项和无效类型在 onRequest 中返回 400，避免拼写错误导致策略悄悄失效。

### 按 Magpie 供应商独立配置

配置页新增「配置范围」下拉框，通过 Magpie 的 providers:list 页面权限读取供应商名称和 id，不读取 API key、账号凭证或请求正文。默认策略初始为关闭，本插件不改变供应商本身的缓存设置。所有新供应商在未手动设置前都继承该关闭策略；已有手动保存的默认策略会保留，不会在升级时重置。

选择一个供应商，即可独立设置开关、前 N 轮 / Token 阈值、扰动样式、缓存引用处理和日志。切换供应商会保留尚未保存的草稿，点击「保存设置」会一起校验并保存所有修改；若某个草稿有错误，会切回该供应商提示修正。刷新供应商列表不清除草稿。「移除单独配置」只移除当前供应商的覆盖，保存后恢复继承默认策略。列表读取失败时，默认策略及已保存供应商 id 仍可编辑。

配置范围会过滤供应商列表中标记为关闭的条目（Magpie 的 off: true，也兼容 enabled: false、disabled: true）。已配置独立策略的条目以「[已配置]」标识，编辑中的条目另标「[未保存]」；这里的已配置也包含明确设置为关闭缓存控制的独立策略，与供应商本身是否启用分开。刷新后当前供应商若已关闭，将切回默认策略，已有配置和草稿保留，重新启用后可继续编辑。若该供应商留下无效草稿，保存会提示先启用并修正，不会丢弃草稿或聚焦其他供应商的字段。

当前真实宿主的 providers:list 只返回 id 和 name。页面因此还会读取网关 /v1/models，按 owned_by 与供应商 id 匹配，只列出有可选模型的供应商。它不以模型 id 的斜杠前缀推断供应商，避免路由别名误判。明确的 off / enabled / disabled 标志仍优先生效；历史策略和草稿不会把不可选条目重新加入列表。已启用但暂时没有可选模型的供应商也会隐藏，这与精确的供应商开关状态不同。

### 模型名单如何到达配置页

静态插件页的 connect-src 'none' 不允许直接 fetch 网关；当前宿主也没有 models:list 页面读取权限。本插件使用 Magpie 原生支持的 magpie.page.service 和 magpie.service：入口页用宿主桥定位本插件的配置页面服务，服务页再通过 Magpie 的父窗口消息协议握手。配置读取、保存和主题同步仍由宿主处理，声明权限仍由宿主校验；服务页不再跨域加载 wails.localhost 的 bridge.js。Magpie Web 下使用宿主服务代理，浏览器访问远程 Magpie 时也不会错误地读取浏览器本机的网关；桌面窗口连接宿主本机的页面服务。

服务页面不再要求 bridge 查询参数。缺少参数或旧桌面地址不会返回 open-from-magpie JSON；直接在独立浏览器标签页打开时会显示从 Magpie 侧栏重新打开的说明。入口页暂时保留旧参数，兼容升级时尚未重新加载的服务进程。握手超时会提供重新连接操作，不会让配置控件一直无反馈地停用。

页面服务只监听 127.0.0.1，以宿主提供的 MAGPIE_ADDR 定位本机网关，未提供时使用 127.0.0.1:3425。它只请求 GET /v1/models，向页面返回去重的 providerIds 和模型总数；不读取供应商配置文件、调用方密钥或账号凭证，不转发任意 URL 或请求正文，不提供生成及写入接口。模型元数据只在打开页面或刷新供应商列表时读取，缓存控制默认仍关闭。

如果第一次读取模型失败（包括网关要求鉴权、超时或返回不完整的数据），保留原供应商列表并显示提示；刷新失败时沿用上一次成功读取的模型范围。只有成功确认的空列表才隐藏所有供应商，默认策略始终可选。供应商失去可选模型后，当前编辑范围回到默认策略，配置和草稿保留，模型恢复后可继续编辑。若隐藏条目有无效草稿，保存会提示先恢复其模型并修正，不会丢弃草稿或将错误聚焦到其他供应商。

策略按实际路由的 ctx.provider.id 精确匹配，不依据模型名、供应商显示名称、账号或路由组名称猜测。新建一个独立条目时，条目中没有写明的字段使用插件初始默认值，mode 默认为 passthrough；它不是对默认策略逐字段合并。页面保存的是当前供应商的完整策略。没有独立条目的供应商继续使用根级默认策略；如果用户主动开启了根级默认策略，则未单独设置的供应商会继承该主动开启的默认值。供应商显式设为 passthrough 可独立固定为关闭。

示例：A 在前 10 轮之后逐请求使用标点扰动，B 在超过 12000 个估算历史 Token 后使用空白扰动，C 保持关闭，其余供应商也默认关闭。provider-a / provider-b / provider-c 只是示例，请使用页面列出的真实 id：

```json
{
  "mode": "passthrough",
  "providers": {
    "provider-a": {
      "mode": "bust",
      "rotation": { "strategy": "turns", "turns": 10, "style": "punctuation" }
    },
    "provider-b": {
      "mode": "bust",
      "rotation": { "strategy": "tokens", "tokens": 12000, "style": "whitespace" }
    },
    "provider-c": { "mode": "passthrough" }
  }
}
```

默认配置文件仍只包含空 providers 对象，不会自动启用上述示例。非法条目在请求入口统一返回 400；不支持在一个供应商条目中再次嵌套 providers。轮数和 Token 仍按该次请求携带的完整可见历史计算，不是每个供应商累计接收的请求数或计费量。

**路由阶段限制：** 存在至少一条独立配置时，onRequest 只校验配置，不修改请求；等路由确定后才在 onProvider 应用当前供应商的策略，因此 A 的改写不会影响关闭的 B。重试切换供应商会重新选择策略，并隔离计数/使用量；同一请求内同一供应商的重试复用该供应商的扰动值。

Magpie 的 onProvider 无法拒绝请求。若此阶段遇到隐藏历史、无法安全插入空白、未知协议等，插件会保持该阶段请求原样，记录 phase=provider-skipped 的警告，不声称策略已执行。这种启用策略的执行失败警告即使关闭诊断日志也会记录，且不含提示词或扰动串。它不是强制禁止缓存的安全边界；该限制也会在配置页显示。只有未设置任何独立条目时，旧的默认策略仍可在 onRequest 阶段对不支持的输入返回 400/409。

### 三种模式

- passthrough：原样转发，不处理缓存，不采集使用量，不输出本插件日志。
- disable-explicit：移除已知显式控制，不改变系统提示词。对于自动缓存的供应商，这不代表禁用隐式缓存。
- bust：按策略扰动缓存。request 立即逐请求清理显式控制并修改系统提示词；turns/tokens 先允许阈值内历史正常缓存，超过阈值后每次请求在固定的后续消息起点加入新随机标记，保留早期历史和显式缓存设置。阈值策略不改原有 prompt_cache_key，以保留早期前缀的路由亲和性；立即策略仅在原本有该字段时将它随机化。

同一请求内同一供应商的重试复用其标记，不会重复添加；存在独立配置时，不同供应商使用各自策略和标记。超过阈值后的每个新请求，即使历史完全相同，也都会生成不同标记，不会在多轮或多次请求之间复用。随机值使用标准 Date/Math，不是安全隔离令牌。

### 文本扰动优先

启用 bust 时优先修改模型输入文本，不自动改为供应商原生缓存边界方案。即使配置了 openaiExplicitProviders，文本扰动模式也不会额外注入本插件的 prompt_cache_options.mode=explicit 专项参数；该专项仅在主动选择 disable-explicit 时使用。已有用户偏好会保留，配置页在文本扰动模式下将专项控件停用。调用方原有的缓存设置仍按所选策略处理：立即策略继续清理显式标记，阈值策略保留早期缓存设置和原缓存键。

页面新增「文本扰动形式」：

| 形式 | 配置值 | 行为与限制 |
| --- | --- | --- |
| 完整随机标记（默认） | marker | 保留原来的 [magpie-cache-control:时间戳:随机串:随机串]；旧配置无需迁移 |
| 随机标点串 | punctuation | 将同一类随机值编码为仅含 ASCII 标点的文本，不包含插件名或字母数字 |
| 空格 / Tab（实验） | whitespace | 将随机值编码为 ASCII 空格和 Tab；不使用零宽或其它 Unicode 隐形字符 |

三种形式均进入模型上下文，不是模型不可见的元数据；本项目没有验证哪种更不影响理解，也不承诺节省 Token 或一定破坏缓存。空白尤其可能被网关或供应商清理/规范化，因此不会在其它形式无效时自动降级成空白，也不会在空白不可用时悄悄改成可见标记。样式不会向模型添加“忽略此标记”等新指令。

空白只合并到目标的第一个非空、未签名的文本位置，不创建空白专用 system/user 消息或独立纯空白块，不改动工具 JSON、思考块或签名。立即策略需要原本就有非空系统提示词 / instructions；阈值策略需要边界用户消息以可编辑文本开头。缺少合适文本、媒体在首位或首块带签名时，默认策略入口分别返回 400/409；存在供应商独立配置时则保持请求原样并记录 provider-skipped，见上述路由阶段限制。若需支持媒体在首位或无系统提示词的请求，请主动选择完整标记或标点串。

例如前 10 轮可缓存，此后每个请求使用新的标点扰动：

```json
{
  "mode": "bust",
  "rotation": { "strategy": "turns", "turns": 10, "style": "punctuation" }
}
```

第 1–10 轮仍完全不改，第 11 轮开始在第 11 轮消息开头加入每请求不同的标点文本。空白样式对已有首个文本块做前缀合并；完整标记与标点在多段内容中使用对应协议的文本块。所有样式在同一请求的 provider 重试中都保持一致，日志只记录样式名称，不包含实际扰动字符串。立即策略若需要改写已有 prompt_cache_key，仍使用长度受限的 ASCII 元数据标记，不把可能较长的空白/标点串写进缓存键。

### 按比例保留输入前缀

在「按策略扰动缓存」中选择「按比例保留输入前缀」。例如配置为 5%，插件会在每次请求约 5% 的位置插入新标记。可为各供应商分别配置。

```json
{
  "mode": "bust",
  "rotation": { "strategy": "percent", "percent": 5, "style": "marker" }
}
```

比例根据每次请求中可见的系统提示词和消息文本重新估算，按 ASCII 字符权重 1、其他 Unicode 码点权重 4 计数。Responses 的函数和自定义工具调用参数及文本输出也计入估算。如果落点在工具调用、工具输出、签名或带注释的块内，插件会移到后续可编辑文本。工具定义、媒体和供应商隐藏上下文不计入估算。请求总长度变化时，插入位置也可能移动。实际缓存命中率取决于供应商的分词、缓存粒度和前缀匹配。

0% 从首个可编辑文本开始，100% 原样转发。请求包含隐藏历史引用，或落点之后没有可编辑文本时，沿用阈值策略的拒绝或供应商阶段跳过行为。缓存键和显式断点保留。

Responses 诊断日志会同时记录预留比例、估算插入位置，以及上游返回的 inputTokens、cacheReadTokens 和 cacheHitPercent。命中率按 Responses 的 cached_tokens / input_tokens 计算，其中 input_tokens 已包含缓存读取量。只有上游返回这两项统计时才计算。缓存命中取决于上游能否找到已经写入、仍可复用的前缀，以及该模型可查找的缓存边界。经其他网关转发时，请在启用该策略的实例上对照日志。

### 前 N 轮允许缓存，之后每个请求都扰动

页面中选择「按策略扰动缓存」，再选择「立即：每次请求」「前 N 轮允许缓存，之后每次请求扰动」或 Token 阈值。插件整体仍默认关闭。旧配置没有 rotation 时保留原来的立即逐请求行为。rotation 仍是兼容旧配置的字段名，但 turns/tokens 现在表示单次阈值，不再表示循环分桶。

例如前 10 个用户轮次允许缓存，第 11 轮开始每次请求都扰动：

```json
{
  "mode": "bust",
  "rotation": { "strategy": "turns", "turns": 10 }
}
```

第 1–10 个用户轮次：请求原样保留，不插入标记、不清理显式缓存设置。第 11 轮及以后：每个新请求都在第 11 轮用户消息的开头加入不同标记，系统提示词、工具定义、前 10 轮完整历史和原缓存键保持不变，允许这些早期前缀继续命中。第 12、21、22 轮也始终在第 11 轮处放新标记，不会等到第 21 轮才再换一次，更不会把整段系统提示词随机化。

轮数按完整可见历史中的用户消息计算，不是 HTTP 请求数；Anthropic tool_result、Bedrock toolResult、Gemini functionResponse 等纯工具结果消息不另计用户轮次。工具循环不会使前 10 轮额度提前耗尽；但一旦已超出额度，工具循环产生的每个新请求同样会使用新标记。同一请求内部的供应商重试则复用该次标记。

例如前 8000 个估算历史 Token 允许缓存，超过后每次请求都扰动后续部分：

```json
{
  "mode": "bust",
  "rotation": { "strategy": "tokens", "tokens": 8000 }
}
```

估算值不超过 8000 时不改请求；首次超过后，每次新请求都生成不同标记，不会每 8000 Token 组成一组。为了不破坏工具参数、签名或消息格式，标记放在首次越过阈值的那个用户轮次开头，而不是插入文本、JSON 或思考块的中间。这意味着该轮中阈值前的部分文本也可能不再命中；它不是精确逐 Token 的截断器。

对当前请求携带的历史只估算一次，不会把每次重传的旧历史反复累加，也不累计账号的计费 Token。包括用户、助手、思考文本及可见工具调用/结果文本，排除静态 system/developer 提示词、工具声明以及已识别的图像/音频等媒体字节。简单估算规则为 ASCII 字符约 4 个/Token、其它 Unicode 码点约 1 个/Token，含可见文本的每条消息再加 4 个 Token 开销；不同模型的真实分词可能显著不同。

在阈值策略的前后两个阶段，显式 cache_control、prompt_cache_breakpoint、缓存保留参数、原缓存键和 Bedrock cachePoint 都会保留，以允许早期前缀命中。文本扰动模式下，OpenAI explicit-only 专项始终暂停；如需该原生专项，应主动选择 disable-explicit。原始请求本来没有显式缓存设置的，插件不会自动开启它。供应商仍可能写入新的后续缓存；新标记用于避免这些后续内容在下次请求复用，并非禁止供应商缓存写入。

不记录跨请求的稳定分桶或历史哈希。阈值根据当前请求的完整可见历史判断；超过阈值后的相同请求，在独立 runtime 或进程重启后也会生成不同标记。默认关闭和阈值内阶段不会为随机化而改变消息。当前支持的格式中，标记使用相应的用户文本 / text / input_text 内容块，工具参数、工具结果和思考签名不被改写。

此功能允许早期前缀缓存，并通过后续消息的新标记尽量避免后续内容匹配；不能保证供应商一定命中早期缓存，也不能清空其服务端缓存或设置 TTL。历史删减、压缩、重放或分支可能使可见计数退回阈值以内，这不是跨截断历史的持久会话计数器。

**需要完整可见历史。** 请求携带 Responses previous_response_id/conversation、item_reference、Gemini/Vertex cachedContent 或 Ollama context 引用时，不会猜测引用中的轮数或 Token。仅用默认策略时会在改写前返回 409；存在供应商独立配置时，路由后不能拒绝请求，会保留请求并记录 provider-skipped，即使 cachedContent 配成 drop 也一样。Ollama Generate 没有结构化对话历史，同样不能使用阈值策略；请改用 Ollama Chat 或立即逐请求策略。未标记的历史截断无法被自动识别，应由调用方提供完整历史。默认关闭模式及 disable-explicit 不受这一阈值限制。

日志开启后，rotation 包含 strategy、threshold、phase、turns、estimatedTokens、boundaryTurn，不含正文或标记。phase=allow-cache 表示阈值内原样保留；bust-tail 表示每次请求扰动固定尾部起点。若其它中间件在处理后加入隐藏历史引用或移除尾部边界，onProvider 不能拒绝请求，会保持该阶段请求并记录 provider-stage-rotation-history-unavailable 警告。

### 协议适配

Magpie 当前只向中间件暴露 anthropic、chat、responses、gemini 四种 ctx.protocol。DeepSeek、Qwen、OpenRouter 等使用兼容 Chat 接口时复用 chat 适配，不把供应商品牌当作独立协议猜测。下表中的扩展协议是已经实现和测试的原生请求格式适配，只有宿主实际传入相应标识/原生请求时才会使用；插件本身不为 Magpie 增加 HTTP 端点、供应商路由或协议转换。

下表为立即逐请求策略的位置；阈值策略则定位对应格式中首个不缓存的用户轮次，在该用户消息前插入文本块，而不动系统提示词。

| 客户端协议 | 立即策略的标记插入位置 |
| --- | --- |
| Anthropic | system 字符串开头，或 system 数组的第一个 text 块 |
| Chat Completions | 第一条 system/developer 消息的开头；没有时新增首条 system 消息 |
| Responses | instructions 开头；保留原来的 input 和服务端会话引用 |
| Gemini | systemInstruction.parts / system_instruction.parts 的首个 text 部分 |
| Vertex Gemini | 同 Gemini，包含 cachedContent 引用保护 |
| Bedrock Converse / ConverseStream | system 的首个 {text: ...} 块；不是 InvokeModel 的通用格式 |
| Cohere Chat v2 | 首条 system 消息的字符串或 text 内容块；没有时新增 system 消息 |
| Ollama Chat | 首条 system 消息的字符串；保留原有 messages、images 和工具调用 |
| Ollama Generate | system 字符串开头；保留 prompt、context、template、options 和 keep_alive |

识别的协议标识：

- Anthropic：anthropic、anthropic-messages。
- Chat：chat、chat-completions、openai-chat、openai-compatible。
- Responses：responses、openai-responses。
- Gemini：gemini、vertex、vertex-gemini，后两者专指 Vertex 上的 Gemini 格式。
- Bedrock Converse：bedrock、bedrock-converse。Bedrock 上的 Anthropic InvokeModel 请求应按 Anthropic 格式传入；不把所有 Bedrock InvokeModel 的厂商格式混为一谈。
- Cohere v2：cohere、cohere-v2；不适用于 v1 的 preamble 格式。
- Ollama：ollama-chat、ollama-generate；不使用有歧义的 ollama 标识猜测端点。

Ollama Generate 的 raw=true 会绕过系统提示词模板，因此 bust 对该格式在修改前返回 400；需要保留 raw 模式时请选择 disable-explicit 或 passthrough。keep_alive 是模型驻留设置，不当作缓存开关修改。对于 Ollama/Cohere 未提供明确缓存 token 统计的响应，保持 unknown，不从 prompt_eval_count 或计费 token 的差值推断缓存命中。

Bedrock 会移除 system、messages[].content 和 toolConfig.tools 中独立的 cachePoint 联合类型块，而不是只删除字段后留下无效的 {}。additionalModelRequestFields 上的自动 cache_control 也会清理。toolSpec.inputSchema.json、toolUse.input 和 toolResult.content[].json 中的同名业务数据均保留。

disable-explicit 以及 bust 的立即策略清理的请求顶层字段包括 cache_control、prompt_cache_breakpoint、prompt_cache_key、prompt_cache_retention、prompt_cache_options。还会清理 system、messages/input 内容块及工具声明上的 cache_control/prompt_cache_breakpoint，包含 Anthropic tool_result/search_result 的嵌套内容和 Responses additional_tools 声明。阈值策略则保留这些显式设置。

遍历只进入已知协议结构。工具 JSON Schema 中名为 cache_control 的属性、工具调用参数、工具输出业务数据、图像、思考签名、模型名、stream、tool_choice 和原有历史均予保留，不采用递归删除所有同名键的做法。未知协议保持原样并记录 unsupported-protocol；bust 遇到无法安全前置的提示词结构则在修改前返回 400。

### Gemini 缓存引用

cachedContent / cached_content 引用可以代替整段历史、系统提示词或工具定义。中间件没有网络 API，无法取回其中的内容。

仅在主动开启 disable-explicit/bust 后，入口遇到非空引用才默认返回 409，请客户端先展开缓存内容并提交完整请求。如果调用方确认已自行补齐全部内容，可以显式设置 cachedContent 为 drop；这样才会删除引用，并记录 cached-content-dropped 警告。默认的 passthrough 模式始终保留引用。Vertex Gemini 使用同一保护。

如果另一个中间件在本插件的入口处理之后才注入缓存引用，onProvider 已不能拒绝请求：本插件会保留请求并记录 provider-stage-cached-content-preserved。此时无法保证缓存规避，需检查中间件顺序及其它插件的行为。

### 可选的 OpenAI Responses 显式模式

对于已确认支持 prompt_cache_options.mode = explicit 的模型，请使用单独的 Magpie 供应商配置，再将其实际 id 填入 openaiExplicitProviders。例如，id 为 native-openai 的专用供应商可配置：

```json
{
  "mode": "disable-explicit",
  "log": true,
  "cachedContent": "reject",
  "openaiExplicitProviders": ["native-openai"]
}
```

仅当客户端协议为 Responses 且 ctx.provider.id 精确匹配时，onProvider 会设置 prompt_cache_options 为 {"mode":"explicit"}，同时保证本插件处理过的显式断点已经移除。按 OpenAI 文档，支持该模式的模型在没有显式断点时不使用提示词缓存，也不创建缓存写入。

这项能力不按模型名称猜测，也不对所有 OpenAI 兼容接口自动开启。旧模型或不支持该字段的供应商可能返回 400，所以不要把混有不支持模型的供应商加入列表。该选项仅在 disable-explicit 下生效；在 passthrough 和 bust 下均不由本插件额外启用，文本模式保留扰动优先。

## 措施与使用量日志

onProvider 记录当前实际尝试的供应商 id、移除字段计数、salted、explicitOnly 和警告。onResponse/onEvent 只观察使用量，不改写响应或流式事件。

识别的使用量包括 Anthropic cache_read_input_tokens/cache_creation_input_tokens、Chat/Responses 的 cached_tokens/cache_write_tokens、DeepSeek prompt_cache_hit_tokens、Gemini cachedContentTokenCount，以及 Bedrock cacheReadInputTokens/cacheWriteInputTokens。也识别 Bedrock 流式 metadata.usage 以及事件 delta.usage 包装。流中的累计值取已观察到的最大值，避免把同一统计重复相加；不是对未声明为累计值的任意供应商增量事件求和。

outcome 的含义：

- unknown：没有收到可识别的缓存读取统计，不等于零命中。
- reported-zero：至少一次上游统计明确报告读取缓存 token 为 0，且尚未观察到更大的值。
- hit：观察到缓存读取 token 大于 0，即使已经采取规避措施。

日志不包含提示词、工具参数、缓存键或随机标记。无统计的流、没有开启 usage 的 Chat 流及 Magpie 直接透传的压缩响应可能只有措施日志。若客户端/供应商支持，可由客户端开启流式 usage；本插件不强行加入可能不兼容的 stream_options。Magpie 还会对 console.log 限流，因此这些日志不替代完整的计费审计。

## 网关边界

- onRequest 在路由前执行；onProvider 在每次供应商尝试时再次处理，清理中途新增的缓存标记。
- 两个钩子接收的仍是客户端协议，不是最终供应商线上请求。本插件按 ctx.protocol 改写，不根据厂商名称猜测请求结构。
- 建议把该插件放在可能添加系统提示词/缓存字段的中间件之后。更晚的中间件、网关协议转换或 provider fetch 仍可能重新加入缓存，日志反映的是本插件采取的措施和实际能看到的上游统计。
- 无法控制隐藏的供应商提示词、系统提示词之前的工具前缀、HTTP 缓存头、订阅登录后端或供应商自有的响应缓存。
- 不删除 Responses previous_response_id/conversation，也不把 store=false 当作缓存开关；会话状态、数据保留和提示词缓存是不同功能。
- 不向上游发送假想的 no_cache 字段，不伪造“全部缓存已关闭”的响应头或统计，不进行可能产生费用的 API 请求。
- 按 Magpie 的行为，中间件意外抛错/超时会被跳过。这不是严格强制零缓存的安全边界；观察 usage 才能判断已报告的命中情况。

## 测试

Node.js 22+，无需 npm install：

```powershell
npm --prefix plugins/cache-control run check
npm --prefix plugins/cache-control test
npm --prefix plugins/cache-control run test:coverage
npm --prefix plugins/cache-control run test:page
```

用 Magpie 同类网关引擎验证，需 Go 1.25+：

```powershell
npm --prefix plugins/cache-control run test:moejs
```

moejs 测试独立锁定 v0.1.1，重跑与 Node 相同的协议契约，并在 128 个全新 runtime 中验证随机标记不重复。命令使用 -count=1 强制重跑，因为插件 JS/契约文件位于 Go 测试模块之外，不能依赖 Go 的测试缓存检测它们的变化。它不宣称与本机 Magpie 内嵌的 moejs 提交完全一致，也不是正在运行的网关端到端测试。首次执行 Go 测试需要下载开发依赖；它们不会进入插件发布包。

覆盖原样转发、显式清理、每请求随机值、重试幂等、流式统计、敏感信息不进日志、工具 Schema/调用数据保留、缓存引用保护、无效配置、专有模式的供应商隔离，以及页面渲染状态、保存选项、输入校验、保存/加载错误和主题语言切换。所有测试均在本地运行，不登录账号、不发模型请求、不消耗模型额度。

## 接口依据

- Magpie 插件接口：https://usemagpie.ai/docs/plugins
- 官方社区 system-prompt：https://github.com/magpie-community/plugins/tree/main/packages/system-prompt
- OpenAI 提示词缓存：https://developers.openai.com/api/docs/guides/prompt-caching
- Claude 提示词缓存：https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Gemini 缓存：https://ai.google.dev/gemini-api/docs/caching?generate-content=true
- Vertex Gemini 请求格式：https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference
- Bedrock Converse：https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
- Bedrock 提示词缓存：https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
- Cohere Chat v2：https://docs.cohere.com/reference/chat
- Ollama Chat：https://docs.ollama.com/api/chat
- Ollama Generate：https://docs.ollama.com/api/generate
