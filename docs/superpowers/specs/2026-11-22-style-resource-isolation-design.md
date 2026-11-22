# 企业 PPT 风格隔离与资源共享边界设计

## 1. 决策与意图

采用“**受控资源注册表 + 默认拒绝访问**”方案，替代仅依赖目录约定或 Agent 提示词的资源管理方式。

现有运行时已实现公司实例根目录的词法与规范路径包含性校验，但资源仍以扁平字符串资产和调用方提供的 `StyleLibrary` 表示。它不能表达模板、Token、证据等资源属于哪个风格、可被谁使用、是否可共享、能用于什么目的，以及是否被篡改。因此，真实企业数据接入前必须把资源归属和访问决策放到运行时，而不是只写进 SKILL 提示词。

本设计保留“共享核心 + 本地企业实例”模型：共享的是通用代码、Schema、观察工作流和经独立审查发布的通用资源；企业原始样本、模板、证据和风格资产默认不跨公司共享。

## 2. 目标、非目标与约束

### 目标

1. 将每个资源绑定到确定的 `companyId`、资源范围、资源类型、版本、内容哈希和允许用途。
2. 将风格资源设为默认私有；只有显式批准的公司级资源或显式导入关系可以跨风格读取。
3. 让路由、生成、QA、观察和审批都消费受控资源句柄，而不是未经验证的路径或字符串引用。
4. 防止跨公司、跨风格、候选/隔离区资源和未批准资源进入正式生成或 QA。
5. 为“将脱敏通用资产提升为共享资源”提供单独审批、审计和可追溯路径。
6. 使缓存、输出、日志和审计记录能按公司、风格和资源版本隔离。

### 非目标

- 首版不建设网络服务、账号体系、SSO、企业间在线资源市场或跨电脑同步。
- 首版不承诺识别、脱敏或自动判定任意 PPT/图片是否可共享；该决定必须人工批准。
- 不允许企业原始样本、原始模板或证据通过“共享”机制直接流向其他企业。
- 不以此替代操作系统权限：本机恶意进程、同一 OS 身份下的越权读取仍需 ACL、独立根目录或独立 OS 身份防护。

### 兼容约束

- 继续使用 Node.js、TypeScript、JSON Schema 和本地目录；不引入数据库或网络依赖。
- 继续支持缺少渲染、图像分析、并行或 PPTX 写入能力时的诚实降级。
- 新资源访问接口必须在文件读取前失败关闭；不得为了兼容旧调用方而回退到任意路径读取。
- 旧的 `assets: string[]` 只能在迁移模式下读取，不能让新生产工作流绕过资源目录。

## 3. 范围模型与共享规则

每个资源只属于以下一种范围：

| 范围 | 所有者 | 可见性默认值 | 可用于正式生成 | 共享规则 |
| --- | --- | --- | --- | --- |
| `core` | 框架发布者 | 只读 | 是，仅限通用资源 | 不得包含企业数据；版本固定、哈希校验 |
| `company` | 单一企业实例 | 私有于该企业 | 是，经批准后 | 仅可被同一 `companyId` 内显式授权的风格读取 |
| `style` | 单一企业实例中的单一风格 | 仅该风格 | 是，经批准后 | 默认拒绝；必须由拥有者声明导出并由消费者声明导入 |
| `request` | 单次任务 | 仅该任务 | 仅任务运行期 | 不可被其他任务、风格或企业引用 |
| `quarantine` | 单一企业实例 | 隔离 | 否 | 仅供观察、人工审查和候选分析；不得路由或生成 |

`company` 范围不是“公司内全部可见”的隐式全局目录。它代表经过审批的共享品牌基线、字体许可记录、公共图标、公共版式原语等；每个风格仍必须在自己的依赖清单中显式导入它。`style` 范围中的模板、Token、布局、规则、资产和证据索引默认私有。

跨公司共享只允许通过“提升（promotion）”流程：源公司创建不包含原始企业文件的候选发布包；资源所有者、数据/法务审查者与核心发布者批准后，创建全新的 `core` 资源 ID、版本和哈希。该流程不保留跨公司文件路径，也不允许以软链接、复制源文件或别名方式共享。

### 3.1 核心资源包的信任根

`core` 资源不从任何企业实例加载。它位于框架发行物内固定的 `runtime/core-resources/` 根目录，由 `core-catalog.json` 描述，并与运行时版本一起发布。生产 `ResourceRegistry` 只接受由 `RuntimeDeploymentConfig.coreResourcesRoot` 指向、且在启动时通过受控核心目录规范路径和目录哈希校验的核心包；企业 `instance.yaml` 不能重定向该根目录。

