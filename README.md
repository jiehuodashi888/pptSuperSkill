# 企业 PPT 多风格 SKILL 框架

一个面向企业内网的、本地优先的 PPT 自动化框架：将可复用的观察、路由、生成和质量审核能力放在通用核心中；每家公司将自己的模板、风格规则、证据、分类与审批记录放在独立实例包中。核心不内置任何企业模板或企业数据。

它适合从零生成可编辑的 PPTX，并为将来的模板填充、既有演示文稿编辑和企业级集中治理预留受控扩展点。

## 你能用它做什么

- 用九个专业观察员对授权的 PPT 样本进行结构化观察：字体、视觉风格、布局、内容、图表、表格、母版/模板、视觉资产和风格分类。
- 将业务类型、视觉风格和页面布局分开管理；只路由到已批准的企业风格。
- 基于页面计划从零生成可编辑的 `.pptx`，并保留生成、路由、观察与审核的审计边界。
- 根据本机实际能力安全降级：缺少渲染、图像分析或并行能力时，明确报告覆盖缺口和未知项，而不是伪造视觉结论。
- 通过本地文件契约或可选的仅回环本地审批界面处理审批；没有界面或没有某种模型能力时，主流程仍可按已声明能力运行。

## 当前边界

当前运行时已实现本地实例校验、默认拒绝的资源注册表、九观察员任务契约、能力声明、路由与审批门控、从零生成可编辑 PPTX、结构/视觉 QA 契约，以及本地审批文件与界面 API。生产部署必须使用 `runProtectedWorkflow(input, deployment)`；旧的低层生成、路由和夹具接口只供测试或底层组合，不能作为生产入口。

`template-fill`（模板填充）、`existing-deck-edit`（编辑既有 PPT）、云端多租户、账号/SSO、真实企业样本的导入适配器和模型/渲染器/图像分析器均不是内置承诺。它们必须由部署环境提供适配器与能力声明；不可用时应保留为明确的缺口或失败，而非静默降级为成功。

## 架构速览

```text
通用核心（可持续演进）
  Schema · 实例加载/隔离 · 九观察员 · 路由/审批 · PPTX 生成 · QA
                              │
                    受控的 company_id 接口
                              │
企业实例包（彼此隔离）
  模板/资产 · 风格 Profile · 分类 · 证据 · 场景映射 · QA 策略 · 审批记录
```

同一次运行只打开一个 `company_id`。实例加载器会校验清单、受控资产引用和路径边界；不要把一个企业的模板、样本、证据或分类复制到通用核心或其他实例中。

## 目录说明

```text
.
├── .cursor/skills/enterprise-ppt-multistyle/  # 给 Agent 使用的通用工作流
├── runtime/                                   # 与企业无关的核心运行时、Schema 与 UI
├── instances/
│   └── example-company/                       # 不含企业真实数据的示例实例包
├── tests/                                     # 核心和示例闭环测试
├── scripts/                                   # 需显式授权的辅助脚本
└── docs/                                      # 设计、架构和实施文档
```

## 快速开始

### 1. 准备环境

需要 Node.js **20 或更高版本**，并建议使用项目锁定的依赖版本：

```powershell
# 在克隆后的仓库根目录运行
npm ci
```

### 2. 验证框架和示例实例

```powershell
# 运行全部测试
npm test

# 进行 TypeScript 类型检查
npm run typecheck

# 校验示例企业实例的清单、声明资产和目录边界
npm run ppt-skill -- validate-instance instances/example-company
```

最后一条命令应输出 `"valid": true` 和 `"resourceCatalog": "validated"`。示例已启用资源目录检查，包括登记身份、依赖和内容哈希；该结果不等同于品牌审核、风格批准或完成视觉 QA。只含旧 `assets` 的实例仍可通过兼容检查并报告 `"resourceCatalog": "legacy"`，但没有资源目录就不能进入受保护生产工作流。

## 为一家企业创建实例

以 `instances/example-company/` 为起点，在仓库之外的独立本地企业根目录创建新实例，并设置最小权限 ACL。至少需要：

