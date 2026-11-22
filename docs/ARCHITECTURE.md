# 企业 PPT 多风格 SKILL 架构说明 / Architecture Reference

> 本文描述当前仓库已经实现的通用核心与扩展边界。它不包含任何企业模板、真实样本或企业专属风格事实。

## 中文

### 目标与范围

该框架将企业 PPT 自动化拆分为两部分：持续演进但不携带企业数据的**通用核心**，以及由每家公司在本地维护的**企业实例包**。核心负责版本化契约、实例隔离、观察任务、审批门控、场景路由、可编辑 PPTX 生成和 QA 编排；实例包负责该企业的风格、分类、资产、映射、审批与测试数据。

首版的基线是从零生成可编辑 PPTX。模板填充（`template-fill`）、既有演示文稿编辑（`existing-deck-edit`）、云端多租户和企业 SSO 都是后续适配方向，不是当前运行时的内置能力。

### 分层与隔离

```text
共享核心
  Schema · 实例加载器 · 观察/路由/审批 · 生成 · QA · 可选本地 UI
                         │ company_id + 受控资产引用
企业实例包 A              │                         企业实例包 B
  taxonomy/ · styles/ · scenarios/ · qa/ · assets      （完全独立）
```

每次运行必须选择唯一的 `company_id`。`InstanceStore` 仅解析当前实例清单中声明、且在实例根目录内的资源；路径穿越、跨实例前缀、目录链接逃逸、缺失资产和不匹配的实例 ID 都会被拒绝。缓存、输出、审批决定和证据应按公司命名空间保存。通用核心不得内嵌企业品牌色、模板、原始 PPT、分类或从企业样本提取出的事实。

### 关键契约

核心通过 JSON Schema 和 TypeScript 类型交换可验证的数据，而不是将自由文本视为事实。主要契约包括：

- 实例清单与能力清单：声明实例版本、资产与运行环境实际可用的能力。
- 观察、证据和规则：每个事实和规则都需要可定位的来源、置信度、优先级及适用范围。
- 分类和审批：业务类型、视觉风格、页面布局是独立维度；候选分类必须由带绑定信息的审批决定发布。
- 路由和页面计划：路由只能引用已批准的公司内风格，生成器只接收经过门控的页面计划。
- 审核与修复：发现、覆盖率、缺口和安全修复计划分离；修复计划本身不会修改 PPT。

完整字段和输入限制见 [观察数据契约](../runtime/OBSERVATION-CONTRACT.md) 与 [首版详细设计](superpowers/specs/2026-11-21-enterprise-ppt-skill-framework-design.md)。

### 九个观察员

观察工作被拆为九个固定且有序的任务契约：

1. `style-classifier`：业务类型、视觉风格标签与候选分类。
2. `typography-observer`：字体、字号、字重、间距和排版层级。
3. `visual-style-observer`：色彩、形状、描边、阴影等视觉 Token。
4. `layout-observer`：画布、栅格、边距、对齐、密度和版式模式。
5. `master-template-observer`：母版、占位符、固定元素和页眉页脚。
6. `table-observer`：表头、对齐、数字格式、高亮与表格规则。
7. `chart-observer`：图表类型、标签、图例、坐标轴和配色规则。
8. `visual-asset-observer`：图片、图标、插画、裁切和装饰图形。
9. `content-observer`：标题、叙事结构、信息密度和结论表达。

并行能力存在时，部署适配器可在有界并发下执行这些任务；缺少该能力时，核心按同一契约串行执行，不省略任何观察员。观察的 slide、deck 和 corpus 级别分别用于单页事实、单文档重复模式和同一实例内的跨样本规律。

### 能力感知与安全降级

每次运行由部署方提供明确的能力声明：`pptxRead`、`pptxWrite`、`renderSlides`、`imageAnalysis` 与 `parallelAgents`。核心不会从适配器名称推断能力，也不会假设当前模型或电脑具有某项功能。

| 缺失能力 | 当前行为 |
| --- | --- |
| 并行调度 | 九个观察员串行执行。 |
| PPTX 读取 | 不声称字体、坐标、母版等结构事实已验证。 |
| 渲染或图像分析 | 视觉覆盖率保持不完整，并报告 `missing_capabilities`、未知字段或缺口。 |
| PPTX 写入 | 不能交付原生可编辑 PPTX；写入能力缺失会显式失败。 |

降级是诚实地缩小可验证范围，而不是生成推测性结论。结构检查不等于视觉检查；视觉覆盖完整也不自动代表审核通过。

### 路由、生成与 QA

生成请求先收集业务目的、受众、部门、交付语境和显式标签，再由场景路由器对公司内已批准的风格映射评分。候选不足或存在歧义时，结果必须进入确认流程；系统不会临时发明风格、模板或批准状态。

`NativeCreateAdapter` 基于受批准的 Token、布局坐标与 `PagePlan` 从零生成新的可编辑 PPTX。它当前支持标题/正文等原生内容和可选备注，不实现任意图表、表格重建、资产复刻、模板填充或既有文件编辑。输出目录必须是绝对本地目录，且不得覆盖已有文件。

QA 将结构、视觉、内容和一致性发现汇总为带证据的结果。结构审核需要实际读取演示文稿字节；视觉审核同时要求渲染和图像分析，并要求全页覆盖。自动修复仅产出符合白名单的机械性文本内边距或段落间距计划；内容、数字、数据含义、分类、路由或风格变更始终需要人工审批，并在实际编辑后重新审核。

### 本地审批与扩展