首版把核心包的发布信任交给企业内网制品库或 Git 发布流程：核心维护者审核并发布版本化发行物，部署方将核心目录设为只读。运行时验证内容与目录清单，不在本地伪造签名或身份认证。若未来需要运行时验证发布者身份，新增签名验证适配器和部署公钥配置，而不改变 `ResourceRef` 或实例资源目录。

`request` 范围为未来受控临时附件预留，但**阶段 1 和阶段 2 的解析器一律拒绝它**。当前请求内容继续作为非资源化文本/数据进入页面计划；文件型附件、图片或临时模板在拥有确定的任务根、TTL、删除策略和恶意文件处理方案前，不能作为可解析资源。

## 4. 资源身份与目录模型

### 4.1 稳定身份

所有生产资源使用结构化引用，不再使用裸路径：

```ts
type ResourceScope = "core" | "company" | "style" | "request" | "quarantine";
type ResourceKind =
  | "template"
  | "token-set"
  | "layout"
  | "asset"
  | "rule-set"
  | "evidence-index"
  | "font-license"
  | "qa-policy";
type ResourcePurpose = "observe" | "route" | "generate" | "qa" | "review";

interface ResourceRef {
  readonly resourceId: string;       // 例如 template-quarterly-v2
  readonly scope: ResourceScope;
  readonly companyId?: string;       // core 以外必须存在
  readonly styleId?: string;         // style 范围必须存在
  readonly version: string;          // semver
  readonly sha256: string;           // 已批准内容的摘要
}
```

`ResourceRef` 不是路径。路径仅存在于当前实例或核心资源包的受控目录记录中，绝不由模型、HTTP 输入或路由字符串直接提供。

### 4.2 企业实例目录

```text
instances/<company-id>/
├── instance.yaml
├── resources/
│   ├── catalog.json                 # 所有可读取资源的权威目录
│   ├── company/                     # 明确可共享的品牌/公共资源
│   ├── styles/<style-id>/           # 风格私有模板、Token、布局、规则
│   └── quarantine/                  # 候选样本、候选规则、待审资产
├── styles/
│   └── <style-id>/manifest.json     # 风格定义、显式 imports 和导出声明
├── taxonomy/
├── scenarios/
├── approvals/
├── review/
└── tests/
```

示例目录保留在代码仓库中且只含通用虚构数据。生产企业实例应放在独立本地根目录，并由部署文档要求 ACL 隔离；框架仓库不承载真实模板、样本或证据。

### 4.3 `resources/catalog.json`

目录是实例内资源的唯一权威索引。每个条目必须包含：

```json
{
  "catalogVersion": "1.0.0",
  "resources": [
    {
      "resourceId": "brand-baseline-v1",
      "kind": "token-set",
      "scope": "company",
      "companyId": "acme",
      "version": "1.0.0",
      "sha256": "<64-lowercase-hex>",
      "path": "resources/company/brand-baseline-v1.json",
      "status": "approved",
      "allowedPurposes": ["route", "generate", "qa"],
      "exportPolicy": {
        "mode": "allow-listed",
        "consumerStyleIds": ["annual-report", "technical-proposal"]
      }
    }
  ]
}
```

`path` 必须是受 `InstanceStore` 规范路径校验的相对路径，且每次打开资源时必须重新计算 SHA-256 并匹配目录声明。资源内容改变但版本或哈希不变，必须失败；目录与内容不可静默漂移。

`status` 为 `candidate`、`approved`、`deprecated`、`rejected` 之一。只有 `approved` 可用于 `route`、`generate` 或正式 `qa`。`quarantine` 条目即使标记候选也只能用于 `observe`、`review`。

### 4.4 `styles/<style-id>/manifest.json`

风格清单定义其自有资源和精确导入，不通过目录扫描推断：

```json
{
  "styleId": "annual-report",
  "companyId": "acme",
  "status": "approved",
  "ownedResources": [
    { "resourceId": "annual-template-v2", "scope": "style", "companyId": "acme", "styleId": "annual-report", "version": "2.0.0", "sha256": "<hash>" }
  ],
  "imports": [
    { "resourceId": "brand-baseline-v1", "scope": "company", "companyId": "acme", "version": "1.0.0", "sha256": "<hash>" }
  ],
  "tokenOverridePolicy": {
    "allowedTokenKeys": ["accentColor", "chartPalette"],
    "forbiddenTokenKeys": ["logo", "legalFooter"]
  }
}
```

