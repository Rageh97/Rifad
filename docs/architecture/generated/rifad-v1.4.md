# RIFAD v1.4 searchable rendition

> NONAUTHORITATIVE — generated; do not edit. The DOCX source controls meaning.

Source: [RIFAD_v1.4_FINAL.docx](../../../RIFAD_v1.4_FINAL.docx)

SHA-256: bbb07117fcc278963f942b35bf20cac4a954eabd130c943756dfce7bb832815e

Body text and rectangular table cell relationships are preserved. Visual layout, headers and footers are not reproduced.

RIFAD SYS1

الخطة المعمارية والتنفيذية الشاملة

Master Architecture &amp; Implementation Plan - v1.4 (Authority &amp; consistency revision)

القطاع الأول: المقاهي والمطاعم

تاريخ التثبيت: 21 سبتمبر 2026

| هدف الوثيقة<br>هذه الوثيقة تجمع بصورة واحدة ومنظمة القرارات، المبادئ، الحدود المعمارية، نماذج البيانات والملكية، مسارات التشغيل، الأمن، العمل دون اتصال، التكاملات، التحليلات، الذكاء الاصطناعي، الاعتمادية، التقنيات، معايير الهندسة، وخارطة التنفيذ التي تم بناؤها حول RIFAD SYS1. وهي مرجع تأسيسي لفريق التطوير وأدوات البرمجة المساعدة، وليست بديلاً عن مواصفات الأعمال التفصيلية لكل ميزة. |
| --- |

المبدأ: Design for 23, build for 1

نصمم منصة تستطيع استيعاب 23 قطاعاً مستقبلاً، لكن نبني الآن قطاع المطاعم فقط دون تعميمات وهمية أو تعقيد مبكر.

<br>

Revision v1.4: نشر قرار Edge-first على جميع مسارات التنفيذ والملكية والأحداث؛ تحويل Open Check/Round في M0 إلى Edge/SQLite authority من البداية، تعريف Branch Operational Projection وEdge Runtime Profile، تثبيت Sale Finalization المحلي، فصل drawer difference عن Reconciliation، توضيح Recipe-to-Inventory orchestration، COGS/dimensions في Finance Minimum، إعادة بناء Event Catalog حسب Edge/Cloud plane، وتصحيح milestones/timeline/RLS-by-default.

## جدول المحتويات

| القسم | رقم |
| --- | --- |
| الملخص التنفيذي والقرارات الكبرى | 1 |
| قراءة SYS1 كرؤية منتج ومنصة | 2 |
| المبادئ المعمارية الحاكمة | 3 |
| منهج DDD ونموذج التحليل | 4 |
| Capability Map | 5 |
| Bounded Context Map | 6 |
| ملكية البيانات والعقود بين الوحدات | 7 |
| End-to-End Order Flow | 8 |
| State Machines / Business Invariants | 9 |
| Open Check / Ordering Aggregate Model | 10 |
| Inventory Architecture | 11 |
| Payments / Billing / Accounting / Reconciliation | 12 |
| Offline &amp; Branch Edge Architecture | 13 |
| Multi-Tenancy / Organization-Branch Model | 14 |
| Identity / Authorization / Approvals / Audit | 15 |
| Integration Architecture | 16 |
| Reporting &amp; Analytics Architecture | 17 |
| AI / Intelligence / Automation Architecture | 18 |
| Reliability &amp; Observability | 19 |
| RIFAD Architecture V1 النهائية | 20 |
| Technology Stack V1 | 21 |
| Bunny Storage / CDN / Cost | 22 |
| Cloud / Deployment Strategy / ECS / IaC | 23 |
| Repository Blueprint | 24 |
| Engineering Standards &amp; Conventions | 25 |
| Security Baseline | 26 |
| Testing Strategy | 27 |
| ADRs - Architecture Decision Records | 28 |
| M-1 - Requirements &amp; Compliance Closure | 29 |
| خارطة التنفيذ M-1-M5 | 30 |
| M0 - Task-by-Task Implementation Plan | 31 |
| M1-M5 Epics and Deliverables | 32 |
| Event Catalog | 33 |
| Data Ownership Matrix | 34 |
| المخاطر والأسئلة المفتوحة | 35 |
| Definition of Done / Stage Gates | 36 |
| Technology Snapshot / Official Compliance Sources | 37 |

<a id="section-1"></a>

## 1. الملخص التنفيذي والقرارات الكبرى

RIFAD SYS1 ليس نظام POS فقط. هو أول Vertical في منصة RIFAD الأكبر، ويجمع التشغيل، المخزون، المشتريات، العمالة، المدفوعات، الفوترة، المحاسبة، التقارير، الذكاء، الأتمتة والتكاملات داخل نموذج بيانات وتشغيل مترابط.

القرار المعماري الأساسي لـV1 هو Modular Monolith سحابي بحدود Domain صارمة، مع Worker Plane للمهام الخلفية، وBranch Edge Runtime للعمل دون اتصال، وIntegration Gateway، وAnalytics/Intelligence Plane downstream.

- لا Microservices في V1. الحدود منطقية وقابلة للاستخراج لاحقاً عندما تظهر حاجة تشغيلية حقيقية.

- لا Kafka في V1. نستخدم Transactional Outbox + BullMQ، وننتقل إلى Streaming Platform إذا ظهرت متطلبات throughput/replay/عدد مستهلكين تبرر ذلك.

- Cloud PostgreSQL هو system-of-record للـCloud-owned/master domains والنسخة المركزية المتزامنة؛ Branch Edge/SQLite هو operational authority للـbranch-owned critical-path aggregates. Reporting/Analytics تبني read models downstream ولا تعدل الحقيقة التشغيلية.

- الـLLM ليست مصدر حقيقة مالية أو مخزنية. الحسابات deterministic، التوقعات ML/statistical، والـLLM تشرح وتستدعي أدوات مصرحاً بها.

- كل Bounded Context يملك بياناته. ممنوع Cross-Module table mutation حتى لو كانت قاعدة البيانات الفيزيائية واحدة.

- Offline requirement يؤثر من البداية في IDs، timestamps، idempotency، outbox/inbox، conflict policies، device/edge design.

- Multi-tenancy وtenant isolation وorganization/branch model من القرارات عالية تكلفة التغيير، لذلك تثبت مبكراً.

- Bunny Storage + Bunny CDN للصور والملفات في V1 خلف ObjectStoragePort، مع Backups حرجة لدى مزود مستقل.

- البداية يمكن أن تكون اقتصادية على VPS/Containers، مع إمكانية الانتقال لاحقاً إلى AWS ECS/RDS/Managed Redis دون تغيير Domain Architecture.

| هوية RIFAD V1<br>Multi-tenant, domain-oriented Modular Monolith، بملكية بيانات صارمة، Sync/Async حسب Business Guarantees، Transactional Outbox، Workers، Edge Offline Runtime، Analytics downstream، وIntelligence Layer مبنية فوق Trusted Data. |
| --- |

- قرار v1.4 - KSA-first: SYS1 تستخدم ZATCA والقنوات والسياق السعودي؛ لذلك أول baseline معماري يفترض المملكة العربية السعودية كسوق الإطلاق، مع إبقاء الـCore قابلاً للتوسع لأسواق أخرى لاحقاً عبر tax/fiscalization adapters وسياسات locale.

- قرار v1.4 - M-1 هي Gate لقرارات الـDomain/Compliance، لكن M0 Foundation Track (الـmonorepo/DB/CI/observability/outbox primitives) يمكن أن يبدأ بالتوازي. لا تبدأ Domain implementation أو pilot commitments قبل إغلاق القرارات الحرجة ذات الصلة.

- قاعدة جديدة: AI يمكن تأجيله، لكن Data Capture التي سيحتاجها AI لا تؤجل؛ timestamps/reason codes/cost snapshots/recipe version/customer consent وغيرها تبدأ من الـOperational Core.

<a id="section-2"></a>

## 2. قراءة SYS1 كرؤية منتج ومنصة

وثيقة SYS1 تعرّف النظام كنظام محاسبي وتشغيلي متكامل للمقاهي والمطاعم؛ كل حركة تشغيلية مثل الطلب والبيع والمرتجع والخصم والهدر والشراء والتحويل والحضور وإغلاق الوردية يجب أن ينتج عنها أثر مالي وتشغيلي قابل للقياس دون إدخال مكرر.

| المجال | متطلبات SYS1 الأساسية |
| --- | --- |
| لوحة المالك/المدير | مبيعات لحظية، صافي الربح، الفواتير، المدفوعات، الطلبات، المخزون، الهدر، العمالة، الفروع والقنوات، مقارنات وتنبيهات وتوقعات. |
| المحاسبة | دليل حسابات، قيود تلقائية، أستاذ، مراكز تكلفة، ميزان مراجعة، P&amp;L، ميزانية، Cash Flow، إقفالات. |
| الفوترة والمدفوعات | فواتير، مرتجعات جزئية/كاملة، split bills، طرق دفع، تسويات، رسوم بوابات، ZATCA. |
| POS | Cloud POS متعدد الأجهزة، جلسات كاشير، درج نقدي، صلاحيات، OTP، online/offline، طباعة وأجهزة طرفية. |
| الطلبات | Dine-in، pickup، car pickup، drive-through، delivery، QR، cashier، platforms، catering. |
| المطبخ | KDS، stations، routing، preparation states، prep-time، rework/waste. |
| المنيو | QR/self-ordering، categories/modifiers/sizes/prices/availability، multi-language، kiosk، upsell. |
| المخزون والوصفات | Multi-branch stock، transfers، counts، reorder، recipes، ingredient deduction، food cost، production، waste. |
| المشتريات | Request -&gt; approval -&gt; quotes -&gt; PO -&gt; receipt -&gt; supplier invoice -&gt; return، supplier performance. |
| الموظفون | Profile، roles، attendance/geofence، schedules، leave/overtime، productivity، payroll inputs. |
| التقارير | Sales/product/branch/employee/hour/payment/channel، COGS، waste، inventory، workforce، exports/scheduling. |
| AI/Automation | Assistant، forecasting، anomalies، recommendations، no-code Event+Condition+Action. |
| Integrations | Delivery platforms، payments، WhatsApp/SMS، webhooks، suppliers، logistics، sensors، cameras، open API. |

### 2.1 ما الذي يعنيه ذلك معمارياً؟

- المحاسبة Core وليست add-on: التشغيل يجب أن ينتج حقائق يمكن تحويلها إلى أثر محاسبي.

- Inventory + Recipes + Costing من الأعمدة التأسيسية، لأن الربحية والذكاء تعتمد على دقة الحركات.

- Offline ليس Feature UI؛ هو قرار معماري يؤثر في الهوية والبيانات والمزامنة والأمن.

- Multi-branch Foundation من البداية.

- Integration Platform First-class capability لأن المنتج يعتمد على عالم خارجي واسع.

- AI لا يمكن أن يكون موثوقاً بدون clean operational truth وmetric definitions.

<a id="section-3"></a>

## 3. المبادئ المعمارية الحاكمة

| المبدأ | التطبيق في RIFAD |
| --- | --- |
| Design for 23, build for 1 | نصمم الحدود المشتركة للمنصة، لكن لا نبني Abstractions غير مثبتة من قطاعات لم ننفذها بعد. |
| Architecture = Trade-offs | لا توجد تقنية أفضل مطلقاً؛ كل قرار يكسب Quality Attribute ويكلف تعقيداً أو مالاً أو consistency أو operations. |
| Business before Technology | نفهم states/rules/data/failures ثم نختار التقنية. |
| High-cost decisions early | Tenancy، identity، data ownership، domain boundaries، authorization تثبت مبكراً. |
| Easy-to-change decisions later | Redis TTL، provider adapters، بعض deployment knobs لا تحتاج قفلاً مبكراً. |
| Own your data | كل Module يملك بياناته وعقوده. |
| Sync is a guarantee | القرار Sync/Async مبني على ما يجب ضمانه للمستخدم الآن، لا على حب event-driven. |
| Failures are normal | timeout/retry/idempotency/backpressure/DLQ/reconciliation ليست تحسينات لاحقة. |
| AI after truth | Correct data  -&gt;  reliable operations  -&gt;  analytics  -&gt;  intelligence  -&gt;  automation. |
| Abstract from proven similarity | لا نعمم من الخيال؛ نعمم عندما نرى تكراراً حقيقياً. |

<a id="section-4"></a>

## 4. منهج DDD ونموذج التحليل

المسار الذي نعتمده لتحليل كل Vertical أو Feature هو:

```text
RIFAD SYS1 Requirements
```

```text
  v
```

```text
Business Domains / Capabilities
```

```text
  v
```

```text
Bounded Contexts
```

```text
  v
```

```text
Entities / Value Objects / Aggregates
```

```text
  v
```

```text
Workflows
```

```text
  v
```

```text
Domain Events
```

```text
  v
```

```text
Business Invariants
```

```text
  v
```

```text
Sync vs Async Guarantees
```

```text
  v
```

```text
Platform Core vs Vertical-specific
```

```text
  v
```

```text
Architecture & Technology
```

| المفهوم | المعنى في المشروع |
| --- | --- |
| Bounded Context | حد واضح لموديل وقواعد وملكية بيانات Business world معين. |
| Entity | كائن له Identity واستمرارية عبر الزمن. |
| Value Object | قيمة بلا Identity مستقلة، مثل Money أو OrderSource، ولها قواعد. |
| Aggregate | حد consistency يحمي invariants كوحدة واحدة. |
| Aggregate Root | البوابة التي تمر منها التغييرات المهمة على الـAggregate. |
| Domain Event | حقيقة Business حدثت بالفعل، مثل CheckRoundSubmitted أو PaymentCaptured. |
| Application Service/Use Case | Orchestration: تحميل Aggregate، فحص context، تنفيذ behavior، حفظ. |
| Repository | عقد للتخزين/التحميل لا يربط الـDomain بتقنية DB. |
| Invariant | قاعدة يجب ألا تنكسر مهما كان مصدر الطلب Web/Mobile/API/Worker/Offline. |

<a id="section-5"></a>

## 5. Capability Map

### 5.1 Platform Foundation

- Identity

- Organizations/Tenancy

- Authorization

- Entitlements

- Approvals

- Audit

- Notifications

- Files

- Integrations Platform

- Offline Sync Foundation

- Localization/Timezone

- Backup &amp; Recovery

### 5.2 Shared Business Domains

- Accounting

- Billing/Invoicing

- Payments

- Reconciliation

- Expenses

- Receivables/Payables

- Assets

- Inventory

- Procurement

- Suppliers

- Employees/Workforce

- Attendance

- Scheduling

- Branch Management

- Reporting

- Tasks

### 5.3 Restaurant-specific Capabilities

- POS &amp; Cashier

- Restaurant Ordering

- Floor/Tables

- Reservations

- Waiter Operations

- Kitchen/KDS

- Menu/QR/Self-ordering

- Recipes &amp; Production

- Food Cost &amp; Waste

- Restaurant channels &amp; operational capacity

### 5.4 Commerce/Channels &amp; Profitability

القناة ليست مجرد source string؛ SYS1 يريد اقتصاداً حقيقياً لكل قناة: revenue، orders، AOV، COGS، packaging، discounts، commissions، payment/delivery fees، true net profit. لذلك Channel Economics تعامل كقدرة تحليلية مشتركة مع تخصص المطاعم.

### 5.5 Intelligence &amp; Automation

- Menu Engineering

- Prep-time Intelligence

- Predictive Pre-preparation

- Branch Quality Monitor

- Hidden Waste Detection

- Per-order Profitability

- Congestion Manager

- Lost-customer Recovery

- Operating-hours Profitability

- Product Lab

- Forecasting

- Anomaly Detection

- Recommendations/Optimization

- AI Assistant

- Automation Engine

<a id="section-6"></a>

## 6. Bounded Context Map

