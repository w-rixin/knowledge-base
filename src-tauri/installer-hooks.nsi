; ============================================================================
; 自定义 NSIS 安装钩子
; 目的：保留 productName="Knowledge Base"（让 CI 产物名/updater URL 全英文，
;       避免 GitHub Release Asset 中文字符 URL 编码导致更新失败），
;       同时让用户桌面/开始菜单的快捷方式显示中文"知识库"。
;
; 编码必须为 UTF-8 with BOM，否则 NSIS 编译器无法正确识别中文字面量。
; ============================================================================

!macro NSIS_HOOK_PREINSTALL
  ; ─── 关闭 kb-mcp sidecar 进程 ───────────────────────────────────
  ; kb-mcp.exe 是被外部 MCP host（Claude Code / Cursor / Cherry Studio
  ; 等）通过 stdio 拉起的子进程，独立于主程序生命周期。Tauri 默认
  ; 只检测主 exe 在跑，不知道这个 sidecar 也需要关闭，导致升级时
  ; NSIS 写入 $INSTDIR\kb-mcp.exe 失败，弹"无法打开要写入的文件"。
  ;
  ; 这里在文件覆盖前主动 kill。进程不存在时 taskkill 返回非 0，但
  ; 不影响安装继续；用 nsExec::Exec 静默执行，不会闪黑窗。
  ;
  ; 副作用：用户当前挂着 knowledge-base MCP 的 Claude Code/Cursor
  ; 会话会失去这个 server 的连接，需要重连或重启会话。但 kb-mcp.exe
  ; 本身就要被新版本覆盖，这个打断在升级语义下避免不了。
  nsExec::Exec 'taskkill /F /IM kb-mcp.exe'
  Pop $0

  ; 给 Windows 释放文件锁一点时间（实测 200ms 够用，500ms 兜底）
  Sleep 500
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 删除 Tauri 默认创建的英文快捷方式
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"

  ; 创建中文快捷方式（指向同一个 exe）
  CreateShortcut "$DESKTOP\知识库.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\知识库.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"

  ; 覆盖 Tauri fileAssociations 默认生成的右键菜单文字
  ; Tauri 默认写入 "Open with ${PRODUCTNAME}"（=Open with Knowledge Base），
  ; 这里改为中文"使用知识库打开"。FILECLASS 取自 tauri.conf.json 的 name 字段。
  WriteRegStr SHCTX "Software\Classes\Markdown 文件\shell\open" "" "使用知识库打开"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; 卸载时清理中文快捷方式
  Delete "$DESKTOP\知识库.lnk"
  Delete "$SMPROGRAMS\$AppStartMenuFolder\知识库.lnk"
!macroend