公司范围资源的目录条目和消费者风格的 `imports` 必须双向匹配；风格 A 引用风格 B 的资源时，资源目录还必须明确允许 A 成为消费者。任一边缺失即拒绝。Token 覆盖为显式字段级策略，禁止依靠对象合并顺序隐式继承。

### 4.5 已批准路由的权威来源

风格清单除资源关系外，还必须包含现有评分器需要的 `businessTypes`、`audiences`、`departments`、`deliveryContexts` 和 `tags`。场景映射继续放在 `scenarios/approved-mappings.json`，但它是目录登记的 `rule-set` 资源，必须带 `companyId`、版本、哈希和 `approved` 状态。

`loadApprovedStyleLibrary(registry)` 只读取：当前企业的已批准风格清单、已批准的场景映射资源，以及每个风格已验证的 `template`/`token-set`/`layout` 资源引用。映射中的 `styleId` 必须精确指向该实例内同一公司、已批准的风格清单。这样保留现有路由评分字段，同时消除调用方构造任意 `StyleLibrary` 的生产入口。

## 5. 运行时访问控制

### 5.1 新接口

新增 `ResourceRegistry` 与 `ResourceResolver`。`openInstance` 继续负责公司根目录验证；`openResourceRegistry(store)` 加载、Schema 校验并冻结当前实例的资源目录和风格清单。

```ts
interface ResourceAccessContext {
  readonly companyId: string;
  readonly styleId?: string;
  readonly requestId?: string;
  readonly purpose: ResourcePurpose;
}

interface ResolvedResource<T = Uint8Array> {
  readonly ref: ResourceRef;
  readonly path: string;
  readonly bytes: T;
  readonly access: ResourceAccessContext;
}

resolveResource<T>(
  ref: ResourceRef,
  context: ResourceAccessContext,
): Promise<ResolvedResource<T>>;
```

返回对象在运行时不可变，并加入模块私有 `WeakSet` 作为真实性句柄。下游生成和 QA API 接受这些句柄或由它们派生的不可伪造已批准资源包，而不接受裸 `templateRefs` 或本地路径。

### 5.2 强制决策顺序

每一次资源访问按以下顺序失败关闭：

1. 校验 `ResourceRef` 的格式、版本、哈希、公司和风格字段组合。
2. 校验 `context.companyId` 与资源公司相同；除 `core` 外不允许缺省。
3. 在目录中查找完全相同的身份；拒绝只匹配 `resourceId` 的模糊引用。
4. 校验资源状态、范围与 `purpose`；`quarantine` 禁止 `route`、`generate`、正式 `qa`。
5. 校验访问关系：自有风格资源、双向批准的导入、或显式授权的公司资源。
6. 用 `InstanceStore.resolve` 校验路径和规范包含性，再读取文件并校验 SHA-256。
7. 写入无敏感正文的审计事件，返回真实句柄。

路由、生成和 QA 不得补做“方便的路径解析”。所有读取均经同一解析器，以避免不同入口对共享策略解释不一致。

### 5.3 路由与生成改造

`StyleLibrary` 将不再由调用方构造为任意字符串对象。新增 `loadApprovedStyleLibrary(registry)`，只从已批准风格清单和已批准场景映射创建库；每一个模板、Token、规则和布局引用都携带已验证 `ResourceRef`。

`routeScenario` 仍负责评分和要求确认，但输出 `ResolvedStyleSelection`，其中只含当前公司可用的风格 ID 和受控资源声明。`requireApprovedRoute` 继续使用真实性句柄，随后 `prepareGenerationResources` 按选择的风格和 `purpose: "generate"` 解析实际模板/Token。生成 API 不接受任意文件名或模板路径。

在页面计划阶段，Token 层叠顺序固定为：`core` 通用原语 → 明确导入的 `company` 基线 → 当前 `style` 自有 Token → 经允许的请求覆盖。缺少导入、覆盖未经允许或字段冲突时失败，不能静默使用“最后写入者”。

### 5.5 生产入口与测试边界

新增唯一的生产编排入口 `runProtectedWorkflow(input, deployment)`。它接收受验证的 `companyId`、业务请求、能力声明和部署配置，内部依次打开实例、加载资源目录、加载已批准风格库、路由、解析生成资源、生成并执行 QA。生产 API 不接收 `StyleLibrary`、裸 `templateRefs`、任意模板路径、任意输出目录或任意 QA 文件路径。

