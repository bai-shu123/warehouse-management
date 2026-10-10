# 技术架构与数据模型

## 1. 部署方案

```text
浏览器（电脑 / 手机 / 平板）
        |
        | HTTPS
        v
GitHub Pages（React + TypeScript + Vite 静态前端）
        |
        | Supabase JS client（只使用 anon key）
        v
Supabase
  - Auth：登录、会话、密码重置
  - Postgres：业务数据、RLS、事务函数
  - Storage：款式图片
  - Realtime：运输、待办和库存摘要刷新
```

GitHub Actions 在主分支变更后构建并部署静态前端。Supabase 的 service role key 只存在于受控迁移或后台任务环境，不进入浏览器和 GitHub Pages。

## 2. 推荐技术栈

- React + TypeScript + Vite
- React Router，使用可兼容 GitHub Pages 的路由策略
- Tailwind CSS + CSS variables，用于响应式布局和设计 token
- `lucide-react`，用于操作按钮和状态图标
- Supabase Auth、Postgres、Storage、Realtime
- `react-i18next` 或等价 i18n 层，语言包按 `zh-CN`、`ru`、`kk` 管理
- Excel 导出使用浏览器端结构化导出库；PDF 由受权限控制的报表视图生成

## 3. 数据表设计

### 身份与权限

- `profiles`
  - `id`（等同 `auth.users.id`）
  - `display_name`
  - `locale`：`zh-CN` / `ru` / `kk`
  - `is_active`
  - `created_at`, `updated_at`
- `user_roles`
  - `user_id`
  - `role`：`admin` / `warehouse_operator` / `finance`
- `warehouses`
  - `id`, `code`, `name`, `warehouse_type`
  - `warehouse_type`：`external` / `own`
- `warehouse_members`
  - `user_id`, `warehouse_id`
  - 用于限制员工只能访问被分配的自有库房

### 款式与图片

- `products`
  - `id`
  - `sku`：唯一、必填
  - `name`：可空
  - `archived_at`
- `product_images`
  - `id`, `product_id`
  - `storage_path`, `alt_text`, `sort_order`, `is_primary`
  - `created_by`, `created_at`

### 汇率与批次

- `exchange_rates`
  - `id`, `effective_date`
  - `cny_per_usd`
  - `kzt_per_usd`
  - `note`, `entered_by`, `created_at`
  - 同一生效日期允许多条修订，当前值由 `created_at` 最新记录决定
- `inventory_batches`
  - `id`, `product_id`
  - `source_transport_id`（可空）
  - `received_date`
  - `unit_cost_rmb_per_piece`
  - `fx_snapshot_id`
  - `total_received_packages`, `total_received_pieces`
  - `note`, `created_by`, `created_at`

批次保留原始人民币单价和入库汇率快照。历史成本由批次/收货事件计算，当前参考价值使用当前有效汇率计算。

### 运输

- `transport_orders`
  - `id`, `transport_no`
  - `transport_type`：`domestic_to_external` / `warehouse_transfer`
  - `source_warehouse_id`（国内运输为空）
  - `destination_warehouse_id`
  - `status`：`draft` / `in_transit` / `partial_received` / `completed` / `exception`
  - `shipped_at`, `expected_arrival_at`, `completed_at`
  - `created_by`, `note`
- `transport_lines`
  - `transport_id`, `product_id`, `batch_id`
  - `planned_packages`, `planned_pieces`
  - `unit_cost_rmb_per_piece`（管理员视图）
- `transport_receipts`
  - `transport_line_id`
  - `received_packages`, `received_pieces`
  - `received_at`, `received_by`, `note`
- `transport_exceptions`
  - `transport_id`, `kind`
  - `kind`：`shortage` / `lost` / `damaged` / `other`
  - `reported_packages`, `reported_pieces`, `reason`
  - `resolved_by`, `resolved_at`, `resolution_note`

### 台账、回退与待办

- `stock_operations`
  - `id`, `operation_type`
  - `operation_type`：`inbound` / `issue` / `transfer_dispatch` / `transfer_receipt` / `rollback` / `unrollback`
  - `warehouse_id`, `product_id`（汇总字段）
  - `occurred_at`, `created_by`, `note`
  - `reversal_of_operation_id`（可空）
- `stock_operation_lines`
  - `operation_id`, `batch_id`
  - `package_delta`, `piece_delta`
  - `recipient_name`（取货时使用）
- `stock_movements`
  - `operation_line_id`, `warehouse_id`, `batch_id`
  - `package_delta`, `piece_delta`
  - `created_at`
- `reversal_links`
  - `original_operation_id`, `reversal_operation_id`
  - `reversed_by`, `reason`, `created_at`
- `admin_tasks`
  - `task_type`：`transport_exception` / `review_operation`
  - `transport_id` 或 `operation_id`
  - `status`：`open` / `resolved`
  - `assigned_to`, `resolved_by`, `resolved_at`
- `audit_log`
  - `actor_id`, `action`, `entity_type`, `entity_id`
  - `before_json`, `after_json`, `reason`, `created_at`

生产查询不直接依赖可被修改的库存总数字段。通过 `stock_movements` 汇总生成批次余额和库房摘要，并可用物化视图或缓存表优化仪表盘。

## 4. 关键数据库规则

1. 普通取货必须通过数据库函数在同一事务内校验批次包数和件数余额，并写入操作、明细、库存变动和审计日志。
2. 调拨发运先扣减来源库房可用余额，运输余量由计划数量减已收数量计算；目标库房只在实际收货时增加余额。
3. 国内运输在实际收货前不增加他人库房库存；分批收货每次写入独立收货事件。
4. 回退和撤销回退只能追加反向操作，不能 `DELETE` 业务记录。回退函数要求管理员身份、原因和二次确认令牌。
5. 正常取货不能产生负数。回退操作允许产生负数，并在余额视图中明确标记。
6. 汇率和历史成本快照不可更新，只能追加新版本。
7. 库存、运输、回退等关键写操作使用幂等请求标识，避免移动端重复点击造成重复入账。

## 5. RLS 与敏感数据隔离

基础表默认不向非管理员授予通用 `select`。对员工和财务只开放经过列裁剪的安全视图和 RPC：

- `v_warehouse_operator_stock`：只返回被分配自有库房的款式、包数、件数、运输状态和日期，不含价格字段。
- `v_finance_ledger`：返回入库、取出、运输和数量统计，过滤采购价、成本、汇率、原始货款字段。
- `v_admin_full_ledger`：仅管理员可读，包含完整成本、汇率快照和回退链。

RLS 判断使用数据库函数读取角色和仓库分配，避免客户端传入 `warehouse_id` 绕过权限。图片读取使用短时签名 URL；上传和删除默认仅管理员开放。

## 6. 导出与多语言

- 导出先从角色对应的安全视图查询，再生成 Excel/PDF，不能在前端查询全量表后隐藏列。
- 报表标题、列名、状态和错误信息从语言包读取。
- 款式名称、备注、领取人等业务数据按原文输出。
- 导出语言跟随当前用户 `profiles.locale`。

## 7. 部署与运行检查

- GitHub Actions：类型检查、单元测试、构建、部署。
- Supabase migration：版本化提交，生产环境只通过迁移更新结构。
- 环境变量：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`；禁止提交 service role key。
- 上线前检查：RLS 测试、员工/财务越权测试、回退链测试、移动端收货测试、三语言导出测试。
