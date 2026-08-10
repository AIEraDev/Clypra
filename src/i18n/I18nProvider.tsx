import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type AppLanguage = "en" | "zh-TW" | "zh-CN";

const STORAGE_KEY = "clypra.language";

// English remains the source language. Keeping the translations here makes it
// possible to localize legacy UI without coupling every component to i18n.
const ZH_TW: Record<string, string> = {
  "Settings": "設定", "Appearance": "外觀", "Editor": "編輯器", "Shortcuts": "快捷鍵",
  "Auto-Captions": "自動字幕", "Storage & Cache": "儲存空間與快取", "About": "關於",
  "Language": "語言", "Interface language": "介面顯示語言", "Choose the language used throughout Clypra": "選擇 Clypra 全介面使用的語言", "English": "English（英文）",
  "Traditional Chinese": "繁體中文", "Theme": "主題", "Font": "字型", "Custom Theme": "自訂主題",
  "Hide Editor": "隱藏編輯器", "Custom Theme Editor": "自訂主題編輯器", "Apply Custom Theme": "套用自訂主題",
  "Timeline": "時間軸", "Snap to grid": "對齊格線", "Clips snap to ruler ticks when dragging": "拖曳片段時對齊尺規刻度",
  "Magnetic snap": "磁性吸附", "Snap clips to playhead and other clip edges": "將片段吸附到播放頭或其他片段邊緣",
  "Sequence Settings": "序列設定", "Aspect ratio": "畫面比例", "Canvas dimensions for export": "匯出畫面的尺寸比例",
  "Frame rate": "影格率", "Frames per second for this project": "此專案每秒影格數", "Defaults": "預設值",
  "Auto-save": "自動儲存", "Periodically save project state": "定期儲存專案狀態",
  "Default frame rate": "預設影格率", "Frame rate for new projects": "新專案的預設影格率",
  "Start a new project": "開始新專案", "Begin with a 16:9 landscape canvas, or capture your screen and face simultaneously.": "使用 16:9 橫向畫布開始，或同時錄製螢幕與攝影機。",
  "Recent Projects": "最近的專案", "No recent projects": "沒有最近的專案", "Create a new project to get started": "建立新專案以開始使用",
  "New Project": "新增專案", "Create Project": "建立專案", "Open Project": "開啟專案", "Project name": "專案名稱",
  "Rename Project": "重新命名專案", "Delete Project": "刪除專案", "Rename": "重新命名", "Delete": "刪除",
  "Cancel": "取消", "Save": "儲存", "Close": "關閉", "Confirm": "確認", "More options": "更多選項",
  "This action cannot be undone. All project data will be permanently deleted.": "此操作無法復原，所有專案資料將被永久刪除。",
  "Import": "匯入", "Import Files": "匯入檔案", "Media": "媒體", "Media Assets": "媒體素材", "Text": "文字",
  "Add Text": "新增文字", "Audio": "音訊", "Add Audio": "新增音訊", "Transitions": "轉場", "Adjust": "調整",
  "Clip Properties": "片段屬性", "Asset Library": "素材庫", "Clip Adjustments": "片段調整",
  "Export": "匯出", "Export Video": "匯出影片", "Exporting...": "正在匯出…", "Download": "下載",
  "Media Library": "媒體庫", "Add Media": "新增媒體", "No media yet": "尚無媒體", "Drop files here": "將檔案拖放到這裡",
  "Track": "軌道", "No tracks": "沒有軌道", "New track": "新增軌道", "Locked": "已鎖定", "Remove Gap": "移除空隙",
  "Drop media here • I to import": "將媒體拖放至此 • 按 I 匯入", "Zoom In": "放大", "Zoom Out": "縮小",
  "Play": "播放", "Pause": "暫停", "Mute": "靜音", "Volume": "音量", "Playing": "播放中",
  "Loading...": "載入中…", "Application Error": "應用程式錯誤", "Something went wrong": "發生錯誤",
  "Something went wrong. The application encountered an unexpected error.": "發生未預期的錯誤，應用程式無法繼續執行。",
  "Try Again": "再試一次", "Search": "搜尋", "No results": "沒有結果", "Recommended": "建議", "Active": "使用中",
  "Cached": "已快取", "Failed": "失敗", "Audio ready for use": "音訊已可使用", "Downloading...": "下載中…",
  "Cache Management": "快取管理", "Cache Status": "快取狀態", "Clear All Caches": "清除所有快取",
  "Performance Diagnostics": "效能診斷", "Screen Capture Enabled": "已啟用螢幕擷取", "Microphone Source": "麥克風來源",
  "No microphone devices found.": "找不到麥克風裝置。", "Recording Audio Only": "僅錄製音訊",
  "Transcription Language": "轉錄語言", "Search languages...": "搜尋語言…", "Whisper Models": "Whisper 模型",
  "Local Auto-Captions": "本機自動字幕", "Caption settings": "字幕設定", "Delete Caption": "刪除字幕",
  "Enter subtitle text...": "輸入字幕文字…", "Start:": "開始：", "Duration:": "長度：",
  "No effects found": "找不到效果", "Try a different search or category": "請嘗試其他搜尋或分類",
  "No matching effects found": "找不到相符的效果", "Try searching for other styles": "請搜尋其他樣式",
  "Software Update": "軟體更新", "Clypra is up to date": "Clypra 已是最新版本", "New Version Available": "有新版本可用",
  "Release Notes": "版本說明", "Downloading update...": "正在下載更新…", "Update Check Failed": "檢查更新失敗",
  "Back to Home": "返回首頁", "Undo": "復原", "Redo": "重做", "Undo (Cmd+Z)": "復原（Cmd+Z）",
  "Redo (Cmd+Shift+Z)": "重做（Cmd+Shift+Z）", "Swap selected clips (Ctrl+Shift+S)": "交換選取的片段（Cmd/Ctrl+Shift+S）",
  "Delete left at playhead (Q)": "刪除播放頭左側（Q）", "Delete right at playhead (W)": "刪除播放頭右側（W）",
  "Split all at playhead (S)": "在播放頭分割全部（S）", "Ripple mode (R) - Affects drag, trim, and delete operations": "連動模式（R）— 影響拖曳、修剪與刪除操作",
  "Delete selected clip(s)": "刪除選取的片段", "Duplicate selected clip(s) (Cmd/Ctrl+D)": "複製選取的片段（Cmd/Ctrl+D）",
  "Close gaps": "關閉空隙", "Closed timeline gaps": "已關閉時間軸空隙", "No clips under playhead to split": "播放頭下沒有可分割的片段",
  "No clips to delete left at playhead": "播放頭左側沒有可刪除的片段", "No clips to delete right at playhead": "播放頭右側沒有可刪除的片段",
  "Zoom out timeline": "縮小時間軸", "Zoom in timeline": "放大時間軸", "Timeline zoom": "時間軸縮放",
  "No clips on timeline": "時間軸上沒有片段", "Previous frame": "上一影格", "Next frame": "下一影格",
  "Pause playback": "暫停播放", "Play playback": "開始播放", "Base:": "基底：", "Dark": "深色", "Midnight": "午夜",
  "Ocean": "海洋", "Forest": "森林", "Midnight Carbon": "午夜碳黑", "Ember Studio": "餘燼工作室",
  "Forest Console": "森林控制台", "Slate Noir": "石板黑", "Rose Cut": "玫瑰切面",
  "Import theme from JSON file": "從 JSON 檔案匯入主題", "Export theme to JSON file": "將主題匯出為 JSON 檔案",
  "Copy all colors from selected base theme": "複製所選基底主題的所有色彩", "Reset to default dark theme": "重設為預設深色主題",
  "Search colors...": "搜尋色彩…", "A modern, native video editor built with Tauri, React, and FFmpeg. Designed for speed and creative freedom.": "以 Tauri、React 與 FFmpeg 打造的現代原生影片編輯器，兼顧速度與創作自由。",
  "Auto-updates are only available in the desktop app.": "自動更新僅適用於桌面版應用程式。", "Keep Clypra running at peak performance.": "讓 Clypra 保持最佳效能。",
  "Searching for newer releases...": "正在搜尋新版本…", "You are currently running the latest version.": "目前使用的是最新版本。",
  "The application will automatically restart once complete.": "完成後應用程式將自動重新啟動。", "An unknown error occurred.": "發生未知錯誤。",
  "Text Animations": "文字動畫", "Entrance": "進場", "Exit": "退場", "Duration": "持續時間", "Easing": "緩動",
  "Linear": "線性", "Ease In": "緩入", "Ease Out": "緩出", "Ease In-Out": "緩入緩出",
  "Animations preview during playback": "動畫會在播放時預覽", "Plain Text": "純文字", "Text Effect": "文字效果", "Template": "範本",
  "Press a key...": "按下按鍵…", "Reset All": "全部重設", "Keyboard Shortcuts": "鍵盤快捷鍵",
  "Transform": "變形", "Position": "位置", "Scale": "縮放", "Rotation": "旋轉", "Opacity": "不透明度",
  "Crop": "裁切", "Fit": "符合", "Fill": "填滿", "Reset": "重設", "Audio Settings": "音訊設定",
  "Fade In": "淡入", "Fade Out": "淡出", "Text Style": "文字樣式", "Font Size": "字型大小", "Font Weight": "字重",
  "Text Content": "文字內容", "Text Color": "文字色彩", "Fill Color": "填滿色彩", "Thin (100)": "極細（100）",
  "Extra Light (200)": "特細（200）", "Light (300)": "細體（300）", "Regular (400)": "標準（400）",
  "Medium (500)": "中等（500）", "Semi Bold (600)": "半粗（600）", "Bold (700)": "粗體（700）",
  "Extra Bold (800)": "特粗（800）", "Black (900)": "超粗（900）", "Transition Settings": "轉場設定",
  "Type": "類型", "Fade": "淡化", "Dissolve": "溶解", "Ease In / Out": "緩入／緩出", "Filter Settings": "濾鏡設定",
  "Effect Settings": "效果設定", "Timeline Filter": "時間軸濾鏡", "Body Effect": "人物效果", "Video Effect": "影片效果", "Intensity": "強度",
  "Importing...": "正在匯入…", "Import Media": "匯入媒體", "No media imported": "尚未匯入媒體",
  "Import videos, audio, or images to get started": "匯入影片、音訊或圖片以開始使用", "Remove from Timeline": "從時間軸移除",
  "Add to Track": "加入軌道", "Essentials": "基本", "Portrait": "人像", "Landscape": "風景", "Cinematic": "電影感",
  "Movies": "電影", "Vintage": "復古", "Vibrant": "鮮豔", "Mono": "等寬", "Aesthetic": "美感", "Life": "生活",
  "Failed to load filters": "無法載入濾鏡", "No matching filters found": "找不到相符的濾鏡", "Try another category or search": "請嘗試其他分類或搜尋",
  "Failed to add filter": "無法新增濾鏡", "No approved audio yet": "尚無已核准的音訊", "Add to Timeline": "加入時間軸",
  "Download & Add": "下載並加入", "No internet connection.": "沒有網路連線。", "No favorite templates saved.": "尚未儲存最愛範本。",
  "Updating templates library...": "正在更新範本庫…", "No matching templates found": "找不到相符的範本", "Try searching other categories": "請搜尋其他分類",
  "Auto Caption Generator": "自動字幕產生器", "Generate highly accurate captions automatically from the audio tracks in your project timeline. Powered by local speech recognition models.": "使用本機語音辨識模型，從專案時間軸的音軌自動產生高準確度字幕。",
  "Filter gaps & silence": "過濾空隙與靜音", "No audio or video clips found on the timeline. Drag some media onto the timeline first to transcribe them.": "時間軸上找不到音訊或影片片段。請先將媒體拖曳到時間軸再進行轉錄。",
  "Analyzing Audio Timeline...": "正在分析音訊時間軸…", "Transcribing Speech (Whisper Offline)...": "正在轉錄語語音（Whisper 離線）…",
  "Aligning Word Timestamps...": "正在對齊文字時間戳記…", "Stitching Subtitle Track...": "正在組合字幕軌…",
  "Please keep Clypra open. This process runs locally.": "請保持 Clypra 開啟，此程序會在本機執行。", "Captions Generated Successfully!": "字幕已成功產生！",
  "Geometric": "幾何", "Optical Distortion": "光學扭曲", "Temporal": "時間", "Particle Dissolve": "粒子溶解",
  "Light Based": "光線類", "Depth Based": "深度類", "Physics Simulated": "物理模擬", "Failed to load transitions": "無法載入轉場",
  "No matching transitions found": "找不到相符的轉場", "Select two clips or place playhead at a cut": "選取兩個片段，或將播放頭置於剪接點",
  "Add transition to timeline": "將轉場加入時間軸", "No stickers found": "找不到貼圖", "Add sticker to timeline": "將貼圖加入時間軸",
  "Download sticker": "下載貼圖", "Whisper Model Required": "需要 Whisper 模型", "Generating...": "正在產生…",
  "Auto-Generate Captions": "自動產生字幕", "No captions on the timeline. Click Add Manual or Import to begin.": "時間軸上沒有字幕。請按「手動新增」或「匯入」開始。",
  "Jump Playhead to Start": "將播放頭跳至開始位置", "New Caption Text": "新字幕文字",
  "Preview aspect ratio": "預覽畫面比例", "Playback quality": "播放品質", "Playback speed": "播放速度",
  "Add text to timeline": "將文字加入時間軸", "Clear marks": "清除標記", "Close (Esc)": "關閉（Esc）",
  "Mark In (I)": "設定入點（I）", "Mark Out (O)": "設定出點（O）", "Play marked region": "播放標記範圍",
  "Change Text Effect": "變更文字效果", "Detach Effect (Keep current styles)": "分離效果（保留目前樣式）",
  "Applied Filter": "已套用的濾鏡", "Remove Effect": "移除效果", "Remove Filter": "移除濾鏡", "Video Effects": "影片效果",
  "Sticker Animation": "貼圖動畫", "Colors & Effects": "色彩與效果", "Preset Effects": "預設效果",
  "Style Presets": "樣式預設集", "Template Gallery": "範本庫", "Typography": "字體排印", "Center on canvas": "置中於畫布",
  "Flip Horizontal": "水平翻轉", "Flip Vertical": "垂直翻轉", "Reset rotation": "重設旋轉", "Timing": "時間設定",
  "Double-click to reset volume": "按兩下以重設音量", "Delete marker": "刪除標記", "Link clips": "連結片段",
  "Waveform unavailable": "無法顯示波形", "Waveform unavailable for this format": "此格式無法顯示波形",
  "Pack track (remove gaps)": "壓縮軌道（移除空隙）", "Pack track - remove all unprotected gaps": "壓縮軌道 — 移除所有未受保護的空隙",
  "Click to rebind": "按一下以重新設定", "Reset to default": "重設為預設值", "Delete model": "刪除模型",
  "Close sheet": "關閉面板", "Click to rename project": "按一下重新命名專案", "Save Name": "儲存名稱",
  "Dismiss": "關閉", "Dismiss update notification": "關閉更新通知", "Download and install update": "下載並安裝更新",
  "Download animated preview": "下載動態預覽",
  "VIDEO EDITOR": "影片編輯器", "Create something amazing": "創作令人驚豔的作品", "Record Screen & Camera": "錄製螢幕與攝影機",
  "Untitled Project": "未命名專案", "Today": "今天", "Yesterday": "昨天", "API Configuration": "API 設定",
  "Clypra uses the Clypra API for text effects and templates. To enable these features": "Clypra 使用 Clypra API 提供文字效果與範本。若要啟用這些功能：",
  "Stickers": "貼圖", "Effects": "效果", "Filters": "濾鏡", "Captions": "字幕", "Safe Zones": "安全區域",
  "Standard": "標準", "Readable cadence": "可讀節奏", "System": "系統", "Classic dark": "經典深色",
  "Deep blue tones": "深藍色調", "Cool cyan accents": "冷色青綠點綴", "Natural green hues": "自然 green 綠色色調",
  "Professional broadcast-grade cold precision": "專業廣播級 cold 冷調精準風格", "Warm creative workspace": "溫暖的創作工作空間",
  "Low eye strain terminal aesthetic": "低眼睛負擔的終端機美學", "Maximum neutrality broadcast interface": "高度中性的廣播介面",
  "Modern approachable aesthetic": "現代且親和的美學風格",
  "Restore Unsaved Session?": "要復原未儲存的工作階段嗎？", "An unsaved session for": "偵測到以下專案有未儲存的工作階段：",
  "was detected.": "。", "Last saved:": "上次儲存：", "Discard": "捨棄", "Restore Session": "復原工作階段", "Restoring…": "正在復原…",
  "Saving project": "正在儲存專案", "Stopping preview": "正在停止預覽", "Cleaning up resources": "正在清理資源", "Resetting state": "正在重設狀態",
  "Error Closing Project": "關閉專案時發生錯誤", "Some cleanup steps failed. Please check the console for details.": "部分清理步驟失敗，請查看主控台以取得詳細資訊。",
  "Saving": "正在儲存", "and cleaning up...": "並清理資源…", "Force Close": "強制關閉",
  "A new version has been released on GitHub": "GitHub 已發布新版本", "Active Videos": "作用中的影片", "Active model:": "使用中的模型：",
  "Add clips to the timeline before exporting.": "請先將片段加入時間軸再匯出。", "Add media to the timeline": "將媒體加入時間軸",
  "Add template to timeline": "將範本加入時間軸", "Add text effect to timeline": "將文字效果加入時間軸", "Added": "已加入",
  "All models run locally on your device. Your audio never leaves your computer, ensuring complete privacy and offline functionality.": "所有模型都在你的裝置上執行，音訊不會離開電腦，可確保隱私與離線使用。",
  "An error occurred during the rendering and encoding process.": "算圖與編碼過程中發生錯誤。", "App Cache": "應用程式快取",
  "App cache, WebView, GPU, and IndexedDB": "應用程式快取、WebView、GPU 與 IndexedDB", "Apply to all captions": "套送到所有字幕",
  "Audio Library Cache": "音訊庫快取", "Audio published from Clypra Studio will appear here after API cache refresh.": "從 Clypra Studio 發布的音訊會在 API 快取更新後顯示於此。",
  "Auto-Captions Configuration": "自動字幕設定", "Auto-detect works well for most content. Set a language explicitly to improve accuracy for accented speech or mixed-language content.": "自動偵測適用於大多數內容；明確指定語言可提高口音或混合語言內容的準確度。",
  "Auto-saving…": "正在自動儲存…", "Average Speed": "平均速度", "Background Box": "背景方塊", "Blur Radius": "模糊半徑",
  "Border Radius": "圓角半徑", "Box Color": "方塊色彩", "Broadcast styles to all clips on this track": "將樣式套用到此軌道的所有片段",
  "Cache:": "快取：", "Cached Audio Files": "已快取的音訊檔案", "Cached Text Effects": "已快取的文字效果", "Canvas": "畫布",
  "Check console (F12) for details": "請查看主控台（F12）以取得詳細資訊", "Checking FFmpeg…": "正在檢查 FFmpeg…",
  "Clear Audio Cache": "清除音訊快取", "Clear Local Cache": "清除本機快取", "Clear cached data to free up disk space or resolve performance issues.": "清除快取資料以釋放磁碟空間或解決效能問題。",
  "Clearing audio cache will remove all downloaded library files. You'll need to download them again when adding to timeline.": "清除音訊快取會移除所有已下載的音訊庫檔案，日後加入時間軸時需重新下載。",
  "Clearing cache may require an application restart for full effect": "清除快取後可能需要重新啟動應用程式才會完全生效",
  "Click on any clip in the timeline to view and edit its properties": "按一下時間軸中的任一片段以檢視及編輯屬性", "Closing Project": "正在關閉專案",
  "Cloud Render Video": "雲端算圖影片", "Cloud Rendering Fallback": "雲端算圖備援", "Codec": "編碼器", "Color": "色彩", "Color Filter": "色彩濾鏡",
  "Configure Whisper speech recognition for automatic caption generation.": "設定 Whisper 語音辨識以自動產生字幕。", "Conform Mode": "適配模式",
  "Conform Offset X": "適配 X 位移", "Conform Offset Y": "適配 Y 位移", "Conform Scale": "適配縮放", "Custom Gradient": "自訂漸層",
  "Custom style name...": "自訂樣式名稱…", "Delete all downloaded files": "刪除所有已下載檔案", "Deleting...": "正在刪除…",
  "Detailed breakdown of project loading phases. Shows which parts take the longest to load.": "詳細分析專案載入階段，顯示最耗時的部分。",
  "Disabled": "已停用", "Discard preview? Files remain on disk.": "要捨棄預覽嗎？檔案仍會保留在磁碟上。", "Disk Size": "磁碟大小",
  "Download Trimmed": "下載修剪片段", "Download and add text effect to timeline": "下載文字效果並加入時間軸", "Download and add text to timeline": "下載文字並加入時間軸",
  "Download template": "下載範本", "Drop media files into the media panel to get started": "將媒體檔案拖放到媒體面板以開始使用",
  "Dropped Frames": "掉格數", "Dropped:": "掉格：", "Enabled": "已啟用", "English (US)": "英文（美國）", "Est. File Size": "預估檔案大小",
  "Export Complete!": "匯出完成！", "Export Failed": "匯出失敗", "Export Preset": "匯出預設集", "Export Project File": "匯出專案檔",
  "Export Settings": "匯出設定", "Exporting Video…": "正在匯出影片…", "FFmpeg is required": "需要 FFmpeg", "FFmpeg missing": "缺少 FFmpeg",
  "Files": "檔案", "Flip": "翻轉", "Font Family": "字型系列", "Frame Rate": "影格率", "Frames": "影格", "Free": "免費",
  "GPU Cache": "GPU 快取", "GPU Memory": "GPU 記憶體", "GPU Preview Initializing...": "正在初始化 GPU 預覽…", "GPU Textures": "GPU 紋理",
  "Gold Gradient": "金色漸層", "Google Web Fonts": "Google 網頁字型", "Gradient Stops": "漸層節點", "Hide camera": "隱藏攝影機",
  "Hide track": "隱藏軌道", "Horizontal Align": "水平對齊", "Important Notes:": "重要注意事項：", "In:": "入點：", "Inactive": "未使用",
  "IndexedDB": "IndexedDB", "Input level:": "輸入音量：", "Install FFmpeg and add to PATH": "安裝 FFmpeg 並加入 PATH",
  "Letter Spacing": "字距", "Level": "音量", "Line Height": "行高", "Loading preview...": "正在載入預覽…",
  "Local cache stores effects on your device for faster access.": "本機快取會將效果儲存在裝置上，以加快存取速度。", "Local-First Privacy": "本機優先隱私",
  "Lock aspect ratio": "鎖定畫面比例", "Lock track": "鎖定軌道", "Manage cached text effects from local storage and API.": "管理本機儲存空間與 API 的文字效果快取。",
  "Manage downloaded audio files from the audio library.": "管理從音訊庫下載的音訊檔案。", "Marker name…": "標記名稱…", "Max Drift:": "最大偏移：",
  "Memory": "記憶體", "Memory + IndexedDB": "記憶體 + IndexedDB", "Mobile Export": "行動裝置匯出", "Model active": "模型使用中",
  "Mute audio": "將音訊靜音", "Mute track": "將軌道靜音", "Name": "名稱", "No active model selected. Click \"Use this model\" on a downloaded model to enable auto-captions.": "尚未選擇使用中的模型。請在已下載的模型上按「使用此模型」以啟用自動字幕。",
  "No clips in sequence": "序列中沒有片段", "No content to export": "沒有可匯出的內容", "No matching presets found.": "找不到相符的預設集。",
  "No matching templates found.": "找不到相符的範本。", "No model downloaded yet — download one above to enable auto-captions.": "尚未下載模型 — 請下載上方任一模型以啟用自動字幕。",
  "No template active.": "目前沒有套用範本。", "Normal trim (Shift for ripple)": "一般修剪（按 Shift 連動）", "Note:": "注意：",
  "Note: Changing colors will detach from the effect preset.": "注意：變更色彩會與效果預設分離。", "Note: Modifying typography will detach from the effect preset.": "注意：修改字體排印會與效果預設分離。",
  "OFF": "關", "ON": "開", "Offset X": "X 位移", "Offset Y": "Y 位移", "On-Device Rendering Available": "可使用裝置端算圖", "Out:": "出點：",
  "Outer Glow / Shadow": "外光暈／陰影", "Outline / Stroke": "外框／描邊", "Output": "輸出", "Padding": "內距", "Pixel Format": "像素格式",
  "Playhead": "播放頭", "Prefer Application Window": "優先選擇應用程式視窗", "Prefer Entire Display": "優先選擇整個顯示器",
  "Preview Performance": "預覽效能", "Previewing": "預覽中", "Procedural Style Preview": "程序式樣式預覽", "Program Preview (PixiJS)": "節目預覽（PixiJS）",
  "Project": "專案", "Project Closed": "專案已關閉", "Project File Export Fallback": "專案檔匯出備援", "Properties": "屬性", "Protect": "保護",
  "Quality": "品質", "Rainbow Gradient": "彩虹漸層", "Recording Screen": "正在錄製螢幕", "Refresh Stats": "重新整理統計資料",
  "Renaming...": "正在重新命名…", "Render Effect": "算圖效果", "Render Telemetry": "算圖遙測", "Rendered Frames": "已算圖影格",
  "Reset all?": "要全部重設嗎？", "Resolution": "解析度", "Returning to home...": "正在返回首頁…", "Ripple trim (Shift to disable)": "連動修剪（按 Shift 停用）",
  "Ruler": "尺規", "Samples Collected": "已收集樣本", "Saved Path": "儲存路徑", "Scene Eval": "場景評估", "Scheduler": "排程器",
  "Screen recording": "螢幕錄影", "Search body effects...": "搜尋人物效果…", "Search effects...": "搜尋效果…", "Search shortcuts...": "搜尋快捷鍵…",
  "Search templates...": "搜尋範本…", "Seeks/sec": "每秒搜尋次數", "Select a clip to edit": "選取片段以進行編輯",
  "Select a template from the gallery below to apply it.": "從下方範本庫選取範本以套用。", "Shared File": "共享檔案", "Show camera": "顯示攝影機",
  "Show track": "顯示軌道", "Size": "大小", "Solid Color": "純色", "Speed": "速度", "Stale Reuse": "過期重用",
  "Standard System Picker (Let me choose)": "標準系統選擇器（讓我選擇）", "Style": "樣式", "Sunset Gradient": "夕陽漸層",
  "System Fonts": "系統字型", "System picker will prompt when recording starts": "開始錄影時會顯示系統選擇器", "Text Effects Cache": "文字效果快取",
  "The app will restart when complete": "完成後應用程式將重新啟動", "Thickness": "粗細", "Time Remaining": "剩餘時間", "Toolbar": "工具列",
  "Total Render Time": "總算圖時間", "Total Size": "總大小", "Total:": "總計：", "Transition": "轉場", "Trim In": "修剪入點", "Trim Out": "修剪出點",
  "Try another search or category": "請嘗試其他搜尋或分類", "Type your text...": "輸入文字…", "Unlock aspect ratio": "解除鎖定畫面比例",
  "Unlock track": "解除鎖定軌道", "Unmute": "取消靜音", "Unmute audio": "取消音訊靜音", "Unmute track": "取消軌道靜音",
  "Unprotect": "取消保護", "Update cache information": "更新快取資訊", "Vertical Align": "垂直對齊",
  "Video export requires FFmpeg to be installed and available in your system PATH.": "匯出影片需要安裝 FFmpeg，且能從系統 PATH 存取。",
  "WebView cache (Windows) may be locked by running processes": "WebView 快取（Windows）可能被執行中的程序鎖定",
  "Your custom text": "你的自訂文字", "Your settings and preferences will be preserved": "你的設定與偏好將會保留",
  "Your video has been successfully generated and saved to your device.": "影片已成功產生並儲存到你的裝置。", "p95 Frame Time": "p95 影格時間",
  "— WebGL Pipeline": "— WebGL 管線", "● Live Testing": "● 即時測試", "✂ Trimmed": "✂ 已修剪",
};