现有 `routeScenario`、`generatePresentation`、`auditDeck` 和 `runFixtureWorkflow` 保留为低层或 `test-only` 契约，用于单元测试与合成夹具；它们的导出文档必须明确“不可作为部署生产入口”。`runFixtureWorkflow` 继续允许调用方构造库和页面计划，但其返回值固定为 `classification: "test-only"`，且不得被生产入口消费。

部署配置是生产根目录的唯一来源：

```ts
interface RuntimeDeploymentConfig {
  readonly instancesRoot: string;
  readonly coreResourcesRoot: string;
  readonly outputRoot: string;
  readonly cacheRoot: string;
}
```

`runProtectedWorkflow` 从 `outputRoot/<companyId>/<styleId>/<requestId>/` 派生输出路径，从 `cacheRoot/<companyId>/<styleId>/<resourceVersionSetHash>/<requestId>/` 派生缓存路径，并对每一个派生目录进行规范路径包含性和链接逃逸检查。部署调用方不能指定最终子路径。

### 5.4 观察、证据与 QA

观察可读取 `quarantine` 样本，但输出只能写入该实例的候选记录。证据记录保留源资源 `ResourceRef`、页码/元素定位符和哈希；不得在通用日志中写入原始文本、页面图像或企业路径。

QA 只接受与当前选择风格相同的已解析规则、Token 和模板句柄。视觉渲染缓存、分析缓存与生成产物的命名空间必须含：

```text
companyId / styleId / resource-version-set-hash / requestId
```

没有 `imageAnalysis` 或 `renderSlides` 时，继续报告不完整覆盖率；资源访问成功不能改变 QA 覆盖结论。

## 6. 共享发布与审批

### 6.1 公司内共享

资源所有者发起“公司共享”审批请求，内容包括资源引用、允许消费者风格、允许用途、版本、哈希、许可说明与回滚目标。审批通过后，目录条目的 `exportPolicy` 才可允许引用；消费者风格还必须提交匹配的 `imports` 变更。任意一侧更新版本、哈希、用途或消费者列表都会使旧授权失效，需重新审批。

### 6.2 跨公司提升

跨公司提升使用与公司内共享不同的请求类型，至少包含：

- 原资源与来源公司仅用于本地审计，不进入发布包；
- 脱敏声明、许可/版权声明、人工复核结论与回滚说明；
- 新的、独立的 `core` 资源内容、ID、版本和哈希；
- 企业所有者、数据/法务审查者、核心发布者三方的外部审查记录。

本地运行时没有账号、SSO 或签名身份时，不能诚实地验证“某个角色”是否真实签署。因此它不执行跨公司提升，也不把普通本地 `approve` 文件等同于三方授权。提升由核心仓库/制品发布门禁在运行时之外执行：发布器只接收新生成的发布包，拒绝企业实例内路径、符号链接、原始文件字节或仅改名的资源；核心维护流程核验审查记录后才发布新的只读 `core` 资源包。任何审批拒绝、过期、哈希不匹配或审查缺失都不得创建 `core` 条目。

## 7. 数据存储与部署边界

建议的本地部署布局：

```text
<runtime-root>/                  # 通用代码，可只读
<company-roots>/
  acme/                          # ACL: acme 运行身份
  beta/                          # ACL: beta 运行身份
<output-root>/
  acme/<style>/<request>/
  beta/<style>/<request>/
```

每个企业使用独立实例根目录及最小权限 ACL。若同一进程拥有多个企业根目录的读取权限，运行时解析器可防止常规误用，但不能替代操作系统安全边界。部署方必须避免把企业根目录挂载为共享可写目录，也不得让缓存目录跨公司复用。

审计事件最少记录时间、请求 ID、公司、风格、资源 ID/版本/哈希、用途、允许/拒绝结果与规则编号；不得记录资源正文、原始幻灯片图像、模板路径或凭据。

## 8. 迁移与兼容策略

### 阶段 1：登记与只读验证

- 新增目录与风格清单 Schema、加载器、哈希验证和负向测试。
- 旧 `assets` 继续只用于 `validate-instance` 的兼容检查；新 `resource_catalog` 采用显式 opt-in。
- 不改变既有测试夹具流程的 `test-only` 定位。

