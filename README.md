# 一点点 · 学习小花园

从五分钟开始，完成学习收获金币，兑换自己的小奖励。

这是一个适合手机与电脑浏览器使用的静态网页，无需安装依赖或运行构建命令。

## 发布到 GitHub Pages

1. 在 GitHub 新建一个仓库，例如 `study-garden`。GitHub Free 账号使用公开仓库发布 Pages。
2. 将本文件夹的 `index.html`、`.nojekyll` 和 `README.md` 上传到仓库根目录并提交。请勿只上传 ZIP 压缩包。
3. 打开仓库的 **Settings → Pages**。
4. 在 **Build and deployment → Source** 选择 **Deploy from a branch**。
5. 分支选择实际上传文件的分支（通常为 `main`），目录选择 **/(root)**，点击 **Save**。
6. 等待部署完成，在 Pages 页面点击 **Visit site**，用手机打开该网址。

以后修改并提交 `index.html` 后，Pages 会自动重新发布。

官方说明：https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## 使用方式

- 默认专注 5 分钟，完成获得 10 枚金币。
- 每分钟获得 2 枚金币，可选择其他时长或自定义。
- 用金币兑换带倒计时的休息，也可创建自己的奖励。
- 学习记录和金币保存在浏览器的本地存储中，不会自动上传到 GitHub。
- 手机、电脑以及不同浏览器之间不会自动同步。可以使用页面底部的“导出备份”和“导入”转移记录。
- 从离线文件改用 Pages 网址时，本地记录也不会自动迁移，请先导出，再到新网址中导入。
- 清除网站数据会清除当前浏览器中的记录，建议定期备份。
- 页面关闭时无法发出提示音；重新打开后会结算已经到期的计时。

GitHub Pages 发布的是可公开访问的网页。请只上传本发布包中的程序文件，不要上传个人学习备份。

## 文件

- `index.html`：包含界面、样式和程序逻辑的完整页面。
- `.nojekyll`：告诉 Pages 直接提供静态文件。
- `README.md`：部署与使用说明。

## 当前验证范围

计时、暂停、重开恢复、单次结算、奖励兑换、自定义奖励、备份恢复和并发结算逻辑已经检查。浏览器界面实测受执行环境限制未完成。