// Simplified Chinese translations. Keys mirror the English source text so the
// same DOM-walking translation engine can swap languages without touching
// components. Generated via OpenCC `tw2sp` from ZH_TW; reviewers are encouraged
// to refine wording for mainland usage (e.g. 软件 vs 软体).
const ZH_CN: Record<string, string> = {
  "Settings": "设置", "Appearance": "外观", "Editor": "编辑器", "Shortcuts": "快捷键", "Auto-Captions": "自动字幕", "Storage & Cache": "保存空间与缓存",
  "About": "关于", "Language": "语言", "Interface language": "接口显示语言", "Choose the language used throughout Clypra": "选择 Clypra 全接口使用的语言", "English": "English（英文）", "Traditional Chinese": "繁体中文",
  "Theme": "主题", "Font": "字体", "Custom Theme": "自订主题", "Hide Editor": "隐藏编辑器", "Custom Theme Editor": "自订主题编辑器", "Apply Custom Theme": "套用自订主题",
  "Timeline": "时间轴", "Snap to grid": "对齐格线", "Clips snap to ruler ticks when dragging": "拖曳片段时对齐尺规刻度", "Magnetic snap": "磁性吸附", "Snap clips to playhead and other clip edges": "将片段吸附到播放头或其他片段边缘", "Sequence Settings": "串行设置",
  "Aspect ratio": "画面比例", "Canvas dimensions for export": "导出画面的尺寸比例", "Frame rate": "影格率", "Frames per second for this project": "此项目每秒影格数", "Defaults": "默认值", "Auto-save": "自动保存",
  "Periodically save project state": "定期保存项目状态", "Default frame rate": "缺省影格率", "Frame rate for new projects": "新项目的缺省影格率", "Start a new project": "开始新项目", "Begin with a 16:9 landscape canvas, or capture your screen and face simultaneously.": "使用 16:9 横向画布开始，或同时录制屏幕与摄影机。", "Recent Projects": "最近的项目",
  "No recent projects": "没有最近的项目", "Create a new project to get started": "创建新项目以开始使用", "New Project": "添加项目", "Create Project": "创建项目", "Open Project": "打开项目", "Project name": "项目名称",
  "Rename Project": "重命名项目", "Delete Project": "删除项目", "Rename": "重命名", "Delete": "删除", "Cancel": "取消", "Save": "保存",
  "Close": "关闭", "Confirm": "确认", "More options": "更多选项", "This action cannot be undone. All project data will be permanently deleted.": "此操作无法复原，所有项目数据将被永久删除。", "Import": "导入", "Import Files": "导入文件",
  "Media": "媒体", "Media Assets": "媒体素材", "Text": "文本", "Add Text": "添加文本", "Audio": "音频", "Add Audio": "添加音频",
  "Transitions": "转场", "Adjust": "调整", "Clip Properties": "片段属性", "Asset Library": "素材库", "Clip Adjustments": "片段调整", "Export": "导出",
  "Export Video": "导出视频", "Exporting...": "正在导出…", "Download": "下载", "Media Library": "媒体库", "Add Media": "添加媒体", "No media yet": "尚无媒体",
  "Drop files here": "将文件拖放到这里", "Track": "轨道", "No tracks": "没有轨道", "New track": "添加轨道", "Locked": "已锁定", "Remove Gap": "移除空隙",
  "Drop media here • I to import": "将媒体拖放至此 • 按 I 导入", "Zoom In": "放大", "Zoom Out": "缩小", "Play": "播放", "Pause": "暂停", "Mute": "静音",
  "Volume": "音量", "Playing": "播放中", "Loading...": "加载中…", "Application Error": "应用程序错误", "Something went wrong": "发生错误", "Something went wrong. The application encountered an unexpected error.": "发生未预期的错误，应用程序无法继续运行。",
  "Try Again": "再试一次", "Search": "搜索", "No results": "没有结果", "Recommended": "建议", "Active": "使用中", "Cached": "已缓存",
  "Failed": "失败", "Audio ready for use": "音频已可使用", "Downloading...": "下载中…", "Cache Management": "缓存管理", "Cache Status": "缓存状态", "Clear All Caches": "清除所有缓存",
  "Performance Diagnostics": "性能诊断", "Screen Capture Enabled": "已激活屏幕截取", "Microphone Source": "麦克风来源", "No microphone devices found.": "找不到麦克风设备。", "Recording Audio Only": "仅录制音频", "Transcription Language": "转录语言",
  "Search languages...": "搜索语言…", "Whisper Models": "Whisper 模型", "Local Auto-Captions": "本机自动字幕", "Caption settings": "字幕设置", "Delete Caption": "删除字幕", "Enter subtitle text...": "输入字幕文本…",
  "Start:": "开始：", "Duration:": "长度：", "No effects found": "找不到效果", "Try a different search or category": "请尝试其他搜索或分类", "No matching effects found": "找不到相符的效果", "Try searching for other styles": "请搜索其他样式",
  "Software Update": "软件更新", "Clypra is up to date": "Clypra 已是最新版本", "New Version Available": "有新版本可用", "Release Notes": "版本说明", "Downloading update...": "正在下载更新…", "Update Check Failed": "检查更新失败",
  "Back to Home": "返回首页", "Undo": "复原", "Redo": "重做", "Undo (Cmd+Z)": "复原（Cmd+Z）", "Redo (Cmd+Shift+Z)": "重做（Cmd+Shift+Z）", "Swap selected clips (Ctrl+Shift+S)": "交换选取的片段（Cmd/Ctrl+Shift+S）",
  "Delete left at playhead (Q)": "删除播放头左侧（Q）", "Delete right at playhead (W)": "删除播放头右侧（W）", "Split all at playhead (S)": "在播放头分割全部（S）", "Ripple mode (R) - Affects drag, trim, and delete operations": "连动模式（R）— 影响拖曳、修剪与删除操作", "Delete selected clip(s)": "删除选取的片段", "Duplicate selected clip(s) (Cmd/Ctrl+D)": "拷贝选取的片段（Cmd/Ctrl+D）",
  "Close gaps": "关闭空隙", "Closed timeline gaps": "已关闭时间轴空隙", "No clips under playhead to split": "播放头下没有可分割的片段", "No clips to delete left at playhead": "播放头左侧没有可删除的片段", "No clips to delete right at playhead": "播放头右侧没有可删除的片段", "Zoom out timeline": "缩小时间轴",
  "Zoom in timeline": "放大时间轴", "Timeline zoom": "时间轴缩放", "No clips on timeline": "时间轴上没有片段", "Previous frame": "上一影格", "Next frame": "下一影格", "Pause playback": "暂停播放",
  "Play playback": "开始播放", "Base:": "基底：", "Dark": "深色", "Midnight": "午夜", "Ocean": "海洋", "Forest": "森林",
  "Midnight Carbon": "午夜碳黑", "Ember Studio": "余烬工作室", "Forest Console": "森林控制台", "Slate Noir": "石板黑", "Rose Cut": "玫瑰切面", "Import theme from JSON file": "从 JSON 文件导入主题",
  "Export theme to JSON file": "将主题导出为 JSON 文件", "Copy all colors from selected base theme": "拷贝所选基底主题的所有色彩", "Reset to default dark theme": "重设为缺省深色主题", "Search colors...": "搜索色彩…", "A modern, native video editor built with Tauri, React, and FFmpeg. Designed for speed and creative freedom.": "以 Tauri、React 与 FFmpeg 打造的现代原生视频编辑器，兼顾速度与创作自由。", "Auto-updates are only available in the desktop app.": "自动更新仅适用于桌面版应用程序。",
  "Keep Clypra running at peak performance.": "让 Clypra 保持最佳性能。", "Searching for newer releases...": "正在搜索新版本…", "You are currently running the latest version.": "目前使用的是最新版本。", "The application will automatically restart once complete.": "完成后应用程序将自动重新启动。", "An unknown error occurred.": "发生未知错误。", "Text Animations": "文本动画",
  "Entrance": "进场", "Exit": "退场", "Duration": "持续时间", "Easing": "缓动", "Linear": "线性", "Ease In": "缓入",
  "Ease Out": "缓出", "Ease In-Out": "缓入缓出", "Animations preview during playback": "动画会在播放时预览", "Plain Text": "纯文本", "Text Effect": "文本效果", "Template": "范本",
  "Press a key...": "按下按键…", "Reset All": "全部重设", "Keyboard Shortcuts": "键盘快捷键", "Transform": "变形", "Position": "位置", "Scale": "缩放",
  "Rotation": "旋转", "Opacity": "不透明度", "Crop": "裁切", "Fit": "符合", "Fill": "填满", "Reset": "重设",
  "Audio Settings": "音频设置", "Fade In": "淡入", "Fade Out": "淡出", "Text Style": "文本样式", "Font Size": "字体大小", "Font Weight": "字重",
  "Text Content": "文本内容", "Text Color": "文本色彩", "Fill Color": "填满色彩", "Thin (100)": "极细（100）", "Extra Light (200)": "特细（200）", "Light (300)": "细体（300）",
  "Regular (400)": "标准（400）", "Medium (500)": "中等（500）", "Semi Bold (600)": "半粗（600）", "Bold (700)": "粗体（700）", "Extra Bold (800)": "特粗（800）", "Black (900)": "超粗（900）",
  "Transition Settings": "转场设置", "Type": "类型", "Fade": "淡化", "Dissolve": "溶解", "Ease In / Out": "缓入／缓出", "Filter Settings": "滤镜设置",
  "Effect Settings": "效果设置", "Timeline Filter": "时间轴滤镜", "Body Effect": "人物效果", "Video Effect": "视频效果", "Intensity": "强度", "Importing...": "正在导入…",
  "Import Media": "导入媒体", "No media imported": "尚未导入媒体", "Import videos, audio, or images to get started": "导入视频、音频或图片以开始使用", "Remove from Timeline": "从时间轴移除", "Add to Track": "加入轨道", "Essentials": "基本",
  "Portrait": "人像", "Landscape": "风景", "Cinematic": "电影感", "Movies": "电影", "Vintage": "复古", "Vibrant": "鲜艳",
  "Mono": "等宽", "Aesthetic": "美感", "Life": "生活", "Failed to load filters": "无法加载滤镜", "No matching filters found": "找不到相符的滤镜", "Try another category or search": "请尝试其他分类或搜索",
  "Failed to add filter": "无法添加滤镜", "No approved audio yet": "尚无已核准的音频", "Add to Timeline": "加入时间轴", "Download & Add": "下载并加入", "No internet connection.": "没有网络连接。", "No favorite templates saved.": "尚未保存最爱范本。",
  "Updating templates library...": "正在更新范本库…", "No matching templates found": "找不到相符的范本", "Try searching other categories": "请搜索其他分类", "Auto Caption Generator": "自动字幕产生器", "Generate highly accurate captions automatically from the audio tracks in your project timeline. Powered by local speech recognition models.": "使用本机语音辨识模型，从项目时间轴的音轨自动产生高准确度字幕。", "Filter gaps & silence": "过滤空隙与静音",
  "No audio or video clips found on the timeline. Drag some media onto the timeline first to transcribe them.": "时间轴上找不到音频或视频片段。请先将媒体拖曳到时间轴再进行转录。", "Analyzing Audio Timeline...": "正在分析音频时间轴…", "Transcribing Speech (Whisper Offline)...": "正在转录语语音（Whisper 脱机）…", "Aligning Word Timestamps...": "正在对齐文本时间戳记…", "Stitching Subtitle Track...": "正在组合字幕轨…", "Please keep Clypra open. This process runs locally.": "请保持 Clypra 打开，此进程会在本机运行。",
  "Captions Generated Successfully!": "字幕已成功产生！", "Geometric": "几何", "Optical Distortion": "光学扭曲", "Temporal": "时间", "Particle Dissolve": "粒子溶解", "Light Based": "光线类",
  "Depth Based": "深度类", "Physics Simulated": "物理仿真", "Failed to load transitions": "无法加载转场", "No matching transitions found": "找不到相符的转场", "Select two clips or place playhead at a cut": "选取两个片段，或将播放头置于剪接点", "Add transition to timeline": "将转场加入时间轴",
  "No stickers found": "找不到贴图", "Add sticker to timeline": "将贴图加入时间轴", "Download sticker": "下载贴图", "Whisper Model Required": "需要 Whisper 模型", "Generating...": "正在产生…", "Auto-Generate Captions": "自动产生字幕",
  "No captions on the timeline. Click Add Manual or Import to begin.": "时间轴上没有字幕。请按「手动添加」或「导入」开始。", "Jump Playhead to Start": "将播放头跳至开始位置", "New Caption Text": "新字幕文本", "Preview aspect ratio": "预览画面比例", "Playback quality": "播放品质", "Playback speed": "播放速度",
  "Add text to timeline": "将文本加入时间轴", "Clear marks": "清除标记", "Close (Esc)": "关闭（Esc）", "Mark In (I)": "设置入点（I）", "Mark Out (O)": "设置出点（O）", "Play marked region": "播放标记范围",
  "Change Text Effect": "变更文本效果", "Detach Effect (Keep current styles)": "分离效果（保留目前样式）", "Applied Filter": "已套用的滤镜", "Remove Effect": "移除效果", "Remove Filter": "移除滤镜", "Video Effects": "视频效果",
  "Sticker Animation": "贴图动画", "Colors & Effects": "色彩与效果", "Preset Effects": "缺省效果", "Style Presets": "样式缺省集", "Template Gallery": "范本库", "Typography": "字体排印",
  "Center on canvas": "置中于画布", "Flip Horizontal": "水平翻转", "Flip Vertical": "垂直翻转", "Reset rotation": "重设旋转", "Timing": "时间设置", "Double-click to reset volume": "按两下以重设音量",
  "Delete marker": "删除标记", "Link clips": "链接片段", "Waveform unavailable": "无法显示波形", "Waveform unavailable for this format": "此格式无法显示波形", "Pack track (remove gaps)": "压缩轨道（移除空隙）", "Pack track - remove all unprotected gaps": "压缩轨道 — 移除所有未受保护的空隙",
  "Click to rebind": "按一下以重新设置", "Reset to default": "重设为默认值", "Delete model": "删除模型", "Close sheet": "关闭面板", "Click to rename project": "按一下重命名项目", "Save Name": "保存名称",
  "Dismiss": "关闭", "Dismiss update notification": "关闭更新通知", "Download and install update": "下载并安装更新", "Download animated preview": "下载动态预览", "VIDEO EDITOR": "视频编辑器", "Create something amazing": "创作令人惊艳的作品",
  "Record Screen & Camera": "录制屏幕与摄影机", "Untitled Project": "未命名项目", "Today": "今天", "Yesterday": "昨天", "API Configuration": "API 设置", "Clypra uses the Clypra API for text effects and templates. To enable these features": "Clypra 使用 Clypra API 提供文本效果与范本。若要激活这些功能：",
  "Stickers": "贴图", "Effects": "效果", "Filters": "滤镜", "Captions": "字幕", "Safe Zones": "安全区域", "Standard": "标准",
  "Readable cadence": "可读节奏", "System": "系统", "Classic dark": "经典深色", "Deep blue tones": "深蓝色调", "Cool cyan accents": "冷色青绿点缀", "Natural green hues": "自然 green 绿色色调",
  "Professional broadcast-grade cold precision": "专业广播级 cold 冷调精准风格", "Warm creative workspace": "温暖的创作工作空间", "Low eye strain terminal aesthetic": "低眼睛负担的终端机美学", "Maximum neutrality broadcast interface": "高度中性的广播接口", "Modern approachable aesthetic": "现代且亲和的美学风格", "Restore Unsaved Session?": "要复原未保存的工作阶段吗？",
  "An unsaved session for": "侦测到以下项目有未保存的工作阶段：", "was detected.": "。", "Last saved:": "上次保存：", "Discard": "舍弃", "Restore Session": "复原工作阶段", "Restoring…": "正在复原…",
  "Saving project": "正在保存项目", "Stopping preview": "正在停止预览", "Cleaning up resources": "正在清理资源", "Resetting state": "正在重设状态", "Error Closing Project": "关闭项目时发生错误", "Some cleanup steps failed. Please check the console for details.": "部分清理步骤失败，请查看主控台以取得详细信息。",
  "Saving": "正在保存", "and cleaning up...": "并清理资源…", "Force Close": "强制关闭", "A new version has been released on GitHub": "GitHub 已发布新版本", "Active Videos": "作用中的视频", "Active model:": "使用中的模型：",
  "Add clips to the timeline before exporting.": "请先将片段加入时间轴再导出。", "Add media to the timeline": "将媒体加入时间轴", "Add template to timeline": "将范本加入时间轴", "Add text effect to timeline": "将文本效果加入时间轴", "Added": "已加入", "All models run locally on your device. Your audio never leaves your computer, ensuring complete privacy and offline functionality.": "所有模型都在你的设备上运行，音频不会离开电脑，可确保隐私与脱机使用。",
  "An error occurred during the rendering and encoding process.": "算图与编码过程中发生错误。", "App Cache": "应用程序缓存", "App cache, WebView, GPU, and IndexedDB": "应用程序缓存、WebView、GPU 与 IndexedDB", "Apply to all captions": "套送到所有字幕", "Audio Library Cache": "音频库缓存", "Audio published from Clypra Studio will appear here after API cache refresh.": "从 Clypra Studio 发布的音频会在 API 缓存更新后显示于此。",
  "Auto-Captions Configuration": "自动字幕设置", "Auto-detect works well for most content. Set a language explicitly to improve accuracy for accented speech or mixed-language content.": "自动侦测适用于大多数内容；明确指定语言可提高口音或混合语言内容的准确度。", "Auto-saving…": "正在自动保存…", "Average Speed": "平均速度", "Background Box": "背景方块", "Blur Radius": "模糊半径",
  "Border Radius": "圆角半径", "Box Color": "方块色彩", "Broadcast styles to all clips on this track": "将样式套用到此轨道的所有片段", "Cache:": "缓存：", "Cached Audio Files": "已缓存的音频文件", "Cached Text Effects": "已缓存的文本效果",
  "Canvas": "画布", "Check console (F12) for details": "请查看主控台（F12）以取得详细信息", "Checking FFmpeg…": "正在检查 FFmpeg…", "Clear Audio Cache": "清除音频缓存", "Clear Local Cache": "清除本机缓存", "Clear cached data to free up disk space or resolve performance issues.": "清除缓存数据以释放磁盘空间或解决性能问题。",
  "Clearing audio cache will remove all downloaded library files. You'll need to download them again when adding to timeline.": "清除音频缓存会移除所有已下载的音频库文件，日后加入时间轴时需重新下载。", "Clearing cache may require an application restart for full effect": "清除缓存后可能需要重新启动应用程序才会完全生效", "Click on any clip in the timeline to view and edit its properties": "按一下时间轴中的任一片段以查看及编辑属性", "Closing Project": "正在关闭项目", "Cloud Render Video": "云端算图视频", "Cloud Rendering Fallback": "云端算图备援",
  "Codec": "编码器", "Color": "色彩", "Color Filter": "色彩滤镜", "Configure Whisper speech recognition for automatic caption generation.": "设置 Whisper 语音辨识以自动产生字幕。", "Conform Mode": "适配模式", "Conform Offset X": "适配 X 位移",
  "Conform Offset Y": "适配 Y 位移", "Conform Scale": "适配缩放", "Custom Gradient": "自订渐层", "Custom style name...": "自订样式名称…", "Delete all downloaded files": "删除所有已下载文件", "Deleting...": "正在删除…",
  "Detailed breakdown of project loading phases. Shows which parts take the longest to load.": "详细分析项目加载阶段，显示最耗时的部分。", "Disabled": "已停用", "Discard preview? Files remain on disk.": "要舍弃预览吗？文件仍会保留在磁盘上。", "Disk Size": "磁盘大小", "Download Trimmed": "下载修剪片段", "Download and add text effect to timeline": "下载文本效果并加入时间轴",
  "Download and add text to timeline": "下载文本并加入时间轴", "Download template": "下载范本", "Drop media files into the media panel to get started": "将媒体文件拖放到媒体面板以开始使用", "Dropped Frames": "掉格数", "Dropped:": "掉格：", "Enabled": "已激活",
  "English (US)": "英文（美国）", "Est. File Size": "预估文件大小", "Export Complete!": "导出完成！", "Export Failed": "导出失败", "Export Preset": "导出缺省集", "Export Project File": "导出项目档",
  "Export Settings": "导出设置", "Exporting Video…": "正在导出视频…", "FFmpeg is required": "需要 FFmpeg", "FFmpeg missing": "缺少 FFmpeg", "Files": "文件", "Flip": "翻转",
  "Font Family": "字体系列", "Frame Rate": "影格率", "Frames": "影格", "Free": "免费", "GPU Cache": "GPU 缓存", "GPU Memory": "GPU 内存",
  "GPU Preview Initializing...": "正在初始化 GPU 预览…", "GPU Textures": "GPU 纹理", "Gold Gradient": "金色渐层", "Google Web Fonts": "Google 网页字体", "Gradient Stops": "渐层节点", "Hide camera": "隐藏摄影机",
  "Hide track": "隐藏轨道", "Horizontal Align": "水平对齐", "Important Notes:": "重要注意事项：", "In:": "入点：", "Inactive": "未使用", "IndexedDB": "IndexedDB",
  "Input level:": "输入音量：", "Install FFmpeg and add to PATH": "安装 FFmpeg 并加入 PATH", "Letter Spacing": "字距", "Level": "音量", "Line Height": "行高", "Loading preview...": "正在加载预览…",
  "Local cache stores effects on your device for faster access.": "本机缓存会将效果保存在设备上，以加快访问速度。", "Local-First Privacy": "本机优先隐私", "Lock aspect ratio": "锁定画面比例", "Lock track": "锁定轨道", "Manage cached text effects from local storage and API.": "管理本机保存空间与 API 的文本效果缓存。", "Manage downloaded audio files from the audio library.": "管理从音频库下载的音频文件。",
  "Marker name…": "标记名称…", "Max Drift:": "最大偏移：", "Memory": "内存", "Memory + IndexedDB": "内存 + IndexedDB", "Mobile Export": "行动设备导出", "Model active": "模型使用中",
  "Mute audio": "将音频静音", "Mute track": "将轨道静音", "Name": "名称", "No active model selected. Click \"Use this model\" on a downloaded model to enable auto-captions.": "尚未选择使用中的模型。请在已下载的模型上按「使用此模型」以激活自动字幕。", "No clips in sequence": "串行中没有片段", "No content to export": "没有可导出的内容",
  "No matching presets found.": "找不到相符的缺省集。", "No matching templates found.": "找不到相符的范本。", "No model downloaded yet — download one above to enable auto-captions.": "尚未下载模型 — 请下载上方任一模型以激活自动字幕。", "No template active.": "目前没有套用范本。", "Normal trim (Shift for ripple)": "一般修剪（按 Shift 连动）", "Note:": "注意：",
  "Note: Changing colors will detach from the effect preset.": "注意：变更色彩会与效果缺省分离。", "Note: Modifying typography will detach from the effect preset.": "注意：修改字体排印会与效果缺省分离。", "OFF": "关", "ON": "开", "Offset X": "X 位移", "Offset Y": "Y 位移",
  "On-Device Rendering Available": "可使用设备端算图", "Out:": "出点：", "Outer Glow / Shadow": "外光晕／阴影", "Outline / Stroke": "外框／描边", "Output": "输出", "Padding": "内距",
  "Pixel Format": "像素格式", "Playhead": "播放头", "Prefer Application Window": "优先选择应用程序窗口", "Prefer Entire Display": "优先选择整个显示器", "Preview Performance": "预览性能", "Previewing": "预览中",
  "Procedural Style Preview": "进程式样式预览", "Program Preview (PixiJS)": "节目预览（PixiJS）", "Project": "项目", "Project Closed": "项目已关闭", "Project File Export Fallback": "项目档导出备援", "Properties": "属性",
  "Protect": "保护", "Quality": "品质", "Rainbow Gradient": "彩虹渐层", "Recording Screen": "正在录制屏幕", "Refresh Stats": "刷新统计数据", "Renaming...": "正在重命名…",
  "Render Effect": "算图效果", "Render Telemetry": "算图遥测", "Rendered Frames": "已算图影格", "Reset all?": "要全部重设吗？", "Resolution": "分辨率", "Returning to home...": "正在返回首页…",
  "Ripple trim (Shift to disable)": "连动修剪（按 Shift 停用）", "Ruler": "尺规", "Samples Collected": "已收集样本", "Saved Path": "保存路径", "Scene Eval": "场景评估", "Scheduler": "调度器",
  "Screen recording": "屏幕录像", "Search body effects...": "搜索人物效果…", "Search effects...": "搜索效果…", "Search shortcuts...": "搜索快捷键…", "Search templates...": "搜索范本…", "Seeks/sec": "每秒搜索次数",
  "Select a clip to edit": "选取片段以进行编辑", "Select a template from the gallery below to apply it.": "从下方范本库选取范本以套用。", "Shared File": "共享文件", "Show camera": "显示摄影机", "Show track": "显示轨道", "Size": "大小",
  "Solid Color": "纯色", "Speed": "速度", "Stale Reuse": "过期重用", "Standard System Picker (Let me choose)": "标准系统选择器（让我选择）", "Style": "样式", "Sunset Gradient": "夕阳渐层",
  "System Fonts": "系统字体", "System picker will prompt when recording starts": "开始录像时会显示系统选择器", "Text Effects Cache": "文本效果缓存", "The app will restart when complete": "完成后应用程序将重新启动", "Thickness": "粗细", "Time Remaining": "剩余时间",
  "Toolbar": "工具列", "Total Render Time": "总算图时间", "Total Size": "总大小", "Total:": "总计：", "Transition": "转场", "Trim In": "修剪入点",
  "Trim Out": "修剪出点", "Try another search or category": "请尝试其他搜索或分类", "Type your text...": "输入文本…", "Unlock aspect ratio": "解除锁定画面比例", "Unlock track": "解除锁定轨道", "Unmute": "取消静音",
  "Unmute audio": "取消音频静音", "Unmute track": "取消轨道静音", "Unprotect": "取消保护", "Update cache information": "更新缓存信息", "Vertical Align": "垂直对齐", "Video export requires FFmpeg to be installed and available in your system PATH.": "导出视频需要安装 FFmpeg，且能从系统 PATH 访问。",
  "WebView cache (Windows) may be locked by running processes": "WebView 缓存（Windows）可能被运行中的进程锁定", "Your custom text": "你的自订文本", "Your settings and preferences will be preserved": "你的设置与偏好将会保留", "Your video has been successfully generated and saved to your device.": "视频已成功产生并保存到你的设备。", "p95 Frame Time": "p95 影格时间", "— WebGL Pipeline": "— WebGL 管线",
  "● Live Testing": "● 即时测试", "✂ Trimmed": "✂ 已修剪",
};