| Bounded Context | المسؤولية/الملكية |
| --- | --- |
| Identity &amp; Access | Users، authentication، sessions، MFA، device identity. |
| Organizations | Organization/Tenant، membership، branches، settings. |
| Authorization | Roles، permissions، scoped assignments، policies. |
| Entitlements | ما تملكه الـOrganization من modules/features حسب الاشتراك. |
| Approvals | ApprovalRequest lifecycle وإعادة استخدامه عبر كل المجالات. |
| Audit | سجل Business/Security مستقل عن engineering logs. |
| Catalog/Menu | Products، categories، variants، modifiers، menu structure، branch applicability/availability. Pricing ownership منفصل. |
| Ordering | Open Check/Tab lifecycle، items، rounds/submissions، source، sale-time snapshots، close/cancel rules. لا نفترض confirm مرة واحدة للمطعم. |
| POS/Cash | Cashier session، cash drawer، opening/closing count، cash movements، drawer count difference. لا يملك tender/payment allocation. |
| Floor/Reservations | Tables، floor maps، waiting list، reservations، occupancy. |
| Kitchen | Kitchen ticket/item، station routing، prep states/time/rework. |
| Recipes/Production | Recipe composition، production definitions/orders. |
| Inventory | Warehouse، stock balances، movements، transfers، counts، waste، UOM/conversions، lot/expiry tracking policy؛ reservation اختيار policy وليس requirement افتراضي. |
| Procurement | Purchase requests، RFQ، PO، receiving، suppliers. |
| Workforce | Employee، attendance، branch assignment، schedules، leave/overtime. |
| Payments | Tender/payment allocation، payment attempt، capture، refund، payment method/provider transaction؛ branch-originated tender command يعمل على Edge runtime بينما context ownership واحد. |
| Billing | Invoice، invoice items، credit notes، receivables. |
| Accounting | COA، journals، ledger، periods، cost centers، financial statements. |
| Reconciliation | Provider/bank settlements، external matching، gateway fees، mismatches، reconciliation runs. Cash drawer count difference يبقى POS/Cash input وليس owned record هنا. |
| Integrations | Provider connections/adapters، credentials refs، external mappings، delivery logs. |
| Analytics | Read models، KPIs، facts/dimensions، management reporting. |
| Intelligence | Forecasts، anomalies، recommendations، optimization، LLM/tool orchestration. |
| Automation | Trigger + Condition + Action، actions call application commands. |
| Notifications | Email/SMS/WhatsApp/Push/In-app templates and delivery state. |
| Pricing | PriceList effective-dated by organization/branch/channel/device context، price resolution، service charge/rounding inputs. |
| Promotions | Coupons، combos، bundles، discount rules، eligibility، effective dates؛ لا تخلط مع Catalog. |
| Costing &amp; Profitability | Recipe/valuation inputs -&gt; deterministic food cost/order cost/product/channel profitability؛ sale-time cost snapshots؛ official journal remains Accounting. |
| Customers/CRM | Customer identity/profile/contact/consent/preferences، references to history؛ loyalty/feedback capabilities can evolve here or adjacent modules. |
| Expenses | Expense document/category/receipt extraction/review and accounting handoff. |
| Payables (AP) | Supplier liabilities، ageing، payment status، supplier invoice linkage. |
| Assets | Asset register، maintenance، depreciation inputs/policy integration with Accounting. |
| Delivery &amp; Dispatch | Internal delivery/driver assignment/dispatch/status/proof؛ external platforms remain Integrations. |
| Tasks / Work Management | Operational tasks created from alerts/complaints/maintenance/automation، assignee/status/due date. |
| Compliance/KSA/Fiscalization | KSA-specific fiscal compliance: EGS/device onboarding، CSID lifecycle، ICV/PIH chain، compliant XML/QR/signing/report/clear state، B2C reporting/B2B clearance. Billing owns invoice/credit note؛ Fiscalization owns cryptographic/compliance state؛ ZATCA transport remains adapter. |
| Catering / Large Orders - Candidate | Scheduled large/event orders، deposits، delivery windows، capacity commitments؛ M-1 decides standalone context vs Ordering extension. |
| Edge / Fleet Management | Edge node identity، branch binding، provisioning، signed release/update state، rollback، health، key/certificate rotation، device replacement؛ لا يملك Open Check أو Stock أو Invoice business truth. |

| قاعدة مهمة<br>Feature أو شاشة أو جهاز لا يساوي Bounded Context تلقائياً. POS/Waiter/Kiosk/QR قد تكون Application Surfaces تستخدم Ordering/Payments/Kitchen وغيرها. الحدود تتحدد باختلاف business rules والownership والlifecycles. |
| --- |

<a id="section-7"></a>

## 7. ملكية البيانات والعقود بين الوحدات

القاعدة المركزية: Module A لا يعدل جداول Module B مباشرة. الاتصال يتم بعقد Application/Port عند الحاجة إلى ضمان Sync، أو Domain Event عند الآثار غير المطلوبة قبل الرد.

| Data/Concept | Owner | Scope مبدئي |
| --- | --- | --- |
| User identity | Identity | Platform |
| Organization | Organizations | Tenant |
| Branch | Organizations | Organization |
| Membership | Organizations/Auth | Organization |
| Role/Permission | Authorization | Org/Branch |
| Product/Menu | Catalog | Organization + branch applicability |
| Open Check / Round / Submission | Ordering | Branch |
| Cashier Session / Drawer / Count Difference | POS/Cash | Branch |
| Table/Reservation | Floor | Branch |
| KitchenTicket | Kitchen | Branch |
| Recipe | Recipes | Organization/Branch applicability |
| Stock | Inventory | Warehouse |
| StockMovement | Inventory | Warehouse/Branch |
| PurchaseOrder | Procurement | Organization/Branch |
| Employee | Workforce | Organization |
| EmployeeAssignment | Workforce | Branch |
| Tender / Payment Allocation / Payment / Refund | Payments | Org/Branch |
| Invoice | Billing | Org/Branch |
| Journal/Ledger | Accounting | Organization + dimensions |
| Settlement/Matching | Reconciliation | Org/Provider/Bank |
| Approval | Approvals | Organization |
| Audit Entry | Audit | Org/Platform |
| PriceList / Price Resolution | Pricing | Organization/Branch/Channel |
| Promotion/Coupon/Combo | Promotions | Organization/Branch/Channel |
| Cost Snapshot / Profitability Fact | Costing | Branch/Order/Product/Channel |
| Customer / Consent | Customers | Organization |
| Expense | Expenses | Organization/Branch |
| Supplier Payable | Payables | Organization/Supplier |
| Asset | Assets | Organization/Branch |
| Dispatch/Driver Assignment | Delivery | Branch |
| Task | Tasks | Organization/Branch |
| Fiscalization State / CSID / ICV / PIH | Fiscalization | Organization/EGS/Branch |
| EdgeNode / Deployment / Device Version | Edge/Fleet Management | Organization/Branch/Device |

- Cross-module SQL للـReporting يذهب إلى Analytics projection، لا إلى business module internals.

- كل Public Contract محدود: Commands/Queries/Events؛ infrastructure internals تبقى private.

- الـExternal IDs لا تستبدل RIFAD internal IDs؛ تحفظ كـmappings فقط.

- الـModule boundaries يجب أن تفرض بالـNx/CI وليس بالاتفاق الشفهي فقط.

<a id="section-8"></a>

## 8. رحلة الطلب End-to-End

```text
POS / Waiter / QR / Kiosk / Delivery Platform
```

```text
  v
```

```text
  Ordering
```

```text
  +----------+-----------+
```

```text
  v  v  v
```

```text
  Kitchen  Recipes  Payments
```

```text
  v  v
```

```text
  Inventory  Billing
```

```text
  v  v
```

```text
  Costing  Accounting
```

```text
  \  /
```

```text
  v  v
```

```text
  Analytics
```

```text
  v
```

```text
  Intelligence
```

```text
  v
```

```text
  Automation
```

### 8.1 إنشاء الطلب والتسعير

- Pricing يملك حل السعر الحالي وفق PriceList/branch/channel/effective date؛ Ordering يحفظ sale-time price snapshot داخل الـCheck/line حتى لا تتغير المعاملة التاريخية بتغير الأسعار لاحقاً.

- Ordering يوحد المصدر داخلياً عبر OrderSource بدل نماذج مختلفة لكل قناة.

- External provider reference يحفظ بجوار RIFAD order ID ولا يصبح هو الهوية الداخلية.

### 8.2 التأكيد

في dine-in لا نفترض confirm مرة واحدة. الـOpen Check يبقى مفتوحاً ويقبل جولات/rounds؛ كل Round تُرسل للمطبخ كSubmission immutable نسبياً بعد الإرسال. CloseCheck يحدث عند التسوية/الإغلاق. لا يخصم الـAggregate stock ولا ينشئ journal ولا يرسل WhatsApp داخله.

### 8.3 المطبخ

Kitchen يحول عناصر الطلب إلى KitchenTicket/KitchenItems ويقسمها على stations. حالة كل عنصر مستقلة عن order status.

### 8.4 الوصفة والمخزون

Recipes تملك composition/version/modifier impact ولا تعتمد عليها Inventory مباشرة. عند RoundSubmitted يشغّل Restaurant Consumption Orchestrator محلياً على Edge: يقرأ Recipe contract، يحوّل line/modifiers إلى ingredient quantities/UOM، ثم يرسل ConsumeStock command إلى Inventory. Inventory لا تعرف Burger/Latte؛ تعرف itemId/qty/warehouse/reason/sourceOperationId فقط. Costing يلتقط deterministic snapshot من نفس facts.

- Void/Comp بعد RoundSubmitted لا يمسح التاريخ: قبل التحضير يمكن policy أن تنتج consumption reversal؛ بعد التحضير تتحول الكمية إلى Waste/controlled adjustment؛ Comp يغيّر الإيراد/السبب لكنه لا يعيد مكونات تم استهلاكها.

### 8.5 الدفع والفاتورة والمحاسبة

- Payments تجيب: ما المال الذي تحرك؟

- Billing تجيب: ما المستحق وما وثيقته؟

- Accounting تجيب: كيف نمثل الأثر المالي رسمياً؟

- Sale Finalization ينسق Payments + Billing + Fiscalization على Edge قبل Check CLOSED، ثم Cloud Accounting posts source facts idempotently بعد sync عند الحاجة.

- Reconciliation تجيب: هل provider/acquirer/bank settlement الخارجي يطابق ما سجله النظام؟ فرق عدّ الصندوق يبقى POS/Cash concern ويظهر كتغذية/دليل عند الحاجة.

### 8.6 التحليلات والذكاء

Analytics تحدث projections/KPIs asynchronously عادة، ثم Intelligence تفسر/تتنبأ/توصي. المستخدم لا ينتظر Dashboard أو AI لكي يكتمل البيع.

<a id="section-9"></a>

## 9. State Machines / Business Invariants

### 9.1 Open Check

```text
OPEN  ->  CLOSING  ->  CLOSED
```

```text
OPEN  ->  CANCELLED (check-level cancellation؛ item-level VOID/COMP له lifecycle مستقل)
```

- لا CLOSED -&gt; OPEN صامتاً؛ أي إعادة فتح/تصحيح له Process + Approval/Audit.

- الجولات المرسلة للمطبخ لا تُمحى من التاريخ عند تعديل الحساب؛ الإلغاء/void/comp يتم بسبب واضح وأثر معاكس/تعويضي عند الحاجة.

- قبل إرسال Round: يجب توافر branch/source/items/currency/pricing snapshot والبيانات المطلوبة؛ ويمكن أن يبقى Check مفتوحاً لإضافة جولة لاحقة.

- أي Line/Submission تاريخية لا يتغير price/cost/recipe snapshot لها عشوائياً بعد الإرسال؛ التصحيح يتم بعملية صريحة.

### 9.2 Payment

```text
CREATED  ->  PENDING  ->  AUTHORIZED  ->  CAPTURED
```

```text
PENDING  ->  FAILED / CANCELLED
```

```text
CAPTURED  ->  PARTIALLY_REFUNDED  ->  REFUNDED
```

- RefundedAmount &lt;= CapturedAmount.

- CapturedAmount &lt;= AuthorizedAmount عندما ينطبق authorization flow.

- نفس payment operation لا تنتج business effect مرتين.

### 9.3 Kitchen Item

```text
NEW  ->  QUEUED  ->  PREPARING  ->  READY  ->  SERVED
```

```text
  \  REWORK_REQUIRED  ->  PREPARING
```

### 9.4 Inventory Availability / Optional Reservation

```text
Availability truth derives from stock movements; reservation is optional policy per item/order type.
```

```text
If enabled: PENDING -> RESERVED -> CONSUMED / RELEASED
```

### 9.5 Cashier Shift

```text
PLANNED  ->  OPEN  ->  CLOSING  ->  CLOSED
```

- إذا فرق العد النقدي تجاوز policy: CLOSING -&gt; REVIEW_REQUIRED -&gt; CLOSED. هذا POS/Cash review وليس Reconciliation bounded context.

الشفت المغلق لا يعدل صامتاً؛ يتم Adjustment/Audit/Approval.

### 9.6 Purchase Order

```text
DRAFT  ->  SUBMITTED  ->  APPROVED  ->  SENT  ->  PARTIALLY_RECEIVED  ->  RECEIVED  ->  CLOSED
```

```text
  +------ ->  REJECTED
```

### 9.7 Invoice

```text
DRAFT  ->  ISSUED  ->  PARTIALLY_CREDITED  ->  CREDITED
```

```text
DRAFT  ->  VOID فقط قبل الإصدار القانوني؛ بعد ISSUED التصحيح يكون Credit Note/adjustment وليس حذفاً أو void صامتاً.
```

- حالة الدفع ليست lifecycle للفاتورة؛ UNPAID/PARTIALLY_PAID/PAID تُستنتج من Payment Allocations المملوكة لـPayments.

<a id="section-10"></a>

## 10. Open Check / Ordering Aggregate Model

نموذج v1.4 يميز بين Open Check/Tab وبين Kitchen Submission. للـdine-in، Check هو الجذر التشغيلي المقترح للحساب المفتوح، ويحتوي items وحالة التسوية؛ الجولات المرسلة للمطبخ تُسجل كRounds/Submissions ذات تاريخ وحالة مستقلة. للقنوات السريعة يمكن أن يكون Check بجولة واحدة فقط.

```text
Check / OpenTab (Aggregate Root)
```

```text
+-- id
```

```text
+-- organizationId
```

```text
+-- branchId
```

```text
+-- source
```

```text
+-- customerId?
```

```text
+-- tableId?
```

```text
+-- currency
```

```text
+-- status: OPEN / CLOSING / CLOSED / CANCELLED
```

```text
+-- items[] + submittedRounds[]
```

```text
+-- subtotal / discount / tax / total
```

```text
+-- notes
```

```text
+-- timestamps
```

```text

```

```text
OrderItem (Entity)
```

```text
+-- id / organizationId / branchId
```

```text
+-- productId
```

```text
+-- productNameSnapshot
```

```text
+-- quantity
```

```text
+-- unitPriceSnapshot
```

```text
+-- modifiers[]
```

```text
+-- lineTotal
```

- Behaviors: addItem، removeItem/changeQuantity قبل الإرسال حسب policy، applyDiscount، submitRound، void/compItem بسبب مسجل، beginClosing، closeCheck، cancelCheck حسب state/authorization.

- Value Objects: Money، OrderSource، CheckStatus، RoundStatus، Quantity/Discount/ReasonCode حسب الحاجة.

- Product نفسه خارج Aggregate؛ Order يحتفظ reference + snapshot.

- Payment/Stock/KitchenStation/Journal/AIRecommendation خارج Open Check Aggregate.

- Open Check يسمح بإضافة Round جديدة بعد إرسال Round سابقة؛ هذا هو السيناريو الطبيعي للطاولة المفتوحة.

- Round/Submission المرسلة للمطبخ لا يعاد تحريرها تاريخياً كأنها لم تحدث؛ التغيير يسجل void/comp/correction بسبب واضح.

- Split bill هو Settlement/Billing concern فوق Check items/allocations، وليس سبباً لنسخ الطلب أو كسر تاريخ المطبخ.

- Price snapshot وRecipeVersion وCostSnapshot وModifierRecipeImpact يجب أن تكون قابلة للتتبع لكل line/submission حيث يلزم.

<a id="section-11"></a>

## 11. Inventory Architecture

v1.4 Foundation: Unit of Measure (UOM) والتحويلات، lot/batch، expiry tracking policy، recipe version references، وcosting inputs تُصمم من البداية حتى لو بعض واجهاتها تتأخر إلى M3.

- مثال UOM: kg/g، liter/ml، piece/box مع conversion rules واضحة؛ لا نخزن وصفة بوحدات نصية عشوائية.

- Lot/Expiry تكون capability قابلة للتفعيل حسب الصنف (NONE / LOT / LOT+EXPIRY)، وليس إجباراً لكل مادة.

Stock Balance وحده لا يكفي. الحقيقة التاريخية في StockMovement، والرصيد الحالي projection/aggregate state مبني على الحركات الصحيحة.

```text
StockItem
```

```text
+-- onHand
```

```text
+-- reserved? (only when policy uses reservation)
```

```text
+-- availabilityPolicy + policy-derived available state
```

- Availability policies: TRACK_ONLY، ALLOW_NEGATIVE_WITH_ALERT، BLOCK_ON_EDGE_KNOWN_STOCK، RESERVE_BEST_EFFORT/RESERVE_WHEN_COMMITTED عند الحاجة. لا يوجد hard reservation عالمي؛ policy per item/category/channel. أثناء Offline، BLOCK تعني وفق state الموثوق داخل Edge فقط وليست global-consistency promise.

- كل تغير stock يجب أن ينتج StockMovement append-only وله reason/source/reference + idempotency/sourceOperationId لمنع تطبيق نفس الاستهلاك مرتين.

- Movement types: PURCHASE_RECEIPT، SALE_CONSUMPTION، WASTE، TRANSFER_IN/OUT، COUNT_ADJUSTMENT، PRODUCTION_CONSUMPTION/OUTPUT، RETURN_IN/OUT.

- Race conditions تعالج بـlocking مناسب (optimistic أو pessimistic حسب hot spot/load).

- Stock transfer له lifecycle وshippedQty  !=  receivedQty؛ discrepancies تسجل صراحة.

- الجرد لا يكتب stock=92 مباشرة؛ ينتج COUNT_ADJUSTMENT -8 مع audit.

- Costing يحتاج policy مثل weighted average/FIFO حسب المتطلبات المحاسبية النهائية.

### 11.1 Concurrency

Concurrency تُعالج حسب availability policy داخل authority التي تملك المخزون التشغيلي. BLOCK_ON_EDGE_KNOWN_STOCK / RESERVE تُطبق ذرياً على SQLite/Edge للـbranch warehouse باستخدام transaction/version guard. ALLOW_NEGATIVE_WITH_ALERT يسجل الحركة أولاً ثم exception/alert. Cloud-originated receipt/transfer إلى branch-owned warehouse لا يعدل نفس stock مباشرة؛ يُرسل Branch Inventory Command للـEdge. Central warehouse بلا Edge يمكن أن يبقى Cloud-owned.

<a id="section-12"></a>

## 12. Payments / Billing / Accounting / Reconciliation

| قاعدة<br>Payment  !=  Invoice  !=  Journal Entry  !=  Settlement. |
| --- |

