import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type AppLanguage = "en" | "zh-TW";

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

const ATTRIBUTES = ["title", "placeholder", "aria-label"] as const;
const originalText = new WeakMap<Text, string>();
const originalAttrs = new WeakMap<Element, Map<string, string>>();

// While translations are being written, the MutationObserver must ignore the
// mutations those writes produce (text.data / setAttribute) — otherwise each
// write re-triggers localizeTree in a feedback loop that races React's own
// text-node updates and causes visible flicker / cursor jumps.
let isApplyingTranslations = false;

function translateText(value: string, language: AppLanguage): string {
  if (language === "en") return value;
  const trimmed = value.trim();
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
      if (previous === undefined || (text.data !== previous && text.data !== translateText(previous, language))) originalText.set(text, text.data);
      const next = translateText(originalText.get(text)!, language);
      if (text.data !== next) text.data = next;
      return;
    }
    if (!(node instanceof Element) || ["SCRIPT", "STYLE", "TEXTAREA"].includes(node.tagName) || node.closest("[data-no-i18n], [contenteditable='true']")) return;
    let saved = originalAttrs.get(node);
    if (!saved) { saved = new Map(); originalAttrs.set(node, saved); }
    for (const attr of ATTRIBUTES) {
      const value = node.getAttribute(attr);
      const previous = saved.get(attr);
      if (value !== null && (previous === undefined || (value !== previous && value !== translateText(previous, language)))) saved.set(attr, value);
      const source = saved.get(attr);
      if (source !== undefined) node.setAttribute(attr, translateText(source, language));
    }
    node.childNodes.forEach(visit);
  };
  visit(root);
}

type I18nValue = { language: AppLanguage; setLanguage: (language: AppLanguage) => void };
const I18nContext = createContext<I18nValue | null>(null);

function initialLanguage(): AppLanguage {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "zh-TW") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-TW" : "en";
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
    const observer = new MutationObserver((mutations) => {
      if (isApplyingTranslations) return;
      isApplyingTranslations = true;
      try {
        for (const mutation of mutations) {
          if (mutation.type === "characterData") localizeTree(mutation.target, language);
          mutation.addedNodes.forEach((node) => localizeTree(node, language));
        }
      } finally {
        // Reset on a later microtask so the mutations generated by localizeTree
        // above are delivered to this observer while the flag is still set,
        // letting us skip them and break the characterData feedback loop
        // instead of re-running localizeTree on our own writes.
        queueMicrotask(() => {
          isApplyingTranslations = false;
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