const EN_FROM_ZH_TW: Record<string, string> = Object.fromEntries(
  Object.entries(ZH_TW).map(([en, zh]) => [zh, en])
);

const EN_FROM_ZH_CN: Record<string, string> = Object.fromEntries(
  Object.entries(ZH_CN).map(([en, zh]) => [zh, en])
);

const ATTRIBUTES = ["title", "placeholder", "aria-label"] as const;
const originalText = new WeakMap<Text, string>();
const originalAttrs = new WeakMap<Element, Map<string, string>>();

function translateText(value: string, language: AppLanguage): string {
  const trimmed = value.trim();
  if (!trimmed) return value;

  if (language === "en") {
    const fromTw = EN_FROM_ZH_TW[trimmed];
    if (fromTw) return value.replace(trimmed, fromTw);
    const fromCn = EN_FROM_ZH_CN[trimmed];
    if (fromCn) return value.replace(trimmed, fromCn);
    return value
      .replace(/未命名專案|未命名项目/g, "Untitled Project")
      .replace(/今天/g, "Today")
      .replace(/昨天/g, "Yesterday")
      .replace(/標準|标准/g, "Standard")
      .replace(/可讀節奏|可读节奏/g, "Readable cadence")
      .replace(/倍/g, "times")
      .replace(/樣本|样本/g, "samples");
  }

  if (language === "zh-CN") {
    const translated = ZH_CN[trimmed];
    if (translated) return value.replace(trimmed, translated);
    return value
      .replace(/\bUntitled Project\b/g, "未命名项目")
      .replace(/\bToday\b/g, "今天")
      .replace(/\bYesterday\b/g, "昨天")
      .replace(/\bStandard\b/g, "标准")
      .replace(/\bReadable cadence\b/g, "可读节奏")
      .replace(/\btimes\b/g, "倍")
      .replace(/\bsamples\b/g, "样本");
  }

  // zh-TW
  const translated = ZH_TW[trimmed];
  if (translated) return value.replace(trimmed, translated);
  return value
    .replace(/\bUntitled Project\b/g, "未命名專案")
    .replace(/\bToday\b/g, "今天")
    .replace(/\bYesterday\b/g, "昨天")
    .replace(/\bStandard\b/g, "標準")
    .replace(/\bReadable cadence\b/g, "可讀節奏")
    .replace(/\btimes\b/g, "倍")
    .replace(/\bsamples\b/g, "樣本");
}