| السياق | السؤال الذي يجيب عنه | ملكية رئيسية |
| --- | --- | --- |
| Payments | ما المال الذي تحرك أو حاول التحرك؟ | PaymentAttempt، Capture، Refund، ProviderTransaction |
| Billing | ما المستحق ولماذا؟ | Invoice، Items، CreditNote، Receivable |
| Accounting | ما التمثيل المحاسبي الرسمي؟ | COA، JournalEntry، Ledger، Period، CostCenter |
| Reconciliation | هل نظامنا يطابق provider/bank/cash؟ | Settlement، Match، Mismatch، Fees، Runs |

- Idempotency إلزامية للcharges/refunds/webhooks/retries.

- لا اعتماد على frontend success كحقيقة للدفع؛ provider state/webhook/reconciliation هي المصادر المناسبة.

- Journal Entry invariant: Debit = Credit.

- Posted financial records لا تحذف/تعدل صامتاً؛ corrections/reversals/controlled reopen حسب القواعد.

- Settlement قد يكون أقل من Payment بسبب fees/commissions؛ reconciliation يفسر الفرق.

- Source traceability: Journal  -&gt;  source document/event/reference.

### 12.1 Finance ownership from M1 - maturity grows in M2

لا توجد ملكية مؤقتة داخل POS ثم migration لاحقاً. Payments/Billing/Accounting/Fiscalization موجودة كـcontexts من M1؛ الفرق بين M1 وM2 هو عمق الـcapability فقط.

| Capability | Maturity boundary |
| --- | --- |
| Payments - M1 minimum | Cash/manual-card tender، allocations، basic split payment، basic refund/idempotency. |
| Billing - M1 minimum | Invoice + Credit Note + VAT representation + original-invoice link. |
| Accounting - M1 minimum | Ledger/journal core، deterministic sales/refund/cash posting، source traceability. |
| Fiscalization - M1 minimum | Issue/sign/report/clear status path required for KSA pilot. |
| M2 maturity | Gateway settlements/reconciliation، advanced refunds/approvals، AR/AP/Expenses/Assets، period close/statements، advanced finance operations. |

### 12.2 Sale Finalization Unit - Edge runtime

عند إغلاق بيع branch-originated، لا يكون Billing async consumer بعد check.closed. Application-level Sale Finalization على Edge ينسّق contexts بدون نقل ملكيتها: Payments يسجل tender/allocation، Billing يصدر Invoice/Credit Note ويخصص document number وفق policy، Fiscalization يجهز/يوقّع/يحفظ ICV/PIH/compliance state، ثم يتحول Check من CLOSING إلى CLOSED. B2B أو أي flow يحتاج clearance online يبقى Online-Required ولا يغلق كـoffline-safe path.

- Billing document number/business document identity وFiscal ICV/PIH سلسلتان منفصلتان؛ Billing يملك الأولى وFiscalization يملك الثانية. Exact numbering/EGS granularity تُثبت من official KSA design في M-1.

- Cloud Accounting Ledger لا يُشغّل كـfull ledger على Edge. Finalization يحفظ locally durable source facts/posting intent؛ عند الاتصال تُزامن ويُنشئ Accounting journals idempotently. Connected mode يكون near-real-time، Offline mode eventual بدون فقد.

- M1 Accounting minimum يشمل posting rules للمبيعات/VAT/tender/refund-credit note وCOGS/stock consumption/waste/adjustment/receipt where applicable، مع branch/channel/source-document dimensions من أول Journal.

<a id="section-13"></a>

## 13. Offline &amp; Branch Edge Architecture

قرار V1.4: Branch Operations تعمل Edge-first دائماً. POS/Waiter/KDS/Kiosk داخل الفرع يرسلون كل branch-originated operational commands إلى Edge في connected وdisconnected modes. Cloud ليست fallback writer؛ هي master للglobal configuration وexternal intake وcentral finance/analytics، وتتكامل مع Edge عبر commands/projections/sync.

### 13.1 Authority Model - لا Dual Writer

السلطة موزعة حسب نوع الحقيقة، لا حسب حالة الإنترنت. هذا يمنع handoff المتكرر Cloud-&gt;Edge-&gt;Cloud ويجعل الانقطاع مجرد توقف sync لا تغييراً في مسار التنفيذ.

| Data/Operation | Primary authority | Cloud/Edge relationship |
| --- | --- | --- |
| Open Check / Round / Kitchen / Cashier Session / Drawer | Branch Edge | Cloud receives synced replica/read models; no cloud mutation لنفس aggregate. |
| Branch stock consumption/waste/count/branch receipt-transfer execution | Branch Edge | Cloud orchestration may request movement via Branch Inventory Command; Edge executes/acks. Central warehouse without Edge may be Cloud-owned. |
| Tender / payment allocation for branch sale | Payments context on Branch Edge runtime | Cloud receives canonical synced payment facts; provider/bank reconciliation remains Cloud. |
| Invoice / Credit Note issuance for branch sale | Billing context on Branch Edge runtime | Issued synchronously in Sale Finalization for offline-safe B2C path; Cloud gets synced canonical copy. |
| KSA fiscal chain/signing for offline-safe B2C | Compliance/KSA/Fiscalization agent on Edge when approved | Edge controls local fiscal sequence/signing state; Cloud handles reporting/retry/ops after sync. Exact EGS/numbering validated in M-1. |
| B2B / online-clearance fiscal document | Edge initiates; online Fiscalization/ZATCA clearance required | Check cannot complete offline if legal flow requires pre-clearance. |
| Customer creation/consent captured at POS | Customers context; append/command accepted on Edge | Anonymous remains valid. Edge queues creation/consent; Cloud customer master reconciles via explicit identity/idempotency policy, not generic LWW. |
| Approval policies / roles / PIN master | Cloud master -&gt; signed/versioned Edge projection | Operational manager approval may be decided/captured locally when policy marks action offline-safe; decision/audit syncs Cloud. |
| Catalog/Pricing/Promotions/Recipes/UOM/Cost inputs/Tax/Service/Rounding/Employees/Floor/Fiscal config | Cloud master | Edge carries versioned Branch Operational Projection / last-known-valid package with expiry/online-required rules. |
| External platform / public QR arrival | Cloud intake -&gt; Branch Command Queue -&gt; Edge acceptance | If Edge unreachable: explicit pending/reject/pause policy per channel; Cloud never creates competing Check. |
| Accounting ledger / provider-bank Reconciliation / Analytics / AI / Org administration | Cloud | No full ledger/analytics/AI authority on Edge; consumes synced source facts. |

### 13.2 Cloud-to-Edge Commands &amp; Conflict Policy

External orders/config changes لا تكتب Open Check/Stock branch state مباشرة في Cloud. Cloud ينشئ command أو versioned projection؛ Edge يقبل/يرفض/يطبق ويعيد acknowledgment. Open Check/Round، branch stock movements، tender/invoice finalization، والفiscal sequence order-sensitive/single-writer؛ لا generic LWW لها.

### 13.3 Minimum Edge Lifecycle from M1

- Signed update artifacts + version manifest؛ verify before install.

- Atomic/staged update + rollback to last known good version.

- Device/Edge identity + branch binding + certificate/key rotation.

- Health/version/lastSeen/disk/sync lag remote reporting.

- Controlled device replacement/re-provisioning and fiscal-key/sequence continuity procedure.

- Operational clients/assets can boot locally without Cloud/CDN.

```text
  RIFAD CLOUD
```

```text
  API / DB / Inbox / Sync
```

```text
  ^  |
```

```text
  |  v
```

```text
  Secure Sync
```

```text
  ^  |
```

```text
  |  v
```

```text
  BRANCH EDGE
```

```text
  Local API + Local DB + Outbox
```

```text
  | LAN
```

```text
  +---------+---------+
```

```text
  POS  Waiter  KDS
```

- Edge هي Branch Operational Runtime وليست نسخة كاملة من الـSaaS: تحمل كل ما يلزم critical path داخل الفرع، بينما administration/advanced finance/analytics/AI تبقى Cloud.

- IDs يجب أن تكون globally unique ويمكن توليدها offline.

- كل mutation offline لها operationId، sequence/version، occurredAt، deviceId، org/branch scope.

- Local Outbox + Cloud Inbox يضمنان retry/deduplication.

- نزامن Business Operations/Events، لا نعمل table replication عمياء.

- Conflict resolution domain-specific: Last Write Wins ليس حلاً عاماً.

- Cash payment offline-friendly؛ card/online payment يعتمد على provider/terminal capability.

- Branch Operational Projection يحتاج Catalog/Pricing/Promotions/Recipes+modifier impact/UOM/inventory policy/cost inputs/tax+service+rounding/employees+PIN+roles/floor+fiscal config/device config؛ كل projection versioned وله last-known-valid/expiry policy.

- occurredAt  !=  syncedAt؛ التقارير تعتمد وقت الحدث الحقيقي.

- Edge health metrics: lastSeen، lastSync، pending/failed events، disk، version، sync lag.

| Operation | Offline policy مبدئية |
| --- | --- |
| Create cash order | مسموح |
| Kitchen routing/status | مسموح |
| Table updates | مسموح |
| Print receipt | مسموح |
| Cash payment | مسموح |
| Inventory consumption/waste | مسموح مع local authority |
| Card/online gateway | حسب provider |
| Large refund | Online/approval غالباً |
| Permission management | غير مسموح |
| Accounting close | غير مسموح |
| Organization settings | غير مسموح |

- قرار v1.4: Minimum Edge + Edge-first authority يدخلان M1 Exit Criteria. branch-originated Open Check/Rounds/Kitchen/Cash/local stock movements تُكتب محلياً ثم تُزامن؛ Cloud لا يعدل نفس الـCheck بالتوازي.

- Edge يجب أن يستطيع خدمة ملفات الـOperational Client محلياً أو عبر packaging موثوق، حتى يفتح POS/KDS إذا Cloud/CDN غير متاح.

- Local connectivity strategy (HTTPS/local certificates أو browser Local Network Access أو native shell/managed client) تُحسم بPrototype في M0؛ لا نعتمد على browser assumption غير مختبر.

- بيانات SQLite/Edge الحساسة تحتاج Encryption-at-rest/key management decision؛ full-disk encryption وحده قد يكون طبقة إضافية لا بديلاً عن التهديدات المحددة.

- Hardware Bridge: الطابعة/درج النقد/الميزان/Customer display تتصل عبر Edge Device Gateway/adapter قدر الإمكان بدلاً من ربط Domain أو browser مباشرة بSDK جهاز.

- Offline Policy يجب أن تفرق بين POS/Waiter/KDS المحلي وبين QR public/external delivery التي تعتمد على وصول Cloud؛ card/B2B fiscal flows قد تكون online-required حسب provider/compliance.

### 13.4 Branch Operational Projection

Cloud master data لا تُقرأ live من كل POS request. Sync يبني package/versioned projections داخل Edge. كل projection تحمل sourceVersion/generatedAt/effectiveAt وأي expiry/online-required rule، ويجب أن يستطيع Edge إعادة بناءها/استبدالها atomically.

- Catalog/Menu + branch availability.

- Pricing + Promotions + tax/service charge/cash rounding rules.

- Recipes + modifier recipe impact + UOM/conversions + inventory availability policy + costing inputs.

- Employee/PIN/role/branch-scope projection + offline approval policy.

- Floor/tables + device/printer configuration.

- KSA Fiscal configuration/credentials references حسب approved security model.

### 13.5 Edge Runtime Profile &amp; Local Realtime

Edge-resident runtime modules هي Application Profiles لنفس bounded contexts، وليست contexts جديدة: Ordering، POS/Cash، Kitchen، Floor operational state، Restaurant Consumption Orchestrator + Recipes projection، Inventory branch operations، Payments minimum، Billing minimum/Sale Finalization، Compliance/KSA/Fiscalization agent، local approval/PIN checks، Local Event Dispatcher، Sync Inbox/Outbox، Device Gateway، Local Realtime.

- POS/Waiter/KDS/Customer Display realtime داخل الفرع يمر عبر Edge WebSocket/Socket.IO ولا يعتمد على Cloud. Cloud realtime مخصص للإدارة/المراقبة/remote dashboards ويقرأ synced state.

- Local Event Dispatcher داخل Edge لا يستخدم BullMQ كشرط. BullMQ هو Cloud worker/job transport؛ Edge events تُحفظ مع local outbox وتوزع محلياً idempotently ثم تُزامن Cloud.

<a id="section-14"></a>

## 14. تعدد المستأجرين ونموذج المؤسسة والفروع

```text
RIFAD Platform
```

```text
  |
```

```text
  +-- Organization / Tenant
```

```text
  +-- Memberships
```

```text
  +-- Subscription / Entitlements
```

```text
  +-- Central Catalog
```

```text
  +-- Accounting
```

```text
  +-- Central Warehouse? (optional)
```

```text
  +-- Branches
```

```text
  +-- Orders / POS / Kitchen
```

```text
  +-- Warehouse / Inventory
```

```text
  +-- Tables / Reservations
```

```text
  +-- Staff Assignments
```

- User شخص Platform-level؛ علاقته بالشركة عبر Membership وليس user.organization_id فقط.

- V1 لا يفرض Workspace/BusinessUnit layer من الخيال؛ نضيفها عندما تثبت بقية القطاعات الحاجة.

- Product غالباً Organization-scoped مع branch availability/price overrides.

- Inventory warehouse-scoped؛ warehouse قد يكون مرتبطاً بفرع أو مركزياً.

- Accounting organization-level مع branch/cost-center dimensions.

- Shared DB + strict organization scoping هو الاختيار المبدئي؛ database-per-tenant ليس V1.

| Security Invariant<br>Tenant A لا يصل أبداً إلى Business Data لـTenant B. الـPermission لا يلغي ownership check، والـbranch scope يأتي بعد tenant boundary. |
| --- |

### 14.1 PostgreSQL Row-Level Security (RLS) - Defense in Depth

- RLS-by-default: أي tenant-owned PostgreSQL table لا تعتبر migration مكتملة بدون policy + tests أو exception موثق. RLS Defense-in-Depth فوق authorization/repository scoping، وليس بديلاً عنه.

- Runtime application role لا يكون table owner ولا SUPERUSER ولا BYPASSRLS؛ owner/migration role منفصل.

- Tenant context يُثبت لكل transaction/request بطريقة آمنة مع connection pooling (مثلاً transaction-local setting/context) ويُنظف تلقائياً بانتهاء transaction.

- Workers لا تحصل على global bypass افتراضياً؛ تستخدم scoped service role/context، وعمليات platform/admin الاستثنائية لها role منفصل ومراجعة/audit.

- Integration tests تشمل cross-tenant SELECT/INSERT/UPDATE/DELETE ومحاولات missing-context؛ default-deny هو الهدف عند تفعيل RLS.

<a id="section-15"></a>

## 15. Identity / Authorization / Approvals / Audit

```text
Request
```

```text
  v
```

```text
Authenticate User
```

```text
  v
```

```text
Validate Session / Device
```

```text
  v
```

```text
Resolve Organization
```

```text
  v
```

```text
Validate Membership
```

```text
  v
```

```text
Check Entitlement
```

```text
  v
```

```text
Check Permission (RBAC)
```

```text
  v
```

```text
Check Resource Scope / Context (ABAC)
```

```text
  v
```

```text
Check Domain Rule
```

```text
  v
```

```text
Approval / Step-up MFA if required
```

```text
  v
```

```text
Execute
```

```text
  v
```

```text
Audit
```

- Role تجميع Permissions؛ scope قد يكون Organization أو Branch أو Resource context.

- Entitlement يجيب: هل الشركة اشترت/فعلت feature؟ Permission يجيب: هل المستخدم مسموح له؟

- Platform Admin منفصل عن Organization Admin.

- Support access يكون time-limited، reason-required، audited، وread-only افتراضياً.

- Sensitive operations يمكن أن تعيد ALLOW / DENY / REQUIRE_APPROVAL / REQUIRE_MFA.

- Offline permissions تصنف إلى offline-safe وonline-required.

<a id="section-16"></a>

## 16. Integration Architecture

```text
RIFAD Domain
```

```text
  v
```

```text
Integration Port
```

```text
  v
```

```text
Provider Adapter / Anti-Corruption Layer
```

```text
  v
```

```text
External API
```

- External payload لا يعدل Domain مباشرة؛ verify  -&gt;  deduplicate  -&gt;  normalize  -&gt;  internal command/event.

- Inbound webhooks: signature/timestamp/provider/eventId/replay protection/inbox/idempotency.

- Outbound webhooks: subscription، signing، delivery log، retry/backoff، failure/DLQ.

- Timeouts + retries + backoff + jitter + circuit breaker + bulkhead + rate-limit awareness.

- Retry فقط للأخطاء القابلة للتحسن؛ invalid credentials/payload لا يعاد عشوائياً.

- Provider credentials per tenant تحفظ كsecret references، لا plaintext ولا frontend.

- Integration health: latency، success rate، last error/sync، pending/delayed jobs.

- Open API للشركاء لها auth/scopes/versioning/rate limiting/audit منفصل عن internal API.

<a id="section-17"></a>

## 17. Reporting &amp; Analytics Architecture

نفصل OLTP عن OLAP منطقياً منذ البداية. Production DB لا تصبح Data Warehouse ولا تسمح لتقرير ثقيل بإبطاء POS.

```text
Operational Domains
```

```text
  v  Events / ETL / CDC later
```

```text
Analytics Pipeline
```

```text
  v
```

```text
Reporting / Analytical Store
```

```text
  +-- Dashboards
```

```text
  +-- Reports
```

```text
  +-- KPIs
```

```text
  +-- AI/ML trusted features
```

- V1: reporting read models/materialized/summary tables + background projections، وربما read replica عند الحاجة.

- Fact concepts: sales، inventory، payment، waste، labor. Dimensions: branch/product/channel/employee/time.

- Real-time للعمليات الحالية؛ near-real-time للـdashboards؛ batch للتحليلات الثقيلة/السنوية حسب الحاجة.