1. `instance.yaml`：实例 ID、兼容核心版本及 `resource_catalog` / `resource_catalog_version` 声明；旧 `assets` 仅用于兼容校验。
2. `taxonomy/`：企业批准的业务类型、视觉风格和页面布局分类。
3. `resources/catalog.json`：资源 ID、范围、用途、版本、SHA-256、批准状态和受控相对路径。
4. `styles/<style-id>/manifest.json` 与登记的 Token、布局等资源：自有资源及精确版本导入；旧 `profile.json` 不构成生产授权。
5. `scenarios/` 与 `qa/`：登记的已批准场景映射、审核策略与安全修复白名单。

企业模板、已授权历史样本、图片和证据只应保存在所属实例的受控目录或其受控存储中。先运行 `validate-instance`，再由部署环境提供模型、PPTX 解析/写入、渲染或图像分析适配器。任何能力缺失必须作为 `missing_capabilities`、`unknown_fields` 或 QA 覆盖缺口交付。

## 运行与审核原则

- 观察结果和规则必须保留可定位的源证据；低置信度或 `UNKNOWN` 不能自动成为已批准规则。
- 路由不明确时必须要求确认，不能临时创造风格、模板或批准状态。
- 原生生成器只处理已支持的页面计划，并且不会覆盖既有输出文件。
- 结构 QA 与视觉 QA 是不同能力。没有完整渲染和图像分析覆盖时，不能声称视觉审核已完成。
- 自动修复仅限于已批准的机械性文本内边距和段落间距计划；内容、数字、分类、路由和风格修改必须人工审核。

## 进一步阅读

- [架构说明（中文 / English）](docs/ARCHITECTURE.md)
- [通用 SKILL 工作流](.cursor/skills/enterprise-ppt-multistyle/SKILL.md)
- [首版详细设计](docs/superpowers/specs/2026-11-21-enterprise-ppt-skill-framework-design.md)
- [观察数据契约](runtime/OBSERVATION-CONTRACT.md)
- [实例包与测试/发布指导](.cursor/skills/enterprise-ppt-multistyle/references/instance-package.md) 与 [testing-and-release.md](.cursor/skills/enterprise-ppt-multistyle/references/testing-and-release.md)

## 数据与安全

本项目按本地优先设计。通用核心应只处理当前实例的受控接口，默认关闭跨实例检索。请勿将企业真实模板、原始 PPT、个人信息、商业数据或访问凭据提交到此仓库；公开样本只能作为获授权的测试夹具，不能自动沉淀为任何企业的风格事实。

资源范围为 `core`（独立发行的通用资源）、`company`（企业内显式共享）、`style`（风格私有）、`request`（预留）和 `quarantine`（隔离预留）。当前解析器拒绝所有 `request` 和 `quarantine` 读取，包括观察用途。公司资源及跨风格共享必须同时满足拥有方导出允许名单与消费者的精确导入；`core` 也必须由消费者显式导入。身份、用途、批准状态、版本、哈希或路径边界不匹配时默认拒绝，不回退到裸路径或其他公司的文件。

生产配置独占根目录的选择权：输出为 `outputRoot/companyId/styleId/requestId/`，缓存为 `cacheRoot/companyId/styleId/resourceVersionSetHash/requestId/`。报告的 `resourceProvenance` 只包含公司、风格、请求、资源版本集哈希和资源 ID/范围/版本/SHA-256，不包含资源路径或字节；完整报告仍有本地输出/缓存路径，不应直接发布到共享日志。资源授权成功不能代替 QA，当前生产入口没有注册结构、渲染或图像分析适配器，必须保留覆盖缺口。

这些是应用层访问策略，不能阻止同一 OS 身份下的恶意进程直接读文件。部署方必须隔离企业根目录、输出和缓存的 ACL，按需使用独立 OS 身份，并将通用核心资源设为只读。跨公司通用资源提升由外部核心仓库或制品发布门禁负责，需企业所有者、数据/法务和核心发布者审查，生成独立的新资源 ID/版本/哈希；本仓库不实现该发布器或角色身份认证，本地 `approve` 文件不能将企业模板提升为核心资源。