function localizeTree(root: Node, language: AppLanguage) {
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      if (!text.data.trim()) return;
      const previous = originalText.get(text);
      if (previous === undefined) {
        const trimmed = text.data.trim();
        const origEnTw = EN_FROM_ZH_TW[trimmed];
        const origEnCn = origEnTw ? undefined : EN_FROM_ZH_CN[trimmed];
        const origEn = origEnTw ?? origEnCn;
        const initialText = origEn ? text.data.replace(trimmed, origEn) : text.data;
        originalText.set(text, initialText);
      } else {
        const zhTwVersion = translateText(previous, "zh-TW");
        const zhCnVersion = translateText(previous, "zh-CN");
        const enVersion = translateText(previous, "en");
        if (text.data !== previous && text.data !== zhTwVersion && text.data !== zhCnVersion && text.data !== enVersion) {
          originalText.set(text, text.data);
        }
      }

      const source = originalText.get(text)!;
      const next = translateText(source, language);
      if (text.data !== next) {
        text.data = next;
      }
      return;
    }

    if (!(node instanceof Element) || ["SCRIPT", "STYLE", "TEXTAREA"].includes(node.tagName) || node.closest("[data-no-i18n], [contenteditable='true']")) return;

    let saved = originalAttrs.get(node);
    if (!saved) {
      saved = new Map();
      originalAttrs.set(node, saved);
    }

    for (const attr of ATTRIBUTES) {
      const value = node.getAttribute(attr);
      if (value === null) continue;
      const previous = saved.get(attr);
      if (previous === undefined) {
        const trimmed = value.trim();
        const origEnTw = EN_FROM_ZH_TW[trimmed];
        const origEnCn = origEnTw ? undefined : EN_FROM_ZH_CN[trimmed];
        const origEn = origEnTw ?? origEnCn;
        const initialValue = origEn ? value.replace(trimmed, origEn) : value;
        saved.set(attr, initialValue);
      } else {
        const zhTwVersion = translateText(previous, "zh-TW");
        const zhCnVersion = translateText(previous, "zh-CN");
        const enVersion = translateText(previous, "en");
        if (value !== previous && value !== zhTwVersion && value !== zhCnVersion && value !== enVersion) {
          saved.set(attr, value);
        }
      }
      const source = saved.get(attr)!;
      const next = translateText(source, language);
      if (value !== next) {
        node.setAttribute(attr, next);
      }
    }

    node.childNodes.forEach(visit);
  };

  visit(root);
}

type I18nValue = { language: AppLanguage; setLanguage: (language: AppLanguage) => void };
const I18nContext = createContext<I18nValue | null>(null);

function initialLanguage(): AppLanguage {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "zh-TW" || saved === "zh-CN") return saved;
  const nav = navigator.language.toLowerCase();
  if (nav === "zh-cn" || nav.startsWith("zh-cn-")) return "zh-CN";
  if (nav.startsWith("zh")) return "zh-TW";
  return "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, updateLanguage] = useState<AppLanguage>(initialLanguage);
  const setLanguage = useCallback((next: AppLanguage) => {
    localStorage.setItem(STORAGE_KEY, next);
    updateLanguage(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_menu_language", { language }))
      .catch(() => undefined);
    localizeTree(document.body, language);
    let isApplying = false;
    const observer = new MutationObserver((mutations) => {
      if (isApplying) return;
      isApplying = true;
      try {
        for (const mutation of mutations) {
          if (mutation.type === "characterData") localizeTree(mutation.target, language);
          mutation.addedNodes.forEach((node) => localizeTree(node, language));
        }
      } finally {
        queueMicrotask(() => {
          isApplying = false;
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] });
    return () => observer.disconnect();
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