### 阶段 2：生产路径门控

- 生产路由、生成和 QA 改为只能接收 `ResourceRegistry` 生成的句柄。
- `StyleLibrary` 的裸字符串接口标记弃用；测试夹具保留专用构造器，但不能被生产入口调用。
- 未启用资源目录的实例只能运行迁移检查与候选观察，不能进行正式模板/资源生成。

### 阶段 3：共享与提升治理

- 增加公司内共享审批请求、导入关系变更和失效检查。
- 增加跨公司提升包校验器与人工审批记录；默认不提供自动发布。
- 资源目录稳定后，移除生产运行时对旧 `assets` 的读取依赖。

版本兼容规则：核心在 `instance.yaml` 中声明最低 `resourceCatalogVersion`；无法理解的策略版本、未知资源范围或未知用途必须拒绝加载，而不是忽略字段继续运行。

## 9. 实施文件与接口变更

| 区域 | 新增/修改 | 责任 |
| --- | --- | --- |
| `runtime/schemas/` | `resource-catalog.schema.json`、`style-manifest.schema.json`、共享/提升审批 Schema；扩展实例 Schema | 声明静态边界 |
| `runtime/src/resources/` | `types.ts`、`registry.ts`、`resolver.ts`、`hash.ts`、`policy.ts` | 目录加载、访问判定、哈希与句柄真实性 |
| `runtime/src/instances/` | `manifest.ts`、`store.ts` | 加载资源目录，不再暴露生产任意路径读取 |
| `runtime/src/routing/` | 受控风格库加载、`ResolvedStyleSelection` | 路由只输出已注册资源 |
| `runtime/src/generation/` | 受控生成资源输入与固定 Token 叠层 | 禁止裸模板/路径输入 |
| `runtime/src/qa/` | 资源版本集、缓存命名空间与证据绑定 | 防止 QA 串用 |
| `runtime/src/approvals/` | 公司共享与提升请求状态机 | 强制人工发布边界 |
| `runtime/src/workflow/` | `runProtectedWorkflow` 和部署根目录派生 | 唯一生产入口；低层现有 API 明确 test-only |
| `runtime/core-resources/` | 固定根目录的核心资源包和目录清单 | 仅随核心发行物发布，不从企业实例读取 |
| `.cursor/skills/...` | 资源选择、共享、升级和审计工作流；重资源细节放到 references | 指导 Agent 使用而非绕过运行时 |
| `tests/` | Schema、解析器、路由、生成、审批、缓存负向测试 | 证明默认拒绝 |

## 10. 测试策略与验收标准

必须新增下列失败优先测试：

1. 风格 A 不能读取风格 B 私有模板、Token、证据或 QA 规则。
2. 公司级资源只有在“目录导出 + 消费者导入”双向批准后才能被使用。
3. 伪造 `companyId`、`styleId`、版本、哈希、资源状态、用途或路径均被拒绝。
4. 资源字节与登记哈希不一致、版本漂移、目录链接逃逸、缺失父目录均被拒绝。
5. `quarantine` 与 `candidate` 资源不能进入正式路由、生成或 QA。
6. 旧的裸 `StyleLibrary` 或 `templateRefs` 无法通过生产生成入口。
7. 缓存、输出和审计记录的键必须包含公司、风格、资源版本集和请求 ID。
8. 公司内共享被撤销、版本变更或导入记录失配后，原风格无法继续使用资源。
9. 跨公司提升拒绝企业实例路径、原始字节、缺少任一审批或不匹配哈希的发布包。
10. 无渲染/图像分析能力时，资源解析通过也仍然产生不完整视觉 QA 覆盖报告。

验收条件是：所有生产资源读取均由 `ResourceResolver` 记录并执行默认拒绝；路由和生成 API 不再可接受任意本地路径或裸资源字符串；企业原始资源无法在没有人工发布流程的情况下跨公司引用；升级后仍保留当前公司根目录规范路径和审批绑定防护。

## 11. 待部署方确认的事项

- 每个企业的运行进程是否可使用独立 OS 身份，还是仅可配置目录 ACL。
- 哪些现有品牌资源允许成为公司内基线，及其审批人角色。
- 跨公司“通用资源”发布的法务/数据审查角色与留存周期。
- 生产实例的资源版本保留和回滚策略。

这些事项不阻塞阶段 1 的本地 Schema、资源目录与默认拒绝实现；未确认时，应采用最严格的私有资源和拒绝共享策略。
