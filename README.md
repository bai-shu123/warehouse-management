# 库房账本

双库房服装库存台账的第一版前端和 Supabase 数据库迁移。

## 本地启动

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

没有配置 Supabase 时，界面使用演示数据运行；配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 后，前端会启用 Supabase 连接层。

## Supabase

1. 在 Supabase 项目 SQL Editor 中执行 `supabase/migrations/0001_initial.sql`。
2. 在 Authentication 中创建管理员账号。
3. 为管理员补充 `profiles` 和 `user_roles` 数据。
4. 创建 Storage bucket `product-images`，并按迁移文件中的策略限制上传。

## GitHub Pages

仓库中的 `.github/workflows/deploy.yml` 会在 `main` 或 `master` 推送后构建并发布。需要在 GitHub Repository secrets 中配置：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

只配置 Supabase anon key，绝不要把 service role key 放入前端或 GitHub Pages。

详细业务需求、数据模型和界面设计见 `docs/`。
