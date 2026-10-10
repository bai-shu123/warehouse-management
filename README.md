# 库房账本

双库房服装库存台账的第一版前端和 Supabase 数据库迁移。

## 本地启动

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

未配置 Supabase 时，界面会明确显示配置错误，不会再回退到演示数据。配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 后，登录、查询和所有库存操作都直接连接 Supabase。

## Supabase

1. 新项目依次执行 `supabase/migrations/0001_initial.sql` 和 `supabase/migrations/0002_operational_workflows.sql`。
2. 已执行第一份迁移的项目，只需继续执行 `0002_operational_workflows.sql`。
3. 在应用登录页创建第一个账号；第一个账号自动初始化为管理员，后续账号默认为仓库员工。
4. 管理员可在“人员与权限”页面调整已注册账号的角色、启用状态和库房分配。

前端只使用 publishable/anon key。任何 service role key 都不得写入浏览器环境或 GitHub Pages。

## GitHub Pages

仓库中的 `.github/workflows/deploy.yml` 会在 `main` 或 `master` 推送后构建并发布。需要在 GitHub Repository secrets 中配置：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

只配置 Supabase anon key，绝不要把 service role key 放入前端或 GitHub Pages。

详细业务需求、数据模型和界面设计见 `docs/`。