审批决定可通过版本化本地文件写入，也可通过仅绑定 loopback 地址的可选本地 UI 查看和处理。两种入口使用同一份规范化审批记录，UI 不直接发布分类或生成演示文稿。

未来接入模型提供商、PPTX 解析器、渲染器、图像分析器、模板填充器或企业 SSO 时，应以适配器和能力声明接入，保持实例包格式、Schema 和审批状态机稳定。详细操作步骤见 [通用 SKILL](../.cursor/skills/enterprise-ppt-multistyle/SKILL.md)。

## English

### Goal and scope

This framework separates enterprise presentation automation into a **shared core**, which can evolve without carrying company data, and a **company instance package**, which each company maintains locally. The core owns versioned contracts, instance isolation, observation tasks, approval gates, scenario routing, editable PPTX generation, and QA orchestration. An instance owns that company's styles, taxonomies, assets, mappings, decisions, and test data.

The first release baseline is native creation of editable PPTX files. Template filling (`template-fill`), editing an existing deck (`existing-deck-edit`), cloud multi-tenancy, and enterprise SSO are future adapter directions; they are not built-in runtime capabilities today.

### Layers and isolation

```text
Shared core
  Schemas · instance loader · observation/routing/approval · generation · QA · optional local UI
                                      │ company_id + controlled asset references
Company instance A                   │                               Company instance B
  taxonomy/ · styles/ · scenarios/ · qa/ · assets                     (fully isolated)
```

Every run selects exactly one `company_id`. `InstanceStore` resolves only resources declared in that instance's manifest and contained by its instance root. Path traversal, foreign-instance prefixes, directory-link escapes, missing assets, and mismatched instance IDs are rejected. Caches, outputs, approval decisions, and evidence should be namespaced by company. The shared core must not embed company colors, templates, source decks, taxonomies, or facts extracted from company samples.

### Key contracts

The core exchanges verifiable data through JSON Schemas and TypeScript types; free-form model text is not treated as fact. The principal contracts are:

- Instance and capability manifests, declaring instance compatibility, assets, and the capabilities genuinely available in a deployment.
- Observations, evidence, and rules, each with a locatable source, confidence, priority, and scope.
- Taxonomy and approvals, where business type, visual style, and layout are independent dimensions and candidate classifications require bound approval decisions before publication.
- Routing decisions and page plans, where routing references only approved in-instance styles and generation receives only gated plans.
- Audit and repair records, separating findings, coverage, gaps, and safe repair plans; a repair plan does not itself edit a deck.

See the [observation contract](../runtime/OBSERVATION-CONTRACT.md) and the [first-release design](superpowers/specs/2026-11-21-enterprise-ppt-skill-framework-design.md) for fields and input constraints.

### The nine observers

Observation is divided into nine fixed, ordered contracts: `style-classifier`, `typography-observer`, `visual-style-observer`, `layout-observer`, `master-template-observer`, `table-observer`, `chart-observer`, `visual-asset-observer`, and `content-observer`.

They respectively cover classification; typography; visual tokens; layout; masters/templates; tables; charts; visual assets; and content/ narrative structure. With a declared parallel capability, a deployment adapter may execute tasks with bounded concurrency. Without it, the core runs the same nine observers serially and skips none. Slide-, deck-, and corpus-level observation describe per-slide facts, repeated patterns within a deck, and cross-sample patterns within one instance.

### Capability-aware degradation

Each deployment explicitly declares `pptxRead`, `pptxWrite`, `renderSlides`, `imageAnalysis`, and `parallelAgents`. The core neither infers a capability from an adapter name nor assumes a model or workstation has one.

When parallel execution is absent, observers run serially. Without PPTX reading, structural facts such as fonts, coordinates, and master layouts cannot be claimed as verified. Without rendering or image analysis, visual coverage remains incomplete and missing capabilities, unknown fields, or gaps are reported. Without PPTX writing, native editable output fails explicitly. Degradation narrows what can be verified honestly; it never substitutes guesses. Structural inspection is not visual inspection, and complete visual coverage is not automatically a passing audit.

### Routing, generation, and QA

A generation request collects business purpose, audience, department, delivery context, and explicit tags. The scenario router scores only approved company style mappings. Insufficient evidence or ambiguity must enter confirmation; the system does not invent a style, template, or approval state.

`NativeCreateAdapter` creates a fresh editable PPTX from approved tokens, layout coordinates, and a `PagePlan`. It currently handles native title/body content and optional notes. Arbitrary chart/table reconstruction, asset recreation, template filling, and editing existing decks require separate adapters and are not implemented by this adapter. Outputs use an absolute local directory and never overwrite existing files.

QA aggregates structural, visual, content, and consistency findings with evidence. Structural audit needs actual deck bytes. Visual audit requires both rendered slides and image analysis with full-slide coverage. Automatic repair only plans whitelisted mechanical text-inset or paragraph-spacing work; content, numbers, data meaning, classification, routing, and style changes always require human approval and a new audit after an actual edit.

### Local approval and extension

Approval decisions can be written as versioned local files or reviewed through an optional loopback-only local UI. Both paths use the same canonical decision records; the UI does not directly publish taxonomies or generate a deck.

Future model providers, PPTX readers, renderers, image analyzers, template fillers, or enterprise SSO integrations should enter through adapters and capability declarations while preserving the instance package format, schemas, and approval state machine. Operational instructions are in the [shared SKILL](../.cursor/skills/enterprise-ppt-multistyle/SKILL.md).
