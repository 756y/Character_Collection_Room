# 角色收藏室（Character Collection Room）

這個 Vite + React 專案會將原本的角色收藏室保留在 `public/legacy/`，並在外層加入 Supabase 電子郵件註冊、電子郵件驗證、登入、保持登入狀態與登出功能。登入後會顯示原本的角色收藏介面。

## 開始使用

1. 安裝 Node.js LTS 版本。
2. 在 VS Code 中開啟此資料夾。
3. 在終端機執行：

   ```bash
   npm install
   ```

4. 複製 `.env.example`，並將副本命名為 `.env.local`。
5. 在 `.env.local` 填入 Supabase 專案網址（Project URL）與公開金鑰（Publishable Key）。
6. 在 Supabase 控制台中開啟 **Authentication → URL Configuration**：
   - 本機網站網址（Site URL）：`http://localhost:5173`
   - 重新導向網址（Redirect URLs）：加入 `http://localhost:5173/**`
7. 開啟 **Authentication → Sign In / Providers**，確認已啟用 Email，並開啟 Confirm Email。
8. 在終端機執行：

   ```bash
   npm run dev
   ```

9. 開啟 Vite 終端機顯示的網址（通常是 `http://localhost:5173`）。

## 注意事項

- 如果 Vite 顯示不同的連接埠，請將對應網址加入 Supabase 的 Redirect URLs。
- 點擊驗證郵件中的連結時，開發伺服器必須正在執行，才能返回 `localhost`。
- 前端只能使用 Supabase 公開金鑰（Publishable Key）；絕對不要放入 `service_role` 或 Secret Key。
- 角色文字資料會同步到 Supabase `public.characters`，圖片會上傳至 `character-images` 私人 Bucket；網站透過登入使用者的權限讀寫資料，並使用限時簽署網址讀取私人圖片。第一次登入時，若雲端角色表是空的，網站會嘗試將目前瀏覽器的本機角色卡自動匯入雲端。請先保留原始 JSON 備份，並在另一個瀏覽器／帳號測試前確認 RLS 與 Storage policies 已正確建立。
- 本專案預期資料表欄位為 `id uuid`、`user_id uuid`、`title text`、`content jsonb`、`image_path text`、`created_at timestamptz`、`updated_at timestamptz`，且 `characters` 已啟用 RLS。Storage Bucket 名稱必須是 `character-images` 並設為 Private；圖片路徑格式為 `使用者ID/角色ID/檔名`。
- `public/legacy/` 內的原始頁面透過 iframe 顯示，以保留既有的搜尋、篩選、匯入匯出與編輯功能；這不是已重新改寫成 React 元件的版本。