- Metric definitions مركزية: Gross Sales، Net Sales، Net Profit، Food Cost %، AOV، Waste Rate... لا تحسب كل شاشة بطريقتها.

- Analytics downstream ولا تعدل Domain.

- Historical analytics تستخدم occurredAt/business timezone، خصوصاً مع offline sync.

- Tenant/branch authorization يطبق على analytics أيضاً.

- Data lineage وquality checks أساس الثقة في التقارير والـAI.

<a id="section-18"></a>

## 18. AI / Intelligence / Automation Architecture

```text
Operational Truth
```

```text
  v
```

```text
Analytics / Trusted Metrics
```

```text
  v
```

```text
+--------------+---------------+----------------+
```

```text
Forecasting  Anomaly  Optimization
```

```text
+--------------+-------+-------+----------------+
```

```text
  v
```

```text
  Recommendation Engine
```

```text
  v
```

```text
  AI Orchestrator
```

```text
  /  LLM Tools  Vision/Docs
```

```text
  v
```

```text
  Approval/Policy
```

```text
  v
```

```text
  Automation Engine
```

```text
  v
```

```text
  Domain Action
```

| طبقة | الدور |
| --- | --- |
| Deterministic Analytics | حقائق وحسابات: margins، food cost، channel economics، KPIs. |
| Forecasting | توقع الطلب/المبيعات/المخزون/العمالة مع confidence/model version. |
| Anomaly Detection | اكتشاف deviations غير الطبيعية مثل waste/fees/prep-time. |
| Optimization | حل مسائل السعر/الخصم/capacity/pre-preparation رياضياً. |
| LLM Assistant | يفهم السؤال، يستدعي Authorized Tools، يشرح ويربط الحقائق. |
| Vision/Document AI | Receipt/menu image extraction مع confidence ومراجعة بشرية. |
| Automation | Event + Condition + Action ويستدعي Application Commands. |

- LLM لا تنشئ financial facts ولا inventory balances ولا تقرر أن payment حدث.

- Security لا تعتمد على prompt؛ tools نفسها scoped ومصرح بها.

- Prompt ليس مكان business invariants.

- AI recommendations structured وقابلة للقياس، مع feedback loop prediction -&gt; action -&gt; actual -&gt; evaluation.

- Autonomy تبدأ Insight/Recommendation/User-approved، ولا نقفز إلى fully autonomous high-risk actions.

- Model Gateway provider-agnostic يدعم routing بين model types/cost tiers.

### 18.1 Intelligence Data Contract - البيانات تبدأ قبل AI

- من M1 نسجل RecipeVersion وPriceSnapshot وCostSnapshot وقت البيع/الإرسال حيث يلزم.

- Reason codes structured للـvoid/comp/refund/waste/staff meal/rework بدل free text فقط.

- Kitchen timestamps لكل station/state لقياس prep time/bottlenecks لاحقاً.

- Customer identity/consent عندما تكون معروفة، بدون إجبار الطلب المجهول على إنشاء Customer.

- Station capacity/configuration، shift/device/channel attribution، periodic count variance، occurredAt vs syncedAt.

- كل Prediction لاحقاً يجب ربطه بـmodelVersion/generatedAt/confidence، وكل Recommendation تربط outcome/acceptance إن أمكن.

<a id="section-19"></a>

## 19. Reliability &amp; Observability

الاعتمادية لا تعني عدم الفشل؛ تعني أن الفشل متوقع، محدود، قابل للرؤية، قابل للتعافي، ولا يفسد business truth.

| المجال | المعيار |
| --- | --- |
| SLI/SLO/SLA | قياس فعلي / هدف داخلي / وعد تعاقدي. |
| Golden Signals | Latency، Traffic، Errors، Saturation. |
| Logs | Structured مع request/correlation/org/branch/user/device/resource/errorCode بدون secrets. |
| Metrics | Technical + Business: order/payment/stock/queue/sync/provider metrics. |
| Tracing | رحلة العملية وتوزيع latency عبر components. |
| Queues | depth، oldest age، throughput، failures، retries، DLQ. |
| Resilience | Timeout، retry classification، exponential backoff+jitter، circuit breaker، bulkhead، backpressure. |
| Delivery Semantics | At-least-once + idempotent processing بدلاً من وعود exactly-once الساذجة. |
| Backups | Automated + offsite + restore tests. |
| DR | RPO/RTO حسب criticality؛ multi-region ليس Day 1. |
| Deployments | Rolling/Blue-Green/Canary + feature flags + expand/migrate/switch/contract migrations. |

- Critical tier: Orders/POS/Payments/Inventory operational path/Edge. AI/reporting يمكن أن degrade دون إيقاف البيع.

- Business observability أهم من CPU فقط: duplicate payments، failed kitchen dispatches، unsynced events، settlement mismatch.

- Reconciliation نفسها Reliability mechanism تكشف event/webhook discrepancies.

- Postmortems تركز على detection/containment/prevention وليس لوم فرد.

<a id="section-20"></a>

## 20. RIFAD Architecture V1 النهائية

```text
CLOUD-FACING: Admin / Public QR / External Platforms / Integrations
```

```text
          |
```

```text
          v
```

```text
 API / Auth / Tenant / Global Config
```

```text
          |
```

```text
 CLOUD MODULAR MONOLITH + OLTP + WORKERS
```

```text
          |  Secure Sync / Branch Commands / Projections
```

```text
          v
```

```text
 BRANCH EDGE (operational authority)
```

```text
 Local API + SQLite + Outbox + Device Gateway + Local Assets
```

```text
          | LAN
```

```text
 +--------+--------+--------+--------+
```

```text
 POS    Waiter    KDS     Kiosk   Devices
```

```text

```

```text
Rule: branch-originated operational writes do not bypass Edge.
```

```text
Cloud owns global/master concerns; Edge owns branch critical-path execution.
```

### 20.1 Deployable Units V1

- rifad-api: Cloud Modular Monolith entry point للadmin/global/public/external intake + remote realtime/read APIs؛ لا branch operational direct-write.

- rifad-worker: outbox relay/jobs/consumers/integrations/reports/automation/AI background.

- rifad-edge: Branch operational authority + SQLite + local outbox/dispatcher + local realtime + sync inbox/outbox + branch projections + device gateway/local assets.

### 20.2 ما لا نبنيه في V1

- 23 Microservices

- Kafka cluster

- Kubernetes/service mesh

- Event Sourcing كامل

- CQRS framework في كل مكان

- Multi-region Active/Active

- Database per tenant

- Elasticsearch/OpenSearch من البداية

- Data Lake/ML platform ضخمة

- Fully autonomous AI

<a id="section-21"></a>

## 21. Technology Stack V1

| المنطقة | قرار V1 | ملاحظات |
| --- | --- | --- |
| Language | TypeScript | Shared language عبر cloud/worker/edge/frontends. |
| Runtime | Node.js 24 LTS | Production baseline. Node 26 remains Current at snapshot; re-evaluate only after it enters LTS and compatibility/load tests pass. |
| Backend | NestJS 11.2.x + Fastify | نثبت 11.2.x مبدئياً رغم صدور Nest 12 حديثاً جداً، ثم نختبر upgrade لاحقاً. |
| Monorepo | Nx + pnpm | Boundary enforcement + build/test orchestration. |
| OLTP DB | PostgreSQL 18.x | Current supported major؛ transactional + reporting-friendly capabilities. |
| DB Access | Kysely | Type-safe explicit SQL/query builder؛ Domain غير مربوط ORM entities. |
| Cache | Redis 8.x | Instance مخصصة للcache. |
| Jobs | BullMQ + dedicated Redis | Queue Redis منفصلة، noeviction/persistence مناسب. |
| Durable Events | PostgreSQL Transactional Outbox | Queue ليست source of truth. |
| Realtime | Socket.IO/WebSocket - Edge local + Cloud remote | Edge serves POS/Waiter/KDS realtime داخل الفرع؛ Cloud realtime للadmin/remote views. Realtime channel ليس durability layer. |
| Edge DB | SQLite WAL | عبر Edge API، لا فتح DB file مباشرة على الشبكة. |
| Admin | Next.js 16 Active LTS + React 19 | Pinned patched release عند التنفيذ. |
| POS/Waiter/KDS/Kiosk | React + Vite; Edge-hosted/packaged operational client | PWA/browser/native shell is deployment decision per device; offline critical path must not depend on Cloud assets. |
| Object Storage | Bunny Storage | خلف ObjectStoragePort. |
| CDN | Bunny CDN | Public delivery. |
| Search V1 | PostgreSQL + pg_trgm/indexing | OpenSearch لاحقاً إذا برر الحجم/الاحتياج. |
| Analytics V1 | PostgreSQL Reporting Read Models | ClickHouse/warehouse لاحقاً عند الحاجة. |
| AI | Provider-agnostic AI Gateway | Adapters متعددة + routing/cost metering. |
| Observability | OpenTelemetry + metrics/logs/traces | Backend provider قابل للاستبدال. |
| Error tracking | Sentry أو equivalent | Managed optional. |
| Containers | Docker | API/worker containers. |
| Cloud mature stage | AWS ECS/Fargate candidate after M-1 residency/compliance decision | Provider/region is not locked before KSA PDPL/data-transfer and operational requirements are signed off. |
| IaC | OpenTofu/Terraform-style | Infra versioned and reproducible. |
| CI/CD | GitHub Actions | Architecture/test/security gates. |
| Edge/Cloud Files | Bunny + independent backup provider | عدم وضع primary+backup الحرجة في provider واحد. |
| Owner/Employee Mobile | Capability-based decision in M-1 | Responsive web/PWA may satisfy owner; employee background geofence/push/device needs may require native/React Native or managed shell. |
| Edge Security | SQLite + encryption/key strategy + local auth | Prototype local TLS/LAN access; no unencrypted sensitive local store by accident. |
| Device Gateway | Edge adapters/bridge | Printer/drawer/scale/barcode/customer display isolated from Domain. |
| KSA Fiscalization | Dedicated Fiscalization module + ZATCA adapter | Billing owns invoice; Fiscalization owns compliance chain/state/credentials and report/clear workflow. |
| Edge Fleet | Edge/Fleet Management module + signed artifacts | Minimum update/rollback/key rotation/replacement in M1; fleet orchestration/staged rollout maturity in M4. |

| Version note<br>أرقام الإصدارات في هذا الجدول snapshot بتاريخ 21 سبتمبر 2026 ويجب إعادة التحقق من أحدث patch/security release عند بدء التنفيذ أو الترقية. |
| --- |

<a id="section-22"></a>

## 22. التخزين باستخدام Bunny والتكلفة

- Bunny Storage + CDN اختيار مبدئي للصور العامة وملفات التطبيق غير المقيدة، خلف ObjectStoragePort. Customer/employee/personal/sensitive documents لا تُوضع عليه تلقائياً قبل Data Classification + residency/PDPL/provider review في M-1.

- الكود لا يستدعي Bunny داخل Domains؛ Files module يعتمد ObjectStoragePort وBunnyStorageAdapter.

- DB تخزن fileId/objectKey/mime/size/checksum/owner لا URL فقط؛ URL يمكن توليده أو تغييره.

- File upload pipeline: tenant ownership، MIME/extension/size validation، generated name، malware strategy عند الحاجة.

- Backups الحرجة لقاعدة البيانات تحفظ offsite لدى مزود مستقل لتقليل correlated provider risk.

- Bunny S3-compatible API كانت Public Preview أثناء التخطيط؛ Production يعتمد الواجهة المستقرة أو يختبر الـcompatibility جيداً.

منظور التكلفة: معظم تقنيات الـSoftware نفسها مفتوحة/مجانية، لكن compute/storage/managed services/API usage هي التي تكلف. Bunny عادة أقل في storage من S3 Standard، لكن يجب احتساب CDN bandwidth، redundancy، region choice، وعمليات النسخ الاحتياطي ضمن TCO.

- KSA data governance: Region/provider choice للـprimary data، backups، Identity، SMS، analytics وAI لا يُغلق نهائياً قبل تصنيف البيانات ومراجعة نقل البيانات خارج المملكة والضمانات المطلوبة. الهدف compliance-by-design وليس افتراض "كل شيء داخل السعودية" أو "كل شيء مسموح خارجها".

<a id="section-23"></a>

## 23. استراتيجية النشر السحابي وإدارة البنية (ECS / IaC)

### 23.1 ECS/Fargate

ECS هو orchestrator لحاويات Docker: يضمن desired count، health/restart، deployment، scaling. Fargate هو compute managed لتشغيل الـcontainers دون إدارة VM/OS مباشرة.

### 23.2 Infrastructure as Code (IaC)

IaC تعني أن الشبكات، قواعد البيانات، Redis، containers، storage، secrets، monitoring وغيرها توصف في ملفات version-controlled يمكن مراجعتها وإعادة إنشاء البيئة منها. OpenTofu هو الاختيار المبدئي.

### 23.3 استراتيجية تكلفة تدريجية

| المرحلة | البنية المقترحة | متى ننتقل |
| --- | --- | --- |
| Cheap Launch | Cloudflare + 1-2 VPS قوية + Docker + PostgreSQL/Redis + Bunny + external backups | أول عملاء/حمل محدود مع Monitoring/Backups قويين. |
| Growing SaaS | Multiple app nodes، managed DB أو HA DB، managed/dedicated Redis، better load balancing/observability | عندما يصبح downtime/ops burden/capacity أعلى من فائدة VPS. |
| Enterprise Scale | ECS/Fargate أو equivalent، RDS/managed data، autoscaling، dedicated analytics، stronger DR، service extraction عند الحاجة | عند scale/SLAs/compliance/team size التي تبرر التكلفة والتعقيد. |

الفكرة الأساسية: Architecture لا تتغير عند الانتقال من VPS إلى managed cloud؛ Deployments تتغير لأن Domain/Ports/Data Ownership منفصلة عن infrastructure.

<a id="section-24"></a>

## 24. Repository Blueprint

```text
rifad/
```

```text
+-- apps/
```

```text
|  +-- api/                # Cloud API: admin/global/public/external intake; no branch Check direct-write
```

```text
|  +-- worker/             # Cloud outbox/BullMQ/jobs/accounting/integrations/reporting
```

```text
|  +-- edge/               # Branch operational authority + local API/realtime/sync/device gateway
```

```text
|  +-- admin-web/
```

```text
|  +-- pos/
```

```text
|  +-- waiter/
```

```text
|  +-- kds/
```

```text
|  +-- kiosk/
```

```text
|  +-- employee-mobile/    # only if client capability decision requires it
```

```text
+-- libs/
```

```text
|  +-- platform/{identity,organizations,authorization,entitlements,approvals,audit,notifications,tasks,files,edge-management}
```

```text
|  +-- commerce/{catalog,pricing,promotions,customers}
```

```text
|  +-- restaurant/{ordering,pos,floor,kitchen,recipes,consumption-orchestrator,costing,delivery,catering}
```

```text
|  +-- business/{inventory,procurement,workforce}
```

```text
|  +-- finance/{payments,billing,accounting,reconciliation,expenses,payables,assets}
```

```text
|  +-- compliance/ksa/fiscalization/
```

```text
|  +-- integrations/{delivery-platforms,payments,messaging,suppliers}
```

```text
|  +-- analytics/
```

```text
|  +-- intelligence/
```

```text
|  +-- automation/
```

```text
|  +-- shared/{kernel,database,events,sync,observability,testing}
```

```text
+-- infra/
```

```text
+-- docs/{architecture,adr,event-catalog,api,compliance,authority-matrix}
```

### 24.1 Runtime Profiles داخل نفس Bounded Context

- Domain/Application contracts تبقى مشتركة حيث القواعد واحدة؛ infrastructure/runtime profile يختلف حسب authority.

- Ordering Edge profile: SQLiteCheckRepository + Edge Operational API + Local Outbox. Cloud profile: synced projection/query/admin contracts؛ لا PostgresCheckWriter لنفس branch Check.

- Inventory Edge profile: branch warehouse movements/policy. Cloud profile: central warehouse (إن وجد) + projections/analytics/admin; branch mutations تصل كcommands.

- Payments/Billing/Fiscalization Edge profile: tender/allocation + Sale Finalization + local fiscal agent للoffline-safe flow. Cloud profile: provider operations/reporting/reconciliation/central copies.

- Realtime: Edge Socket.IO/WebSocket للـPOS/Waiter/KDS؛ Cloud realtime للadmin/remote monitoring.

### 24.2 شكل Module

```text
ordering/
```

```text
+-- domain/{aggregates,entities,value-objects,events,repositories,errors}
```

```text
+-- application/{commands,queries,ports}
```

```text
+-- infrastructure/
```

```text
|  +-- edge/{sqlite,local-events,sync-adapters}
```

```text
|  +-- cloud/{postgres-projections,admin-query-adapters}
```

```text
+-- api/{edge-controllers,cloud-query-controllers,dto,presenters}
```

```text
+-- index.ts (public surface only)
```

