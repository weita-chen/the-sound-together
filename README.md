# The Sound Together

私人的聆聽與故事收集。參與者不用註冊；主辦人從畫面右下角的小圓環進入。

## Gemini API key

詩句優先走 Gemini。沒有這把鑰匙時，才會改用伺服器上的 xAI 金鑰。

1. 打開 [Google AI Studio](https://aistudio.google.com/apikey)，建立一支 API key。
2. 在部署環境新增變數，名稱一定要是 `GEMINI_API_KEY`，值貼上那支 key。不要加進前端、不要寫進程式、不要提交到 GitHub。
3. 可選：`GEMINI_MODEL`，沒設的話使用 `gemini-2.5-flash`。
4. 重新部署。之後每位參與者送出名字或文字回答時，會各呼叫一次。

若網站是接到你自己的 Vercel：Project → Settings → Environment Variables，加上 `GEMINI_API_KEY`，環境選 Production（以及 Preview，若要預覽也用 Gemini）。

同時建議：

- `DATABASE_URL`：Postgres 連線字串。正式環境不要靠暫時的本機資料庫，否則故事不會留下來。
- `VITE_AUTH_ENABLED`：設為 `false`。這個網站用口令保護主辦區，參與者沒有帳號。
- `ORGANIZER_PASSWORD`：可選。若設了，主辦口令以這個為準，不再從網站裡第一次設定。