- apps/* هي Composition Roots؛ لا Business Logic.

- Controller لا يصل DB مباشرة. Domain لا يستورد NestJS/Kysely/SQLite/Redis/BullMQ/Bunny/AWS.

- Cross-context communication عبر contracts/commands/events؛ restaurant consumption-orchestrator فقط هو الذي يترجم Recipe إلى generic Inventory command.

- Nx tags تميز scope + layer + runtime capability (edge/cloud/shared-contract). Import rules تمنع business/shared contexts من الاعتماد على restaurant-specific internals.

- Country compliance تحت compliance/&lt;country&gt;/...؛ Edge/Fleet Management يملك lifecycle/runtime management لا business aggregates.

<a id="section-25"></a>

## 25. Engineering Standards &amp; Conventions

| المعيار | القرار |
| --- | --- |
| IDs | Globally unique (UUIDv7-like strategy)، offline-safe؛ AUTO_INCREMENT ليس business identity. |
| Time | UTC/TIMESTAMPTZ داخلياً + organization/branch timezone للعرض والتقارير. |
| Timestamps | occurredAt منفصل عن createdAt/syncedAt. |
| Money | Money VO + exact decimal representation؛ لا float للحسابات المالية. |
| Tenant Scope | كل business resource داخل tenant boundary؛ branch scope عند الحاجة. |
| DB naming | snake_case؛ TypeScript camelCase. |
| DB Ownership | Module يملك tables؛ cross-module mutation ممنوع. |
| API | /api/v1؛ stable error codes + requestId؛ لا stack/SQL leakage. |
| Pagination | Cursor-based للقوائم الكبيرة؛ contract موحد. |
| Commands/Queries | Command changes state، Query reads؛ بدون CQRS overengineering. |
| Transactions | One aggregate ~ one transaction قدر الإمكان. |
| Events | Past tense، versioned envelope، correlation/causation + aggregateVersion/aggregateSequence؛ ordering requirement declared per consumer (NONE/PER_AGGREGATE/PER_BRANCH). |
| Idempotency | Mandatory for payments/refunds/webhooks/offline/consumers. |
| Outbox | Business change + outbox insert في transaction واحدة. |
| Audit | Business/security immutable-ish trail، منفصل عن logs/outbox. |
| Delete | لا soft-delete شامل؛ policy حسب domain. Financial posted data لا يحذف. |
| Inventory | لا stock mutation بدون append-only StockMovement. Restaurant consumption is orchestrated by restaurant layer at RoundSubmitted -&gt; ConsumeStock command. Availability is policy-driven: ALLOW_NEGATIVE_WITH_ALERT / BLOCK_ON_EDGE_KNOWN_STOCK / optional best-effort reservation; no global reservation assumption. |
| Providers | كل external provider خلف Port/Adapter. |
| Secrets | لا secrets في git/log/frontend؛ managed secret store. |
| Config | Validate at startup; fail fast. |
| Migrations | لا تعديل migrations deployed؛ expand/backfill/switch/contract للتغييرات الكبرى. |
| Feature flags | Deploy  !=  Release؛ rollout تدريجي عند الحاجة. |
| Logging | Structured + correlation/request/org/branch/user/device/resource/errorCode؛ no secrets. |
| Testing | Domain rule unit test؛ repository integration test؛ critical flow E2E؛ architecture checks. |
| Open Check model | Dine-in supports open tab + multiple immutable-ish kitchen submissions/rounds; no one-time confirm assumption. |
| Pricing | Pricing context resolves effective price; transaction stores immutable sale-time snapshot. |
| Costing data | Capture deterministic cost snapshot + recipe version where required for profitability/intelligence; Accounting remains official financial truth. |
| Reason codes | Void/Comp/Refund/Waste/Rework/Staff Meal use controlled codes + optional note + actor/audit. |
| UOM/Lot/Expiry | UOM/conversions first-class; lot/expiry tracking policy modeled from V1 even if advanced UI later. |
| Personal data | Classify PII/sensitive/financial/public; minimize/redact before AI/external processing; provider/region policy enforced. |
| Fiscalization | Invoice business data and KSA fiscal compliance state separated; sequence/hash/counter/signing credentials are controlled and auditable. |
| Edge local security | Sensitive local data encrypted according to threat model; device identity/key rotation/update strategy defined. |
| Edge authority | Branch operational writes are Edge-first from first domain slice: Open Check/Round/Kitchen/POS cash/branch stock/tender/Billing finalization never use normal Cloud direct-write path. Cloud receives sync and sends explicit branch commands/projections. |
| RLS | Tenant-owned PostgreSQL tables use RLS where applicable as defense-in-depth; runtime role has no BYPASSRLS/table-owner privilege; tests prove cross-tenant deny. |
| Event ordering | Every aggregate event carries aggregateVersion/sequence. Consumers detect duplicates/gaps/out-of-order according to declared ordering scope; no global queue ordering assumption. |
| PCI boundary | RIFAD avoids raw PAN/CVV/track/PIN. Prefer separate terminal/redirect/hosted/tokenized provider flows; store tender/reference/token metadata only as allowed. |
| Edge lifecycle | Signed updates، rollback، key/certificate rotation، device replacement and health/version reporting are minimum operational requirements, not M4-only. |
| Runtime upgrade | Node 24 LTS is V1 baseline. Node 26 is reconsidered after LTS status + dependency/edge/load compatibility tests; no upgrade for novelty alone. |
| Sale finalization | OPEN-&gt;CLOSING-&gt;CLOSED requires durable local tender allocation + Billing document + required fiscal signing/state. Cloud accounting posting can be eventual after sync; B2B/clearance flows may be online-required. |
| Branch projection | Versioned last-known-valid operational package: Catalog/Pricing/Promotions/Recipes/UOM/policies/cost/tax/service/rounding/employee/PIN/floor/fiscal/device config. Atomic projection updates; no live Cloud dependency for local critical path. |
| RLS migration rule | Every tenant-owned Postgres migration includes RLS policy/role test from creation or documented exception; full RLS audit later is verification, not delayed adoption. |

<a id="section-26"></a>

## 26. Security Baseline

- TLS in transit، encryption at rest where provided/appropriate، secrets manager/KMS، least privilege IAM.

- Tenant isolation defense-in-depth: request context -&gt; authorization -&gt; repository scoping -&gt; PostgreSQL RLS على tenant-owned tables المناسبة؛ runtime app role لا يملك BYPASSRLS.

- MFA/step-up auth للعمليات الحساسة والسياسات الإدارية.

- Rate limits على public/login/integration APIs مع provider-specific throttling.

- Webhook signing/replay protection، API scopes، credential rotation.

- Audit للrefunds، cancellations، cash drawer، approvals، price/permission changes، support access.

- File upload validation وعدم الثقة في filename/MIME المرسل من العميل وحده.

- Dependency/container/security scanning ضمن CI.

- Backups encrypted/offsite + restore testing + retention policy.

- Logs لا تحتوي passwords/tokens/secrets/full card data أو بيانات حساسة غير لازمة.

### 26.1 PCI / Card-data Boundary

- RIFAD لا يخزن CVV أو PIN أو magnetic-stripe/track data، ولا يستهدف لمس raw PAN أصلاً قدر الإمكان.

- Separate bank terminal: النظام يسجل tender=card + amount + external/reference metadata؛ بيانات البطاقة نفسها لا تدخل RIFAD.

- Online card flow يفضّل redirect/hosted fields/tokenized/integrated-terminal عبر PCI-compliant provider؛ التكامل النهائي يحدد SAQ/PCI scope ولا نفترض أن outsourcing يلغي كل مسؤوليات PCI.

- Payment tokens/references تعامل كبيانات حساسة حسب provider policy؛ logs/audit لا تسجل cardholder data غير اللازمة.

- M-1 يثبت payment acceptance matrix لكل pilot device/provider ويحدد ما هو online/offline-safe.

<a id="section-27"></a>

## 27. Testing Strategy

| نوع الاختبار | الهدف | أمثلة |
| --- | --- | --- |
| Domain Unit | Business invariants بدون infra | Open Check cannot close with invalid settlement؛ submitted round cannot be silently rewritten؛ refund&lt;=captured؛ journal balances؛ UOM/conversion rules. |
| Integration | DB/Redis/transactions/locks/outbox | Repository save/load، rollback، tenant isolation، outbox atomicity، duplicate inbox/event handling، inventory concurrency where policy requires it. |
| Contract | Module/provider contracts | Event schema version، adapter payload mapping، public API contract. |
| E2E | Critical business journeys | Login -&gt; Open Check -&gt; Add Items -&gt; Submit Round -&gt; Outbox -&gt; Consumer؛ لاحقاً Settlement/Pay -&gt; Fiscalization -&gt; Kitchen/Inventory -&gt; Accounting. |
| Architecture Tests | منع boundary violations | Domain importing NestJS، ordering importing inventory persistence، controller accessing DB. |
| Resilience Tests | Failure behavior | Redis restart، worker crash، duplicate webhook، provider timeout، offline sync retry. |

Integration tests تستخدم PostgreSQL/Redis حقيقيين عبر containers/Testcontainers قدر الإمكان بدلاً من mocks التي لا تكشف SQL/locking/concurrency issues.

<a id="section-28"></a>

## 28. ADRs - Architecture Decision Records

ADR-001 Use Modular Monolith for RIFAD V1

ADR-002 Strict Module Data Ownership

ADR-003 PostgreSQL as primary OLTP database

ADR-004 Transactional Outbox for durable events

ADR-005 No Kafka in V1

ADR-006 Branch Edge Runtime + SQLite WAL

ADR-007 Shared DB Multi-tenancy with strict scoping

ADR-008 TypeScript/Node/Nest/Fastify stack

ADR-009 Kysely explicit persistence mapping

ADR-010 BullMQ for V1 background jobs

ADR-011 Bunny Storage/CDN via ObjectStoragePort

ADR-012 Independent provider for critical backups

ADR-013 Analytics downstream from operational truth

ADR-014 AI not source of truth; tool-based orchestration

ADR-015 Nx enforced module boundaries

ADR-016 UTC + business timezone + occurredAt model

ADR-017 UUID/offline-safe identities

ADR-018 VPS-first allowed; managed cloud when justified

ADR-019 KSA-first baseline for SYS1 launch

ADR-020 Fiscalization as first-class context; ZATCA adapter is only external transport

ADR-021 Open Check + multiple Order Rounds/Submissions for dine-in

ADR-022 Minimum Branch Edge included in M1 exit criteria

ADR-023 Personal-data classification / PDPL cross-border governance before provider-region lock

ADR-024 Client platform strategy by capability (Web/PWA/Native/Managed shell)

ADR-025 Intelligence Data Contract starts in M1 even when AI ships later

ADR-026 Pricing and Promotions separated from Catalog ownership

ADR-027 Costing &amp; Profitability context separated from Inventory/Accounting truth

ADR-028 Inventory UOM/Lot/Expiry foundation modeled before pilot data growth

كل ADR يحتوي Context، Decision، Alternatives، Consequences، Status، Date، Owner. لا نحتاج مستنداً طويلاً لكل قرار؛ المهم أن نعرف لماذا اتخذناه وكيف نراجعه.

ADR-029 Branch operational authority is Edge-first; no normal Cloud/Edge dual writer

ADR-030 Inventory availability is policy-driven; ingredient consumption defaults to RoundSubmitted append-only movement; negative stock may be allowed with alert per policy

ADR-031 Finance contexts exist from M1; M2 increases maturity instead of migrating ownership

ADR-032 PostgreSQL RLS is tenant-isolation defense-in-depth for applicable tenant-owned tables

ADR-033 Domain events carry per-aggregate version/sequence; ordering is explicit per consumer, not global

ADR-034 PCI boundary minimizes card data; prefer separate terminal/redirect/hosted/tokenized provider flows

ADR-035 Minimum Edge lifecycle management (signed update/rollback/key rotation/replacement) ships with M1 baseline

ADR-036 Node.js 24 LTS is V1 runtime baseline; Node 26 upgrade only after LTS + compatibility validation

ADR-037 Branch-owned Open Check/Round state is Edge/SQLite authority from first domain slice; Cloud stores synced projection/canonical central copy, not competing writer.

ADR-038 Branch Operational Projection is versioned/atomic and includes all data required to sell without live Cloud dependency.

ADR-039 Sale Finalization is synchronous within Edge local authority for offline-safe branch sale: tender allocation + Billing document + required fiscal state before Check CLOSED.

ADR-040 Restaurant Consumption Orchestrator translates Recipe/Modifier composition into generic Inventory commands; Inventory never depends on restaurant-specific Recipe model.

ADR-041 Local Edge Event Dispatcher is distinct from Cloud BullMQ; durable event plane is explicit (EDGE/CLOUD/EDGE_TO_CLOUD/CLOUD_TO_EDGE).

ADR-042 POS/Cash owns drawer/count difference; Reconciliation owns provider/acquirer/bank matching; Payments owns tender/allocation.

ADR-043 Tenant PostgreSQL migrations are RLS-by-default from table creation; later RLS task is a verification gate, not delayed enablement.

<a id="section-29"></a>

## 29. M-1 - Requirements &amp; Compliance Closure

M-1 ليست مرحلة Coding للـDomain؛ هي Gate تمنع تثبيت Core على افتراضات غير محسومة. في المقابل يمكن تشغيل M0 Foundation Track (تقريباً M0-001..024: monorepo/DB/CI/observability/outbox primitives) بالتوازي. Domain/Edge/Finance implementation الذي يعتمد على القرار لا يبدأ قبل إغلاقه أو تسجيل TBD غير blocker بOwner/Deadline.

### 29.1 SYS1 -&gt; V1 Cut List / Traceability

| Requirement / Gap | Priority | Owner | Milestone / Acceptance |
| --- | --- | --- | --- |
| Open Check + multiple rounds | MUST | Ordering | قبل M0 domain implementation؛ قبول: إضافة جولة جديدة لطاولة بعد إرسال جولة سابقة دون محو التاريخ. |
| Offline POS/KDS/Tables/Cash on LAN | MUST | Edge/POS/Kitchen | M1 exit؛ تشغيل/طباعة/مطبخ محلي ثم sync بلا فقد/تكرار. |
| ZATCA fiscalization for KSA pilot | MUST | Billing + Fiscalization | قبل أول pilot مدفوع؛ B2C reporting/B2B clearance paths واختبارات sandbox/production onboarding. |
| Pricing effective-dated by branch/channel | MUST | Pricing | M1؛ sale-time price snapshot محفوظ. |
| Modifier impact on recipe/cost | MUST | Recipes + Costing | M1؛ modifier يغير consumption/cost عند تعريفه كذلك. |
| UOM &amp; conversion model | MUST | Inventory/Recipes | M1 data model؛ اختبارات conversion/rounding. |
| Void/Comp/Waste/Staff meal reasons | MUST | Ordering/POS/Inventory | M1؛ structured reason + actor + audit. |
| Cost snapshot + recipe version at sale | MUST | Costing | M1؛ يسمح بإعادة بناء profitability تاريخياً. |
| Customer identity + consent owner | MUST foundation | Customers | M1 foundation؛ الطلب المجهول يظل ممكناً. |
| Expenses / Payables | SHOULD | Finance Ops | M2-M3 حسب pilot scope؛ owner/data contracts محددة من الآن. |
| Assets/depreciation | LATER/SHOULD | Assets/Accounting | بعد finance core إلا إذا pilot يتطلبه. |
| Budgets / cash-flow forecast | LATER | Accounting/Analytics | بعد ledger/periods/statements/data history. |
| Multi-currency | LATER | Finance | ليس KSA single-currency pilot requirement؛ model لا يمنعه. |
| Loyalty | LATER unless pilot | Customers/Promotions | لا يخلط مع Customer core. |
| Coupons/Combos/Promotions | SHOULD | Promotions | بعد pricing core أو ضمن M1.5 حسب commercial launch. |
| Internal Delivery/Dispatch | SHOULD | Delivery | حسب pilot channels؛ external platforms via Integrations. |
| Catering | LATER / decision | Catering candidate | M-1 يقرر standalone context vs ordering extension. |
| Tasks | SHOULD | Tasks | M3؛ alert/complaint/maintenance -&gt; actionable task. |
| Owner native mobile | DECIDE | Client Strategy | Responsive web/PWA first unless acceptance requires native. |
| Employee geofence mobile | DECIDE early | Workforce/Client | Background geofence/push/device requirements may force native/managed app. |
| Tips / service charge / cash rounding | DECIDE before pilot | Pricing/Billing/POS | Policy/configuration per launch customer/tax/accounting rules. |
| Edge-first branch authority / no dual writer | MUST architecture | Edge/Ordering | M-1/M0؛ authority matrix + cloud-to-edge command contract + offline acceptance. |
| PostgreSQL RLS tenant defense | MUST foundation | Platform/Data | M0؛ cross-tenant DB tests fail even when repository filter is intentionally omitted in test harness. |
| Per-aggregate event ordering | MUST foundation | Shared Events | M0؛ aggregateVersion/sequence + duplicate/gap/out-of-order tests. |
| PCI/card-data boundary | MUST before card pilot | Payments/Security | M-1/M0؛ no raw card data in RIFAD baseline; payment integration class documented. |
| Edge signed update / rollback / key rotation | MUST for M1 pilot | Edge/Fleet | M1B؛ failed update recovers to last-good; device replacement runbook tested. |
| Branch Operational Projection completeness | MUST architecture | Edge + owning contexts | M0/M1A؛ versioned projection includes catalog/pricing/promotions/recipes/UOM/policy/cost/tax/service/rounding/staff/PIN/floor/fiscal/device config. |
| Sale Finalization atomic local boundary | MUST for pilot | Payments + Billing + Fiscalization + Ordering | M1A؛ Check cannot CLOSED until offline-safe tender/invoice/fiscal local requirements persist; B2B online-clearance remains online-required. |
| Local realtime plane | MUST for restaurant pilot | Edge + Kitchen/POS | M1A؛ POS-&gt;KDS/Waiter realtime works via Edge while Cloud unavailable. |
| COGS posting + journal dimensions | MUST finance integrity | Accounting + Inventory/Costing | M1A/M1B؛ sales and stock source facts generate idempotent COGS/waste/adjustment postings with branch/channel/source dimensions. |

### 29.2 Non-Functional Requirements التي يجب تحويلها لأرقام

- Peak branches / organization، POS devices / branch، concurrent users، orders/minute وkitchen events/minute.

- Definition of realtime لكل flow: POS-&gt;KDS، dashboard، stock availability، webhook، analytics.

- Maximum offline duration، expected backlog، reconnect throughput، acceptable conflict/manual intervention rate.

- RPO/RTO لكل Tier: orders/payments/fiscalization مقابل analytics/AI.

- Latency targets p95/p99 للـcritical paths، report freshness، sync lag target.

- File/storage growth، invoice retention، audit retention، observability retention.

### 29.3 KSA Compliance Architecture

- ZATCA: Billing owns Invoice business document; Fiscalization owns EGS/CSID/ICV/PIH/compliance payload/status/signing chain; Integration adapter communicates with Fatoora.

- B2C Simplified invoice path must support compliant local generation/signing and reporting within the allowed regulatory window; outage/retry state is durable and monitored.

- B2B Standard invoice path must model clearance-before-valid-delivery where required; therefore some flows are online-required or require controlled exception handling per official specification.

- Credit/Debit notes retain reference to original invoice and go through fiscalization rules.

- PDPL: classify personal/sensitive data, minimize fields sent to processors/AI, record processor/region/purpose/legal basis/safeguards, and conduct transfer risk assessment where regulations require it.

- Provider decisions (Bunny, backups, Identity, SMS, AI, analytics) are conditioned on data category and region; public product media is not treated like employee/customer documents.

- هذا فصل Architecture/Engineering وليس استشارة قانونية/ضريبية؛ قبل production يجب validation من مختص سعودي واعتماد آخر specifications الرسمية.

### 29.4 Open Questions that M-1 must close

- First pilot profile: عدد الفروع/الأجهزة/القنوات وB2B vs B2C mix.

- Exact Check/Round terminology and state transitions for dine-in/takeaway/delivery.

- When inventory consumption happens and whether any item classes use hard reservation.

- Inventory valuation policy (weighted average/FIFO) and cost snapshot timing.

- Service charge/tips/cash rounding/tax inclusive vs exclusive pricing policies.

- Offline card terminal capabilities and manual card tender policy.

- EGS placement and signing ownership: POS device vs Branch Edge vs Cloud, validated against ZATCA design/spec and operational resilience.

- Primary/backup/storage/AI provider regions and personal-data transfer safeguards.

- Owner/employee/waiter client platforms and hardware list for first pilot.

### 29.5 M-1 Task-by-Task Gate

| ID | Task | Deliverable | Exit Criteria |
| --- | --- | --- | --- |
| M-1-001 | SYS1 baseline/version hygiene | Resolve source version mismatch; freeze requirement baseline and change log. | One signed baseline/version ID; changes tracked. |
| M-1-002 | Must/Should/Later cut | Classify every SYS1 capability. | No capability without priority + milestone/decision. |
| M-1-003 | Pilot profile | Branches/devices/channels/B2C-B2B/payment hardware. | Pilot assumptions documented and approved. |
| M-1-004 | NFR budget | Load/latency/realtime/offline/RPO/RTO/storage targets. | Measurable targets or owned TBDs with deadline. |
| M-1-005 | Open Check workshop | Check/Round/Split/Void/Comp/Close lifecycle. | State machine + acceptance scenarios approved. |
| M-1-006 | Pricing workshop | PriceList scopes/effective dates/service charge/rounding. | Pricing contract and precedence rules approved. |
| M-1-007 | Inventory policy foundation | UOM/lot/expiry + consumption at RoundSubmitted + negative/block/reserve policy + valuation. | ADR-030 + item/category defaults + exception behavior + costing handoff approved. |
| M-1-008 | Costing data contract | Recipe version/cost snapshots/profitability formula ownership. | Required historical fields defined before M1. |
| M-1-009 | Customer/privacy model | Customer identity/consent/anonymous order/data classes. | Customer owner + consent/data classification approved. |
| M-1-010 | ZATCA + Sale Finalization architecture | EGS/CSID/ICV/PIH + invoice/credit-note number ownership + B2C local issue/sign/report + B2B clearance + offline/Edge/cloud/accounting-posting responsibility. | Official-spec traceability + state/sequence diagrams + failure/replacement tests; no async Billing-after-close ambiguity. |
| M-1-011 | PDPL/provider review | Regions/processors/backups/Bunny/AI/Identity/SMS. | Data-flow register + cross-border decision record. |
| M-1-012 | Edge authority + projection + connectivity prototype | Complete authority matrix، Edge-resident runtime profile، Branch Operational Projection، local realtime، cloud-to-edge command path، local app serving، TLS/LNA/native shell، encryption/device gateway. | No-dual-writer approved؛ target client boots/operates Edge-first; projection list/versioning and external-order unreachable policy defined. |
| M-1-013 | Client platform strategy | Owner/employee/waiter/POS/KDS/kiosk capability matrix. | Web/PWA/native decision per client class. |
| M-1-014 | Intelligence data contract | Data needed by ten smart features. | M1-M3 capture fields mapped to owner/events. |
| M-1-015 | Context Map v0.2 sign-off | Add Pricing/Promotions/Costing/Customers/FinanceOps/Delivery/Tasks/Fiscalization. | Each context has owner + milestone + contracts. |
| M-1-016 | Finance Minimum boundary | Define M1 owner/capability floor for Payments/Billing/Accounting/Fiscalization incl tender/allocation/invoice/credit note/COGS dimensions; M2 maturity scope. | No temporary POS-owned tender/invoice/journal model; M1A/M2 contracts approved. |
| M-1-017 | Payment acceptance / PCI model | Separate terminal vs provider redirect/hosted/tokenized/integrated device; card-data flow and offline policy. | ADR-034 + provider/device matrix + data retention/logging boundary approved. |
| M-1-018 | Delivery capacity &amp; pilot calendar | Team size/roles/parallel tracks/full M0 not just foundation/hardware/compliance dependencies and target pilot window. | Planning range approved; critical path and owners/deadlines visible; not treated as contractual promise. |
| M-1-019 | Architecture authority propagation audit | Check every diagram/task/event/ownership/milestone/runtime profile against Edge-first single-writer decision before domain coding. | No Cloud-first Check/Invoice/branch-stock write path remains; exceptions are explicit online-required flows. |

<a id="section-30"></a>

## 30. خارطة التنفيذ M-1-M5

| M-1 - Requirements &amp; Compliance Closure | إغلاق الافتراضات قبل الكود | SYS1 cut list، NFRs، KSA/ZATCA/PDPL، Open Check، pricing/inventory/costing decisions، Edge prototype، client/data strategy. |
| --- | --- | --- |
| Milestone | الهدف | الناتج |
| M0 - Architecture Foundation | إثبات foundation end-to-end بالتوازي مع M-1 حيث لا توجد dependency | Tenant/auth/RLS-by-default/boundaries + Edge/SQLite Open Check skeleton + local outbox/dispatcher + Edge-&gt;Cloud Inbox/Postgres projection + Cloud-owned outbox/worker + event sequence + authority/projection/Fiscalization/PCI contracts. |
| M1A - Sale-to-Invoice Core | إثبات مسار بيع KSA في connected mode عبر Edge-first runtime | Catalog/Pricing/Open Check/Rounds/Kitchen/local realtime/PIN + Payments minimum + Invoice/Credit Note + local Sale Finalization/Fiscalization + Cloud Accounting posting/COGS contract + basic operational read models. |
| M1B - Operational Edge / Inventory / Costing | جعل نفس المسار قابلاً للـpilot داخل مطعم فعلي | Disconnect/reconnect hardening، local assets، full Branch Projection، sync، Recipes/Consumption Orchestrator/Inventory policy/UOM/Lot/Expiry foundation، Costing snapshots، hardware bridge، signed updates/rollback/key rotation، shift/day reporting. |
| M2 - Finance Maturity | توسيع Finance بعد M1 minimum | Reconciliation/settlements، advanced payments/refunds، AR/AP/Expenses/Assets، periods/close/statements؛ no ownership migration. |
| M3 - Business Operations | إدارة التشغيل الإداري | Procurement، Suppliers، Workforce، Inventory maturity (lot/expiry/counts/transfers)، Delivery/Tasks، Assets حسب scope، Branch management. |
| M4 - Advanced Edge &amp; Sync | توسيع resilience بعد وجود Minimum Edge في M1 | Fleet-scale rollout/remediation، advanced conflict tooling، long-offline stress، projection/fleet observability، broader offline policies. Local outbox/inbox/projections/update rollback already exist from M0/M1. |
| M5 - Intelligence &amp; Ecosystem | القيمة المتقدمة | Integrations، reporting/analytics mature، AI assistant، forecasting/anomalies، automation، public API. |

| ملاحظة ترتيب<br>Offline architecture تؤثر على IDs/events من M0. Minimum Edge القابل للتشغيل على LAN هو جزء من M1 Exit Criteria، بينما M4 مخصص لنضج الـEdge المتقدم: fleet provisioning، conflict tooling، long-offline stress، controlled updates/rollback وadvanced observability. |
| --- |

<a id="section-31"></a>

## 31. M0 - Task-by-Task Implementation Plan

Definition of M0 success: Foundation Track can run with M-1 where independent. Before M0 closes, RLS-by-default and tenant isolation are proven; branch-owned Open Check/Items/Rounds are created through Edge API and persisted in SQLite with local outbox atomically; Local Event Dispatcher consumes CheckRoundSubmitted idempotently; Edge Sync sends operation to Cloud Inbox and Postgres cloud projection without creating a competing writer. Separately, a Cloud-owned aggregate/config change proves Postgres + Cloud Outbox + Worker. Pricing/Costing/Customers/Fiscalization/PCI/Branch Projection contracts exist؛ correlationId is visible across Edge-&gt;Cloud. M0 is architecture proof, not a full restaurant product.

| ID | Task | المتطلبات | Acceptance Criteria |
| --- | --- | --- | --- |
| M0-001 | تهيئة Nx + pnpm monorepo | apps/libs base، TypeScript config، lint/test/build pipeline | Workspace builds cleanly; dependency graph available; CI basic passes. |
| M0-002 | إنشاء apps/api وapps/worker وapps/edge skeletons | Nest/Fastify API، worker process، edge placeholder | Each app boots independently with health endpoint/logging. |
| M0-003 | Architecture tagging &amp; module-boundary rules | scope/type tags، Nx lint rules | Forbidden cross-layer imports fail CI. |
| M0-004 | Shared kernel primitives | EntityId، Money، Clock، DomainEvent، DomainError، Result | Pure TypeScript; zero Nest/Kysely imports; unit tested. |
| M0-005 | RequestContext &amp; correlation IDs | requestId/correlationId/user/session/device/org/branch/timezone | Context propagates API -&gt; application -&gt; logs -&gt; worker event. |
| M0-006 | Configuration system | env schema validation/fail-fast/secrets refs | App refuses startup on invalid required config; no secrets logged. |
| M0-007 | PostgreSQL local/dev foundation | Docker compose/testcontainer setup، schemas، connection pool | Health/readiness checks DB; migrations run repeatably. |
| M0-008 | Kysely database layer | typed DB interfaces، transaction wrapper | No DB types leak into domain; integration smoke test passes. |
| M0-009 | Migration + RLS-by-default standards | Immutable deployed migrations، per-module ownership، tenant-table RLS policy template/role strategy from table creation. | Fresh DB builds in CI; every tenant-owned baseline table has RLS policy/test or documented exception. |
| M0-010 | Organization aggregate/table | organization identity/status/timezone/settings minimal + RLS from first migration | Organization create/read tests pass; missing tenant context denied where policy applies. |
| M0-011 | Branch model | branch ownership/timezone override/status + RLS | Branch always belongs to one organization; cross-tenant DB tests deny. |
| M0-012 | Membership model | user &lt;-&gt; organization membership/status | A user can belong to multiple orgs conceptually; inactive denied. |
| M0-013 | Identity provider integration abstraction | OIDC/session validation adapter boundary | Business authorization not tied to provider-specific SDK. |
| M0-014 | Authorization base | Permission/Role/RoleAssignment/BranchScope | checks.create/read/submit_round can be evaluated. |
| M0-015 | Entitlement base | feature/module access at organization level | Permission cannot bypass disabled entitlement. |
| M0-016 | Security pipeline guards | auth -&gt; org -&gt; membership -&gt; entitlement -&gt; permission -&gt; scope | Cross-tenant and cross-branch tests return deny. |
| M0-017 | Audit foundation | append-oriented audit contract/storage | Sensitive test action records actor/context/action/resource. |
| M0-018 | UnitOfWork/transaction abstraction | transaction lifecycle usable by repositories/outbox | Rollback proves no partial write. |
| M0-019 | Durable event envelopes + Outbox schemas | Cloud Postgres Outbox + Edge SQLite Local Outbox share event metadata/idempotency/sequence contracts. | Cloud-owned business data+Postgres outbox atomicity and Edge-owned SQLite state+local outbox atomicity both tested. |
| M0-020 | Redis Queue infrastructure | dedicated queue config، BullMQ connection | Queue Redis separate from cache config; noeviction policy documented. |
| M0-021 | Cloud Outbox relay worker | Claim/publish/retry Postgres Cloud Outbox -&gt; BullMQ safely. | Cloud worker crash/restart does not lose pending Cloud event; Edge local events are not routed through this relay. |
| M0-022 | Cloud Inbox / sync idempotency base | processed operation/event tracking + Edge-&gt;Cloud operation inbox + idempotency key + branch/source sequence. | Same Edge operation delivered twice has one Cloud effect/projection; sequence gaps observable. |
| M0-023 | Structured logging | JSON logs + context fields + redaction | No secrets; correlation search shows full request path. |
| M0-024 | OpenTelemetry baseline | trace/context propagation API -&gt; DB -&gt; worker where applicable | Trace emitted in dev/observability backend. |
| M0-025 | Ordering module skeleton | domain/application/infrastructure/api separation | Architecture rules pass. |
| M0-026 | Money + pricing snapshot + PricingPort | Exact decimal/currency + effective price contract + sale-time snapshot | Historical line price cannot change when PriceList changes. |
| M0-027 | Open Check Aggregate | OPEN/CLOSING/CLOSED، items، rounds/submissions، source/org/branch/table? | Unit tests: open/add/send round/add later round/begin closing/cancel; Check CLOSED only through finalization contract. |
| M0-028 | Edge Check Repository | SQLite mapping + transaction adapter; branch-owned Check/Round state lives on Edge. | Save/load preserves Check/submissions offline; local tenant/branch scope enforced; no Postgres direct writer. |
| M0-029 | Edge OpenCheck operational API | POST /api/v1/checks contract served by Edge runtime for branch clients; cloud admin API has no competing branch-write route. | Auth/local session/org/branch/permission enforced; same route works connected/disconnected against Edge. |
| M0-030 | Add/modify Check Item use case | Mutate only allowed unsubmitted/current items; keep historical submission references | Adding round #2 after round #1 is supported. |
| M0-031 | SubmitRound on Edge + local outbox | POST /checks/:id/rounds or equivalent -&gt; SQLite state + CheckRoundSubmitted local outbox in one transaction. | Round and durable local event commit atomically with internet disconnected. |
| M0-032 | CheckRoundSubmitted event contract v1 | Versioned envelope + eventVersion + aggregateVersion/sequence + ordering requirement + registry/catalog | Carries event/org/branch/check/round/correlation/occurredAt/aggregateSequence; schema compatibility test passes. |
| M0-033 | Local Event Dispatcher + ordering guard | Idempotent local CheckRoundSubmitted consumer + aggregate sequence/gap guard; no BullMQ dependency. | SQLite outbox -&gt; local consumer demonstrated offline; duplicate harmless; gap/out-of-order observable. |
| M0-034 | API error standard | stable codes/messages/requestId mapping | Domain errors never leak stack/SQL; contract tests. |
| M0-035 | Health/readiness endpoints | liveness/readiness DB/queue-aware policy | Traffic-ready only when critical dependencies ready. |
| M0-036 | CI pipeline | lint/build/unit/integration/architecture/migration/security basics | PR blocked on any critical gate failure. |
| M0-037 | Testcontainers integration suite | Postgres/Redis ephemeral infra + SQLite edge integration harness | Cloud repository/outbox/inbox + Edge SQLite/outbox/dispatcher/idempotency tests run in CI. |
| M0-038 | Documentation/ADRs | ADRs 001-043 + module/event/authority/compliance catalog templates | New engineer can identify boundaries, runtime authority, tenant/RLS, local/cloud event planes, PCI and compliance decisions without tribal knowledge. |
| M0-039 | Basic admin seed/bootstrap | first org/branch/user/role bootstrap path | Dev/staging can create controlled initial tenant without DB hacking. |
| M0-040 | Pricing module/contract skeleton | PriceList/price resolution interfaces + precedence tests | Ordering cannot read Catalog price column directly; pricing contract callable. |
| M0-041 | Costing data contract skeleton | RecipeVersion/CostSnapshot structures + ownership | Sale-time data fields defined and versioned even before full costing engine. |
| M0-042 | Customers context skeleton | CustomerId/anonymous/consent reference contract | Check may remain anonymous; known customer has owned record/consent metadata; no Ordering-owned customer row. |
| M0-043 | Fiscalization boundary skeleton | Billing&lt;-&gt;Compliance/KSA/Fiscalization ports/events/status model for prepare/sign/report/clear + invoice/credit-note linkage; no provider SDK in Billing | Fiscal state isolated; contract tests prove document prepared/signed/reported/cleared/failed transitions and owner boundaries. |
| M0-044 | Edge-first vertical architecture prototype | Local assets + Edge API + SQLite Check repo + local outbox/dispatcher + Edge Sync -&gt; Cloud Inbox -&gt; Postgres projection + local realtime security approach. | POS test device boots and writes Check/Round through Edge with internet disconnected; reconnect creates one Cloud projection; Cloud direct-write route unavailable. |
| M0-045 | Data classification policy enforcement base | Public/internal/personal/sensitive/financial classes + outbound processor policy hooks | AI/storage/provider adapter can reject forbidden data/region combination in tests. |
| M0-046 | PostgreSQL RLS full verification gate | Audit all tenant-owned baseline tables + runtime/migration/service roles + pooling/transaction tenant context; policies already shipped with migrations. | Cross-tenant CRUD denied; missing-context default deny; app role no BYPASSRLS/table-owner; no table first receives RLS only at this step. |
| M0-047 | Event ordering guard | aggregateVersion/sequence + consumer ordering policy/gap detection | Duplicate/out-of-order/gap test suite passes; no global ordering assumption. |
| M0-048 | PCI boundary enforcement base | Tender/reference/token DTOs; raw PAN/CVV/track/PIN forbidden; log redaction tests | Separate-terminal/manual-card path stores no cardholder data; forbidden fields fail validation/tests. |
| M0-049 | Cloud-to-Edge command + Branch Projection contracts | External/public order -&gt; branch command -&gt; Edge ack + versioned operational projections for catalog/pricing/promotions/recipes/UOM/policy/cost/tax/staff/PIN/floor/fiscal config. | Cloud cannot create competing branch Check/stock write; unreachable Edge explicit; projection version/atomic replacement contract tested. |
| M0-050 | Edge lifecycle foundation | Edge identity/version manifest/signed update interface/rollback/key rotation/replacement state model | Non-production test proves signature verification + rollback path + replacement/runbook contract. |
| M0-051 | M0 resilience &amp; isolation drill | kill Edge during local event، reconnect duplicate sync، kill Cloud worker/restart Redis، out-of-order event، rollback DB، cross-tenant query، branch command while Edge unreachable | No Check/Round/local event loss; one Cloud projection; duplicates harmless; gaps visible; RLS denies leakage; pending/reject branch command visible; observability exposes issue. |

### 31.1 M0 Definition of Done

- PostgreSQL RLS integration tests تثبت default-deny/cross-tenant protection للـtenant-owned baseline.

- Event ordering tests تثبت duplicate/gap/out-of-order detection per aggregate.

- PCI boundary tests/log scans تثبت عدم دخول raw card data للمسار الأساسي.

- Edge-first authority contract يمنع Cloud direct mutation لنفس branch Check في test architecture.

- Architecture boundaries enforced automatically.

- Tenant isolation tests pass.

- Domain unit tests and repository/outbox integration tests pass.

- Round submission / Check state change + local outbox commit atomically in SQLite; Cloud projection happens through sync/inbox, not direct branch write.

- Duplicate consumer delivery is harmless.

- Edge process/reconnect and Cloud Worker/Redis restart do not lose durable local/cloud events; local events do not depend on BullMQ.

- Correlation/request/org/branch/check/round/event context visible in logs/traces.

- Fresh environment can be created from migrations/config/IaC/dev tooling without manual DB edits.

- ADRs and engineering standards are checked into repository.

- M-1 gate signed off (or remaining TBDs have owner/deadline and do not block M0 scope).

- Open Check + multi-round scenario proven; no one-time-confirm assumption remains in core API/domain.

- Pricing/Costing/Customer/Fiscalization boundaries exist as contracts with no cross-table shortcuts.

- Edge LAN prototype proves the chosen first-pilot client can boot and operate against local Edge without Cloud.

<a id="section-32"></a>

## 32. M1-M5 Epics and Deliverables

### 32.1 M1A - Sale-to-Invoice Core

- Catalog + Pricing: products/menu + effective-dated PriceLists by org/branch/channel; immutable sale-time price snapshot.

- Ordering: Open Check + multiple rounds/submissions، reason-coded void/comp، CLOSING/CLOSED lifecycle، basic split allocations without cloning check history.

- POS/Cash + Payments minimum: cashier session/drawer، cash/manual-card tenders، allocations، basic split payment/refund، idempotency؛ no raw card data.

- Floor basic: table/check association، move/merge link، occupancy؛ reservations can remain limited to pilot cut.

- Kitchen: ticket/items/stations/routing/states/acknowledgement/prep timestamps؛ RoundSubmitted is the immutable-ish operational boundary.

- Billing + Fiscalization: local Invoice/Credit Note + VAT + original-document linkage + synchronous Sale Finalization؛ B2C offline-safe issue/sign path، B2B/clearance online-required per approved KSA design.

- Accounting minimum: COA essentials + Cloud journals/ledger + deterministic sales/VAT/tender/refund-credit-note + COGS/consumption/waste/adjustment posting rules، source traceability، branch/channel/source-document dimensions.

- Customers + controlled reason codes: anonymous/known customer+consent; void/comp/refund reasons captured with actor/audit.

- M1A internal exit: Product -&gt; Price -&gt; Open Check -&gt; Round -&gt; Kitchen عبر Edge local realtime -&gt; Tender/Allocation -&gt; local Invoice/Credit Note -&gt; required Fiscalization -&gt; Check CLOSED -&gt; synced Cloud Accounting postings/read model works in connected mode. لا branch direct-write إلى Cloud.

- Cashier access: PIN/fast user switch/device+branch scope/manager override policy with audit.

- Local realtime: Edge WebSocket routes Round/Kitchen/Waiter/Customer-display updates; Cloud outage does not stop kitchen realtime.

- Finance minimum: COGS/consumption/waste/adjustment posting contracts + branch/channel/source-document dimensions from first ledger schema.

- Basic operational read models: today sales/checks/kitchen/shift summaries needed to operate pilot; advanced BI remains later.

### 32.2 M1B - Operational Edge / Inventory / Costing

- Recipes: components/UOM/yield/versioning + modifier recipe impact; RoundSubmitted provides consumption source reference.

- Inventory: append-only movements، warehouses، UOM conversions، waste/counts، lot/expiry foundation؛ ingredient consumption at RoundSubmitted; negative/block/reserve behavior follows policy.

- Costing: RecipeVersion + valuation inputs + deterministic cost snapshot captured at sale/round boundary for future profitability/intelligence.

- Minimum Edge-first hardening: POS/Waiter/KDS/Kiosk always use Edge API/assets in connected/disconnected states; M1B proves long-enough disconnect/reconnect, full operational projections and no Cloud/Edge dual writer.

- Cloud-to-Edge: external/public orders arrive Cloud then branch command queue -&gt; Edge acceptance/ack; unreachable behavior is explicit.

- Hardware/Edge lifecycle: device gateway + printer/drawer/scale path، local encryption/key strategy، signed update، rollback، key rotation، replacement.

- Sync/recovery: local outbox + Cloud inbox + sequence/idempotency + projection versions + sync lag observability; local realtime already served by Edge in M1A.

- M1 pilot exit: M1A + M1B both pass; complete sale-to-invoice flow remains usable for offline-safe paths and reconciles to Cloud without loss/duplication.

### 32.3 M2 - Finance Maturity &amp; Reconciliation

- Advanced payment/provider integrations، tokenized/terminal flows، failure/retry operations، chargebacks where applicable.

- Advanced split/refund/approval limits and exceptional payment workflows؛ M1 minimum remains same owner.

- Billing maturity: templates/AR/collections/document operations؛ Invoice/CreditNote ownership remains unchanged from M1.

- Accounting maturity: periods/close/reopen controls، cost centers، richer posting rules، official statements.

- Reconciliation: provider/acquirer/bank settlements، fees، mismatches and reconciliation runs. Cash drawer count/difference remains POS/Cash; Reconciliation may consume it as evidence but does not own it.

- Financial integrity: source document -&gt; journal -&gt; reversal/adjustment traceability + audit.

- Finance reports/statements and immutable posted-record/reversal policies.

- Expenses + AP/ageing integrated with Accounting and supplier invoices.

- Assets/depreciation if included in cut؛ otherwise context/owner remains defined.

- Budgets/cash-flow forecasting/multi-currency remain later unless contracted; M2 does not delay M1 ledger/posting correctness.

### 32.4 M3 - Business Operations

- Procurement full workflow: request -&gt; approval -&gt; quotes -&gt; PO -&gt; receipt -&gt; supplier invoice/return.

- Supplier profiles/performance/history/reorder suggestions.

- Workforce: employee، branch assignment، attendance/geofence، schedules، leave/overtime، productivity inputs.

- Inventory maturity: transfers/discrepancy، periodic counts، production orders، lot/expiry operations، reorder/low-stock rules، valuation policy maturity.

- Assets/maintenance base if included in launch scope.

- Branch dashboards/profitability dimensions/targets.

- Approvals/tasks/notifications generalized across business operations.

- Delivery/Dispatch حسب launch channels، وTasks/Work Management للalerts/complaints/maintenance.

- Workforce client decision implemented for attendance/geofence/push؛ payroll remains inputs/export/integration unless full engine is explicitly scoped.

### 32.5 M4 - Advanced Edge &amp; Sync Maturity

- Edge fleet maturity beyond M1 minimum: staged/canary rollout across many branches، fleet inventory، release rings، remote remediation and compliance visibility.

- Expand SQLite projections/policies for additional offline-safe domains after M1 baseline.

- Harden LAN discovery/auth/device registration/certificate/key rotation across fleet.

- Scale existing local command/outbox/cloud-inbox protocol across fleet; add tooling for backlog replay, repair, branch quarantine and schema-version compatibility.

- Conflict policies per domain; manual conflict operations UI where required.

- Expand existing Branch Operational Projection to later domains and richer expiry/rollback controls; baseline projections already shipped in M0/M1.

- Stress-test and broaden offline Cash/KDS/Tables/Inventory operation beyond first-pilot baseline.

- Sync observability: pending/failed/lag/lastSeen/version/disk.

- Reconnect stress tests/out-of-order/duplicate/clock skew scenarios.

- Advanced fleet update orchestration: staged rollout, failure cohorts, rollback automation and release analytics; basic signed update/rollback already exists in M1B.

### 32.6 M5 - Intelligence &amp; Ecosystem

- Provider integrations: delivery/payment/messaging/supplier/logistics/IoT as prioritized.

- Integration health dashboards، retry/DLQ/reconciliation tooling.

- Public API + API keys/scopes/developer portal/webhook subscriptions.

- Analytics store maturity: fact/dimension/read models، semantic metrics، report builder، scheduled exports.

- AI tool gateway + authorized tools + answer attribution to metrics/reports.

- Vision extraction for receipts/menu as draft/review workflows.

- Forecasting: demand/sales/stock-out/labor only after M1-M3 Intelligence Data Contract has produced sufficient quality/history.

- Anomaly detection: waste/margin/prep/channel/branch deviations.

- Optimization: promotion safety/pre-prep/capacity recommendations.

- Automation: trigger+condition+action with approvals/policies and action audit.

- Feedback/evaluation: predicted vs actual، recommendation acceptance/outcome، model version/cost tracking.

### 32.7 Delivery Capacity &amp; Pilot Timeline Model

هذه ranges للتخطيط وليست وعداً. M-1 وM0 Foundation يعملان بالتوازي، وEdge/compliance/product tracks يمكن أن تتداخل بعد تثبيت contracts. لذلك Pilot range ليس مجموع الأعمدة حسابياً. الجدول يشمل Full M0 (حتى authority/RLS/Edge sync/fiscal/PCI), وليس M0-001..024 فقط.

| Team scenario | M-1 + Full M0 | M1A | M1B | Pilot range من البداية |
| --- | --- | --- | --- | --- |
| Team A - 2 Engineers (no dedicated QA/DevOps) | 8-12 أسابيع | 8-12 | 8-12 | 22-32 أسبوعاً مع overlap محدود |
| Team B - 4 Engineers + shared QA | 6-8 أسابيع | 6-8 | 6-8 | 15-21 أسبوعاً مع تداخل tracks |
| Team C - 6 Engineers + QA + DevOps/Product support | 5-7 أسابيع | 5-7 | 5-7 | 12-17 أسبوعاً مع parallel Edge/compliance/product tracks |

- موعد ZATCA Wave 25 في 1 فبراير 2027 يجعل Team B/C أقرب لمسار Pilot قبل الموعد إذا بدأ العمل فوراً، لكن compliance onboarding/hardware/provider dependencies قد تغيّر critical path؛ لا نعد التاريخ قبل M-1-018.

<a id="section-33"></a>

## 33. Event Catalog

| Event | Plane / Ordering | Producer | المعنى | Consumers محتملون |
| --- | --- | --- | --- | --- |
| restaurant.check.opened.v1 | EDGE / PER_CHECK | Ordering | Open Check created on branch Edge. | Local realtime / Analytics after sync |
| restaurant.check_round.submitted.v1 | EDGE / PER_CHECK | Ordering | Immutable-ish round accepted; carries aggregateVersion/sequence. | Kitchen + Restaurant Consumption Orchestrator + Costing + local realtime + Analytics after sync |
| restaurant.item.voided.v1 | EDGE / PER_CHECK | Ordering/POS | Submitted item void/comp with controlled reason and preparation state. | Kitchen + Restaurant Consumption Orchestrator (reversal/waste decision) + Costing + Inventory command + Analytics/Audit |
| restaurant.check.cancelled.v1 | EDGE / PER_CHECK | Ordering | Check cancelled under policy before/after submissions. | Kitchen + consumption reversal/waste policy + Analytics/Audit |
| payment.tender_recorded.v1 | EDGE / PER_CHECK | Payments | Tender/allocation recorded locally for sale finalization. | Billing/Sale Finalization + Cloud Accounting after sync |
| payment.failed.v1 | EDGE or CLOUD / PER_PAYMENT | Payments | Payment attempt/terminal/provider flow failed. | POS/Ops/Analytics |
| refund.completed.v1 | EDGE/CLOUD by flow / PER_PAYMENT | Payments | Refund succeeded under permitted flow. | Billing Credit Note + Accounting + Analytics |
| billing.invoice_issued.v1 | EDGE / PER_DOCUMENT | Billing | Invoice issued synchronously in Sale Finalization. | Fiscalization + Cloud Accounting/Notifications after sync |
| billing.credit_note_issued.v1 | EDGE or ONLINE-REQUIRED / PER_DOCUMENT | Billing | Credit note issued and linked to original invoice. | Fiscalization + Accounting + Analytics |
| fiscalization.document_prepared.v1 | EDGE / PER_FISCAL_SEQUENCE | Compliance/KSA/Fiscalization | Invoice/credit note fiscal payload/QR/XML prepared. | Fiscal signing/state machine |
| fiscalization.document_signed.v1 | EDGE / PER_FISCAL_SEQUENCE | Compliance/KSA/Fiscalization | Fiscal document signed and local chain advanced. | Reporting/Clearance workflow + Ops |
| fiscalization.document_reported.v1 | CLOUD / PER_FISCAL_SEQUENCE | Compliance/KSA/Fiscalization | Offline-capable document reported successfully. | Billing/Ops/Accounting traceability |
| fiscalization.document_cleared.v1 | CLOUD/ONLINE / PER_DOCUMENT | Compliance/KSA/Fiscalization | Online-required standard document cleared. | Billing/Ops |
| fiscalization.document_failed.v1 | EDGE or CLOUD / PER_DOCUMENT | Compliance/KSA/Fiscalization | Prepare/sign/report/clear step failed with retry/intervention state. | Ops/Alerts |
| inventory.stock_consumed.v1 | EDGE / PER_SOURCE_OPERATION | Inventory | Append-only sale consumption created from ConsumeStock command. | Costing + Cloud Accounting COGS + Analytics |
| inventory.stock_policy_rejected.v1 | EDGE / PER_SOURCE_OPERATION | Inventory | BLOCK_ON_EDGE_KNOWN_STOCK or reservation policy rejected operation. | Ordering/POS/Ops/Analytics |
| inventory.negative_stock_detected.v1 | EDGE / PER_STOCK_ITEM | Inventory | Allowed movement pushed known stock below zero. | Operations/Analytics/Automation |
| inventory.stock_reserved.v1 (optional) | EDGE / PER_STOCK_ITEM | Inventory | Best-effort/committed reservation for configured item only. | Ordering operational status |
| inventory.stock_adjusted.v1 | EDGE or CLOUD owner / PER_STOCK_ITEM | Inventory | Controlled adjustment posted. | Accounting/Analytics/Audit |
| inventory.waste_recorded.v1 | EDGE / PER_STOCK_ITEM | Inventory | Waste movement recorded with reason/source. | Accounting/Costing/Analytics/Automation |
| inventory.stock_low.v1 | EDGE-&gt;CLOUD / PER_STOCK_ITEM | Inventory | Threshold/forecast policy triggered. | Procurement/Automation/Notifications |
| kitchen.ticket_created.v1 | EDGE / PER_CHECK | Kitchen | Kitchen work created. | KDS/local realtime/Analytics |
| kitchen.item_ready.v1 | EDGE / PER_CHECK | Kitchen | Preparation item ready. | Ordering/Waiter/local realtime/Analytics |
| customer.consent_recorded.v1 | EDGE-&gt;CLOUD / PER_CUSTOMER | Customers | Consent/preferences captured with purpose/version/time. | Customer master/Audit/Analytics policy |
| procurement.po_approved.v1 | CLOUD / PER_PO | Procurement | PO approved. | Supplier integration/Notifications |
| procurement.goods_received.v1 | CLOUD-&gt;EDGE if branch warehouse / PER_RECEIPT | Procurement | Receipt approved; target stock authority applies movement. | Branch Inventory Command or Cloud Inventory for central warehouse + Accounting |
| cash.shift_closed.v1 | EDGE / PER_SHIFT | POS/Cash | Drawer counted/closed; count difference recorded. | Cloud Accounting/Analytics/Audit after sync |
| pricing.price_resolved.v1 | EDGE / NONE | Pricing projection/runtime | Optional observable price resolution; transaction stores snapshot. | Analytics/Audit where needed |
| costing.cost_snapshot_recorded.v1 | EDGE / PER_CHECK_LINE | Costing | Historical deterministic cost snapshot captured. | Analytics/Profitability |
| edge.branch_command.accepted.v1 | EDGE-&gt;CLOUD / PER_COMMAND | Edge runtime | Cloud-originated branch command durably accepted. | Cloud external intake/Ops |
| edge.branch_command.rejected.v1 | EDGE-&gt;CLOUD / PER_COMMAND | Edge runtime | Branch command rejected with stable business/availability reason. | Cloud external intake/Ops |
| edge.sync.operation_applied.v1 | CLOUD / PER_EDGE_SEQUENCE | Sync/Inbox | Edge operation deduped/applied to cloud projection. | Cloud read models/worker triggers/observability |

Event Catalog يتوسع فقط للأحداث ذات المعنى Business الواضح. لا ننشر event لكل UPDATE تقني صغير.

Event plane rule: EDGE events تُوزع محلياً عبر Local Event Dispatcher وتُزامن عبر Edge Outbox/Cloud Inbox. CLOUD events/jobs يمكن أن تستخدم Postgres Outbox + BullMQ. لا نفترض أن BullMQ هي bus للفرع.

<a id="section-34"></a>

## 34. Data Ownership Matrix

| مجموعة البيانات | Owner | ما تمثله | قاعدة |
| --- | --- | --- | --- |
| organizations | Organizations | org id/name/status/timezone/settings | لا تعديل خارجي مباشر |
| branches | Organizations | branch/location/timezone/status | Catalog/Workforce وغيرها تشير ID فقط |
| memberships | Organizations/Auth | user-org relation/status | Identity لا يقرر role وحده |
| roles/permissions | Authorization | authorization definitions/assignments | Domain invariants تبقى داخل domain |
| products/menu | Catalog | product/menu structure + branch applicability | Pricing owned separately; Ordering stores snapshots |
| checks/items/rounds | Ordering | open check lifecycle + submissions + sale snapshots | لا Payment/Inventory/Kitchen direct table mutation |
| cashier_sessions / cash_drawer_movements / cash_count_differences | POS/Cash | cashier/drawer/open-close/count state + drawer difference | Owned by POS/Cash on Edge; Reconciliation may read synced evidence but does not own it. |
| kitchen_tickets/items | Kitchen | prep work/state/station/time | Ordering لا يملك kitchen state |
| recipes | Recipes | composition/yield/UOM/version/modifier impact | Restaurant Consumption Orchestrator reads recipe contract and issues generic ConsumeStock command; Inventory does not import Recipes. |
| stock/movements | Inventory | quantity truth/history/UOM/lot-expiry policy | Branch warehouse operational mutations execute on owning Edge; central warehouse may be Cloud-owned; no cross-plane dual writer. |
| purchase_orders/receipts | Procurement | purchase lifecycle | GoodsReceived affects Inventory via contract/event |
| employees/attendance | Workforce | employment/attendance/schedule | Performance analytics downstream |
| tenders/payment_allocations/payments/refunds | Payments | money/tender allocation attempts/results + provider/token/reference metadata; no raw card data baseline | Payments owns tender/allocation; branch sale writes via Edge runtime then syncs Cloud. |
| invoices/credit_notes | Billing | amount owed/document lifecycle | Billing owns document/number/state; issued locally in branch Sale Finalization for offline-safe flow; fiscal chain is separate owner. |
| journals/ledger | Accounting | official financial truth incl branch/channel/source dimensions and sales/COGS/waste/adjustment postings | Cloud Accounting; generated idempotently from synced source facts; not full ledger on Edge. |
| settlements/matches | Reconciliation | provider/acquirer/bank settlement matching | Detects external mismatches; does not own cash drawer difference. |
| audit_entries | Audit | who/what/before/after/context | append-oriented/tamper-resistant |
| files metadata | Files | objectKey/mime/size/checksum/ownership | Bunny is adapter only |
| analytics projections | Analytics | derived read models/KPIs | not operational source of truth |
| predictions/recommendations | Intelligence | model outputs/version/confidence | not facts; outcomes evaluated |
| price_lists/rules | Pricing | effective prices by org/branch/channel/time | Catalog does not own transaction price |
| promotions/coupons | Promotions | eligibility/discount/combo rules | Applied promotion snapshot on transaction |
| cost_snapshots | Costing | deterministic historical management cost/profit inputs | Accounting remains official financial truth |
| customers/consents | Customers | identity/contact/consent/preferences | anonymous check remains valid |
| expenses | Expenses | expense docs/categories/review | posts to Accounting via contract |
| payables | Payables | supplier liabilities/ageing | linked to procurement/supplier invoices |
| assets | Assets | register/maintenance/depreciation inputs | Accounting owns official entries |
| dispatch | Delivery | driver/assignment/status/proof | external platforms mapped via Integrations |
| tasks | Tasks | assignee/status/due/context | Automation may create commands, not direct DB writes |
| fiscalization_state | Fiscalization | EGS/CSID/ICV/PIH/XML/QR/sign/report-clear state for invoice + credit-note fiscal documents | Fiscalization owns chain/credentials; Billing owns document identity/number; local agent participates in Sale Finalization. |
| edge_nodes/deployments | Edge/Fleet Management | edge identity/branch binding/version/update/health/key refs | Does not own Open Check/Stock/Invoice; no direct business mutation ownership |
| branch_operational_projections | Owning Cloud contexts -&gt; Edge projection store | versioned read-only runtime package for catalog/pricing/promotions/recipes/UOM/policies/cost/tax/staff/floor/fiscal/device config | Projection store is not new business owner; source context remains authoritative. |

<a id="section-35"></a>

## 35. المخاطر والأسئلة المفتوحة

هذه ليست فجوات في المعمارية، بل قرارات Business/Compliance يجب تثبيتها قبل تنفيذ الجزء المرتبط بها:

- تثبيت policy mapping للأصناف: أي items تستخدم ALLOW_NEGATIVE_WITH_ALERT مقابل BLOCK/RESERVE، وحدود التنبيه/exception لكل فرع/channel.

- ما سياسة إلغاء الطلب بعد بدء التحضير؟ وما approvals/charges المترتبة؟

- ما طرق الدفع المسموحة Offline لكل بلد/provider/device؟

- Edge-first authority is fixed; remaining question is exact offline matrix per operation/channel/provider and recovery behavior when Edge hardware itself is unavailable.

- ما السياسة المحاسبية لتقييم المخزون: weighted average/FIFO وغيرها؟

- KSA-first is baseline. Open questions: exact ZATCA EGS/signing placement، sandbox/onboarding procedure، B2B/B2C pilot mix، and latest official specification changes before release.

- هل نفس Organization يمكن أن تدير Vertical مختلفاً في نفس الحساب؟ الإجابة تحدد الحاجة لـBusinessUnit/Workspace layer.

- هل العامل يمكن أن يعمل في أكثر من branch بنفس membership/employment؟

- حدود refund/discount/stock adjustment approvals حسب role/amount/branch.

- سياسات data retention للـaudit/logs/files/financial data والخصوصية لكل سوق.

- RPO/RTO/SLA المستهدفة عند أول عقود فعلية.

- اختيار Identity provider النهائي (Cognito/Auth0/بديل) حسب السوق والتكلفة ومتطلبات MFA.

- اختيار primary/backup/storage/AI/Identity regions under KSA PDPL/data-transfer review; document safeguards and processor locations before production.

- Bunny usage by data class: public media vs personal/sensitive files؛ replication regions/RPO/provider terms must be approved before storing restricted data.

- تعريف metric formulas الرسمية: gross/net sales، net profit، food cost، AOV، waste rate، channel profit.

- متى نعتبر channel commission/payment fee actual vs estimated قبل settlement؟

- Conflict policy remains domain-specific for cloud-master projections (pricing/permissions/tables metadata). Open Check/Round and fiscal sequence are single-writer/order-sensitive and are not resolved by generic LWW merge.

- الأجهزة والطابعات/scales المحددة في أول سوق والبروتوكولات/SDKs المطلوبة.

- Final Open Check/Round semantics and whether takeaway/delivery reuse same aggregate or simplified policy.

- Price precedence when org/branch/channel/promotion overlap and effective dates collide.

- Cost snapshot definition: standard/weighted actual/expected and how late supplier cost changes affect historical management margin.

- ZATCA exact EGS granularity/CSID onboarding and controlled Edge replacement/failover must be validated against latest official spec without breaking ICV/PIH chain; no uncontrolled Cloud fallback writer.

- Local Edge encryption/key recovery and device replacement procedure.

- Client capability matrix: owner web vs native، employee geofence، waiter/KDS/POS hardware integration.

- Consent/retention/deletion requirements for Customers and AI/analytics derived data under KSA policy.

- RLS operational risk: pool/session context leakage، owner/BYPASSRLS roles، background workers and migrations must be tested under real pooling behavior.

- PCI scope is provider/integration-specific: outsourcing reduces technical exposure but does not erase merchant/provider compliance responsibilities; confirm with acquirer/provider for each launch path.

- Delivery timeline risk: ZATCA sandbox/onboarding، payment terminal/vendor SDK، printers/scales and pilot hardware can become the critical path even when software tasks finish.

- Cloud-to-Edge command backlog/rate and branch-unreachable policies need measurable NFRs so external channels do not accumulate unbounded pending work.

<a id="section-36"></a>

## 36. Definition of Done / Stage Gates

### 36.1 Definition of Done لأي Feature

- Business requirements/invariants مكتوبة ومطبقة.

- Owner/module boundary واضح ولا توجد cross-table shortcuts.

- Tenant/branch authorization واختبارات isolation مكتملة.

- Errors stable codes؛ logs/traces لا تسرب secrets.

- Audit/approval/idempotency/async implications تمت مراجعتها حسب خطورة feature.

- Unit + integration + E2E المناسب ينجح.

- Migrations backward-safe قدر الإمكان.

- Observability/metrics/alerts للـcritical path مضافة.

- Documentation/event catalog/ADR updated عند تغير contract/decision.

- Performance/failure behavior مقبول تحت load المتوقع.

### 36.2 بوابات الانتقال

| من | إلى | Gate |
| --- | --- | --- |
| M-1 | M0 | Domain/compliance decisions signed for dependent work; M0 foundation-only tasks may already be running in parallel. |
| M0 | M1A | RLS-by-default + Edge/SQLite Open Check/Round + local outbox/dispatcher + Edge-&gt;Cloud Inbox/Postgres projection + Cloud-owned outbox/worker + authority/projection/event-ordering/Fiscalization/PCI contracts proven. |
| M1A | M1B | Connected-mode Edge-first sale-to-invoice passes: Product/Price/Check/Round/Kitchen local realtime/Tender/Invoice/CreditNote/Fiscalization/Check close + Cloud Accounting/COGS traceability; PIN/fast-switch/basic operational read models present. |
| M1B | M2 | Pilot stable under disconnect/reconnect: complete Branch Projection، inventory/recipes/costing، hardware/device lifecycle، local assets، no loss/duplication/dual writer; M1A fiscal/finance correctness maintained. |
| M2 | M3 | Financial integrity/reconciliation/period controls + Expenses/AP baseline proven. |
| M3 | M4 | Operational contracts stable; Minimum Edge already live; fleet/conflict expansion scope selected. |
| M4 | M5 | Advanced offline/fleet/conflict observability proven; M1-M3 data quality sufficient for intelligence. |

### 36.3 Architecture Invariant Gate - قبل بدء M1A

- Single Writer: لكل authoritative aggregate في لحظة التشغيل Writer واحد معروف؛ لا Cloud fallback write للـbranch Check/stock/tender/invoice chain.

- Data Ownership: كل business fact له Context owner واحد؛ projections/caches/sync copies لا تصبح owners.

- Runtime Authority: Edge/Cloud location مكتوبة لكل command/event؛ online/offline لا تغيّر authority ضمن نفس flow إلا Online-Required exception صريح.

- Financial/Fiscal Finalization: Check CLOSED لا يسبق durable local tender + Billing document + required fiscal state؛ Cloud ledger posting eventual أثناء offline لكنه idempotent/source-traceable.

- Milestone Dependency Consistency: أي capability مطلوبة في M1A لها contracts/runtime/tasks قبل gate؛ M4 لا يعيد تعريف foundations المفروض shipped في M0/M1.

<a id="section-37"></a>

## 37. ملحق التقنيات ومصادر الامتثال الرسمية

Snapshot تاريخ 21 سبتمبر 2026. يجب pin آخر security patch المتوافق في يوم التنفيذ بدلاً من الاعتماد على هذه الأرقام للأبد.

| التقنية | Snapshot | ملاحظة |
| --- | --- | --- |
| PostgreSQL | 18.6 current supported line | PostgreSQL 19 كان Beta أثناء التخطيط؛ لا نستخدم development major للإنتاج. |
| NestJS | 12.0.3 صدر 15 Sep 2026؛ 11.2.5 متاح | الاقتراح: V1 يبدأ 11.2.x إن كان ecosystem أكثر استقراراً، مع ADR/upgrade test لاحق. |
| React | 19.3 | Latest major/minor documentation snapshot. |
| Next.js | 16.3.3 Active LTS | Security-patched LTS snapshot. |
| Vite | 8.1 | Current stable line snapshot. |
| Redis | 8.10.x | Pin current security patch; queue/caching separated operationally. |
| Node.js | 24 LTS (26 is Current at snapshot) | Keep 24 LTS for V1; reconsider 26 after it enters LTS and Nest/native/edge/load compatibility passes. |

### 37.1 مصادر عامة للتحقق من الإصدارات عند التنفيذ

- Node.js official releases: nodejs.org

- NestJS releases: github.com/nestjs/nest/releases

- PostgreSQL documentation/releases: postgresql.org

- React releases: react.dev

- Next.js releases/security: nextjs.org/blog

- Vite releases: vite.dev/blog

- Redis releases/docs: redis.io

- Bunny pricing/storage/docs: bunny.net

- AWS ECS/Fargate/RDS pricing/docs: aws.amazon.com

### 37.2 مصادر رسمية لـKSA Compliance المستخدمة في v1.4

- ZATCA - E-Invoicing Educational Library / Detailed Guidelines / Technical Guideline: https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Pages/default.aspx

- ZATCA - E-Invoicing Implementation Resolution (cryptographic stamp/hash chain requirements): https://zatca.gov.sa/en/E-Invoicing/Introduction/LawsAndRegulations/Documents/E-Invoicing%20Implementation%20Resolution_EN.pdf

- ZATCA - Wave 25 announcement, 24 July 2026: taxpayers with VAT-subject revenues exceeding SAR 187,500; integration by no later than 1 Feb 2027: https://zatca.gov.sa/en/MediaCenter/News/Pages/Wave25-E-invoicing.aspx

- SDAIA/DGP - Personal Data Protection Law, Article 29 on transfer/disclosure outside the Kingdom: https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/PDPL

- SDAIA/DGP - Regulation on Personal Data Transfer Outside the Kingdom, including transfer risk assessment: https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/RegulationonPersonalDataTransferOutsidetheKingdom

- SDAIA/DGP - Risk Assessment Guideline for Transferring Personal Data Outside the Kingdom: https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/RiskAssessmentGuideline%20orTransferringPersonalData

- MDN - Local Network Access security/permission model (implementation reference, not legal source): https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access

Compliance note: هذه الروابط baseline للمراجعة المعمارية وليست بديلاً عن مراجعة أحدث ZATCA/PDPL specifications والاعتماد القانوني/الضريبي قبل كل Production rollout.

### 37.3 مصادر رسمية/أولية لقرارات v1.4 الإضافية

- Node.js official releases/status (Node 24 LTS, Node 26 Current at planning snapshot): https://nodejs.org/en/about/previous-releases

- PostgreSQL 18 Row Security Policies: https://www.postgresql.org/docs/18/ddl-rowsecurity.html

- PCI SSC FAQ - outsourcing payment processing does not remove all merchant responsibility: https://www.pcisecuritystandards.org/faqs/does-pci-dss-apply-to-merchants-who-outsource-all-payment-processing-operations-and-never-store-process-or-transmit-cardholder-data/

- PCI SSC FAQ - SAQ A iframe/payment-page origin criteria: https://www.pcisecuritystandards.org/faqs/1438/

- PCI SSC FAQ - SAQ A script eligibility clarification: https://www.pcisecuritystandards.org/faqs/1588/

## الخلاصة النهائية

RIFAD يجب أن يبدأ كنظام واحد متماسك هندسياً وليس كـ23 منتجات منفصلة ولا كـ23 Microservices. الأساس الصحيح هو منصة SaaS متعددة المستأجرين مع Modular Monolith منضبط، Domain ownership، Edge offline، durable events، فصل OLTP عن analytics، وذكاء فوق بيانات موثوقة.

النجاح الأول هو إغلاق M-1 بالتوازي مع Foundation Track، ثم M0 يثبت سلطتين بلا تضارب: Edge-owned branch operational flow من SQLite/local outbox إلى Cloud Inbox/Postgres projection، وCloud-owned flow من Postgres/outbox إلى workers/projections. بعدها M1A يثبت Edge-first Sale-to-Invoice/Fiscalization/Finance minimum، وM1B يثبت الانقطاع/المخزون/التكلفة/الأجهزة قبل توسيع Finance/Operations/Intelligence.

| قاعدة المشروع<br>Correct Business Data  -&gt;  Reliable Operations  -&gt;  Analytics  -&gt;  Intelligence  -&gt;  Automation. |
| --- |

هذه الوثيقة هي مرجع Architecture/Implementation v1.4 (KSA-reviewed, authority-consistent). أي تغيير جوهري في runtime authority، tenancy، data ownership، Open Check/Rounds، pricing/costing، fiscalization، module boundaries، sync/event plane، personal-data governance، financial invariants أو event contracts يجب أن يسجل كـADR ويراجع قبل التنفيذ.
