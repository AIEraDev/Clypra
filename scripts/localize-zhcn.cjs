// Clypra 简体中文语言包完善脚本
// 1. 对现有 ZH_CN 词条做大陆用语修正（OpenCC 繁体机械转换残留）
// 2. 补齐 UI 中缺失的 key（toast/工具提示/设置项/快捷键名等）
// 3. 重新生成 I18nProvider.tsx 中的 ZH_CN 字典块
const fs = require("fs");
const file = "H:/AI/Clypra/src/i18n/I18nProvider.tsx";
const src = fs.readFileSync(file, "utf8");

// ---------- 解析现有 ZH_CN 词条 ----------
const startMarker = "const ZH_CN: Record<string, string> = {";
const start = src.indexOf(startMarker);
const blockStart = src.indexOf("{", start);
const blockEnd = src.indexOf("};", blockStart);
const zhCnBlock = src.slice(blockStart + 1, blockEnd);

function parseEntries(block) {
  const entries = [];
  const re = /"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(block))) entries.push([m[1], m[2]]);
  return entries;
}
const entries = parseEntries(zhCnBlock);
const map = new Map(entries);
console.log("现有 ZH_CN 词条:", map.size);

// ---------- 词条修正规则（有序：先精确后子串） ----------
const EXACT_FIXES = [
  // 残留英文
  ["Natural green hues", "自然的绿色色调"],
  ["Professional broadcast-grade cold precision", "专业广播级的冷调精准风格"],
  // OpenCC 误转 / 台湾用语（精确值）
  ["Export Preset", "导出预设"],
  ["Preset Effects", "预设效果"],
  ["Style Presets", "样式预设集"],
  ["No matching presets found.", "未找到匹配的预设。"],
  ["No matching presets found", "未找到匹配的预设"],
  ["Click to rebind", "点击以重新绑定"],
  ["Input level:", "输入电平："],
  ["Active Videos", "活动视频"],
  ["Standard (400)", "常规（400）"],
  ["Regular (400)", "常规（400）"],
  ["Fit", "适配"],
  ["Fill", "填充"],
  ["Fill Color", "填充颜色"],
  ["Text Color", "文本颜色"],
];
const SUB_FIXES = [
  // 特定词序优先（含"缺省"的 preset 语境）
  ["样式缺省集", "样式预设集"],
  ["导出缺省集", "导出预设"],
  ["缺省效果", "预设效果"],
  ["效果缺省", "效果预设"],
  // 转录 typo（"转录语语音"）
  ["转录语语音", "转写语音"],
  // 通用大陆术语
  ["串行", "序列"],
  ["缺省影格率", "默认帧率"],
  ["缺省深色主题", "默认深色主题"],
  ["缺省", "默认"],
  ["影格率", "帧率"],
  ["影格", "帧"],
  ["算图", "渲染"],
  ["拷贝", "复制"],
  ["拖曳", "拖动"],
  ["自订", "自定义"],
  ["套用", "应用"],
  ["套送", "应用"],
  ["保存空间", "存储空间"],
  ["接口显示", "界面显示"],
  ["接口", "界面"],
  ["摄影机", "摄像机"],
  ["主控台", "控制台"],
  ["激活", "启用"],
  ["脱机", "离线"],
  ["辨识", "识别"],
  ["转录", "转写"],
  ["工作阶段", "会话"],
  ["复原", "恢复"],
  ["舍弃", "丢弃"],
  ["遗失", "丢失"],
  ["已核准", "已审核"],
  ["掉格", "丢帧"],
  ["即时测试", "实时测试"],
  ["渐层", "渐变"],
  ["备援", "回退"],
  ["行动设备", "移动设备"],
  ["进程式", "程序化"],
  ["侦测", "检测"],
  ["高准确度", "高准确率"],
  ["时间戳记", "时间戳"],
  ["重新命名", "重命名"],
  ["剪接点", "剪辑点"],
  ["尺规", "标尺"],
  ["贴图", "贴纸"],
  ["最爱", "收藏"],
  ["产生", "生成"],
  ["置中", "居中"],
  ["按两下", "双击"],
  ["低眼睛负担", "低眼部疲劳"],
  ["手动新增", "手动添加"],
  ["屏幕截取", "屏幕捕获"],
  ["项目档", "项目文件"],
  ["工具列", "工具栏"],
  ["桌面版", "桌面端"],
  ["退场", "出场"],
  ["填满", "填充"],
  ["文本色彩", "文本颜色"],
  ["取得", "获取"],
  ["按一下以重新设置", "点击以重新绑定"],
  ["按一下", "点击"],
  ["变更", "更改"],
  ["连动", "联动"],
  ["重设", "重置"],
  ["选取", "选择"],
];

// ---------- 新增缺失 key ----------
const NEW_KEYS = {
  // 窗口控制
  "Minimize": "最小化", "Minimize window": "最小化窗口", "Close window": "关闭窗口", "Window controls": "窗口控制",
  // 面板布局
  "Layout": "布局", "Player": "播放器", "Collapse media panel": "折叠媒体面板", "Expand media panel": "展开媒体面板",
  "Collapse properties panel": "折叠属性面板", "Expand properties panel": "展开属性面板",
  "Expand Canvas & Background Settings": "展开画布与背景设置", "Expand Transition Properties": "展开转场属性",
  "Color & Adjustments": "颜色与调整", "Effects & Filters": "效果与滤镜", "Transform & Fit": "变换与适配",
  "Color Adjustments": "颜色调整", "Switch Workspace Layout (CapCut views)": "切换工作区布局（剪映视图）",
  "Fit sequence (Shift+Z)": "适配序列（Shift+Z）", "Fit sequence": "适配序列", "Timeline drop area": "时间轴拖放区域",
  "Preview resolution (does not affect final export)": "预览分辨率（不影响最终导出）",
  // 拖动调整面板
  "Drag to resize inspector panel": "拖动以调整检查器面板大小",
  "Drag to resize media panel": "拖动以调整媒体面板大小",
  "Drag to resize media panel • Double-click to reset": "拖动以调整媒体面板大小 • 双击重置",
  "Drag to resize media panel • Double-click to reset (260px)": "拖动以调整媒体面板大小 • 双击重置（260px）",
  "Drag to resize media panel • Double-click to reset (400px)": "拖动以调整媒体面板大小 • 双击重置（400px）",
  "Drag to resize player • Double-click to reset (480px)": "拖动以调整播放器大小 • 双击重置（480px）",
  "Drag to resize properties panel": "拖动以调整属性面板大小",
  "Drag to resize properties panel • Double-click to reset": "拖动以调整属性面板大小 • 双击重置",
  "Drag to resize properties panel • Double-click to reset (260px)": "拖动以调整属性面板大小 • 双击重置（260px）",
  "Drag to resize properties panel • Double-click to reset (400px)": "拖动以调整属性面板大小 • 双击重置（400px）",
  "Drag to resize timeline": "拖动以调整时间轴大小",
  "Drag to resize timeline • Double-click to reset": "拖动以调整时间轴大小 • 双击重置",
  // 音频
  "Add a volume keyframe at the clip midpoint": "在片段中点添加音量关键帧",
  "Audio FX & Equalizer": "音频特效与均衡器", "Audio Link": "音频链接", "Channel & Speed": "声道与速度",
  "Channel mode": "声道模式", "Channel downmix": "声道下混", "Channel map": "声道映射",
  "Fade & Curves": "淡入淡出与曲线", "Fade in duration in seconds": "淡入时长（秒）", "Fade out duration in seconds": "淡出时长（秒）",
  "Fade in handle": "淡入手柄", "Fade out handle": "淡出手柄", "Clip volume": "片段音量", "Volume Automation": "音量自动化",
  "Preserve pitch": "保持音高", "When the playback speed changes": "当播放速度改变时", "Relink": "重新链接", "Unlink": "取消链接",
  "Auto (source layout)": "自动（源布局）", "Stereo": "立体声", "Multichannel": "多声道", "Mono (dual mono output)": "单声道（双单声道输出）",
  "Exponential": "指数", "Logarithmic": "对数", "S-Curve": "S 曲线", "e.g. 1, 0 to swap L/R": "例如：1, 0 交换左右声道",
  // 调整与调色
  "Advanced Grading": "高级调色", "Basic Adjustments": "基础调整", "Brightness": "亮度", "Contrast": "对比度",
  "Exposure": "曝光", "Exposure (EV)": "曝光（EV）", "Saturation": "饱和度", "Temperature": "色温", "Tint": "色调",
  "Sepia": "棕褐色", "Grayscale": "灰度", "Hue": "色相", "Vignette": "暗角", "Lift": "暗部", "Gamma": "中间调", "Gain": "亮部",
  "Vibrance Amount": "自然饱和度", "Grain Intensity": "颗粒强度", "Grain Size": "颗粒大小", "Cross Process Amount": "交叉冲印程度",
  "Color & White Balance": "颜色与白平衡", "Creative": "创意", "Protected Skin Tone Hue": "保护肤色色相",
  "Reset all manual overrides": "重置所有手动覆盖", "Reset override": "重置覆盖", "Double-click to reset": "双击重置",
  "Reset color wheel": "重置色轮", "Lum": "亮度", "Lumetri Color & 3D LUT": "Lumetri 颜色与 3D LUT",
  "No LUT Preset Applied": "未应用 LUT 预设", "Remove LUT": "移除 LUT", "LUT Intensity": "LUT 强度",
  "UltraKey (Chroma Key)": "UltraKey（色度键）", "Tolerance": "容差", "Edge Softness": "边缘柔化",
  "Despill Cleanup": "去溢色清理", "Matte Highlight": "遮罩高光", "Matte Pedestal": "遮罩基准",
  "Stereo Pan": "立体声平衡", "Bass (100Hz)": "低频（100Hz）", "Mid (1kHz)": "中频（1kHz）", "Treble (8kHz)": "高频（8kHz）",
  "Noise Reduction": "降噪",
  // 画布与背景
  "Canvas & Background": "画布与背景", "Transparent Canvas": "透明画布", "Alpha background for PNG/Overlays": "PNG/叠加层透明背景",
  "Gradient Type": "渐变类型", "Start Color": "起始颜色", "End Color": "结束颜色", "Angle": "角度", "Animation Speed": "动画速度",
  // 缓存设置
  "Filmstrip & Media Cache": "胶片条与媒体缓存", "High-performance WebP atlases and persistent timeline frames.": "高性能 WebP 图集与持久化时间轴帧。",
  "Timeline Frame Cache": "时间轴帧缓存", "Disk Usage": "磁盘使用量", "Disk Cache Storage Limit": "磁盘缓存存储上限",
  "Unlimited": "无限制", "Cache Hit Rate": "缓存命中率", "Avg Time-to-Visible": "平均可见时间", "WebP Atlases": "WebP 图集",
  "localStorage Items": "localStorage 项目", "sessionStorage Items": "sessionStorage 项目",
  "Purge Filmstrip Disk Cache": "清除胶片条磁盘缓存", "Deletes all cached timeline WebP atlases and resets tier cache": "删除所有缓存的时间轴 WebP 图集并重置分级缓存",
  "Refresh Filmstrip Stats": "刷新胶片条统计", "Auto-clear Cache on Project Close": "关闭项目时自动清除缓存",
  "Automatically frees temporary GPU frame cache when switching or closing projects.": "切换或关闭项目时自动释放临时 GPU 帧缓存。",
  // 启动页
  "Start from your files": "从你的文件开始", "Open File": "打开文件", "Start from a preset": "从预设开始", "Templates": "模板",
  "Soon": "即将推出", "Coming soon": "即将推出", "Continue a project": "继续项目", "See all projects": "查看所有项目",
  "No projects yet": "还没有项目", "Your recent projects will appear here": "你最近的项目将显示在这里",
  "Project needs recovery": "项目需要恢复", "Original file was not opened or changed.": "未打开或更改原始文件。", "Empty Timeline": "空时间轴",
  // 更新
  "You can keep editing while the update downloads.": "更新下载期间你可以继续编辑。",
  "The app will not restart until you choose to apply the update.": "在你选择应用更新前，应用不会重启。",
  "Update downloaded": "更新已下载", "Update needs attention": "更新需要处理", "Saving project and preparing restart...": "正在保存项目并准备重启…",
  "Download update without interrupting your session": "在不中断当前会话的情况下下载更新",
  "Keep working and apply the update later": "继续工作，稍后应用更新", "Save the project and restart with the update": "保存项目并使用更新重启",
  // 赞助
  "Support the Project": "支持项目", "GitHub Sponsors": "GitHub 赞助", "Tiered": "分级", "Support on Patreon": "在 Patreon 上支持",
  "Monthly": "每月", "Buy Me a Coffee": "请我喝杯咖啡", "One-time": "一次性", "Free & open-source ♥": "免费且开源 ♥",
  "Clypra is built with love and released for free. If it saves you time, consider supporting its development.": "Clypra 倾注心血打造并免费发布。如果它为你节省了时间，请考虑支持它的开发。",
  // 片段重命名
  "Rename Clip": "重命名片段", "Clip name": "片段名称",
  // 杂项 JSX
  "Add": "添加", "Simplified Chinese": "简体中文", "Record Voiceover": "录制旁白", "Recording Voiceover...": "正在录制旁白…",
  "OFFLINE": "离线", "Choose audio stream": "选择音频流", "Clip palette": "片段调色板",
  "Choose clip colours independently from the interface theme.": "选择与界面主题无关的片段颜色。",
  "Choose industry standard keybindings": "选择行业标准快捷键方案", "Hotkey Layout Preset": "快捷键布局预设",
  "AI Contextual Auto-Detect": "AI 上下文自动检测", "Universal Smart Overlays": "通用智能叠加层", "Author": "作者",
  "Code Snippet": "代码片段", "Delta Badge": "变化徽标", "Metric Label": "指标标签", "Metric Value": "指标值",
  "Quote Text": "引用文本", "Speaker Name": "演讲者姓名", "Speaker Title": "演讲者头衔",
  "Unable to load source video": "无法加载源视频", "Text exceeds 8192px canvas budget and was clamped.": "文本超出 8192px 画布预算，已被限制。",
  "File is missing or moved": "文件缺失或已被移动", "Source media file is missing or offline": "源媒体文件缺失或离线",
  "Toggle Keyframe": "切换关键帧", "Toggle animated word-by-word karaoke overlay in preview": "在预览中切换逐字卡拉OK叠加层",
  "Cancel audio extraction": "取消音频提取", "Add Manual": "手动添加", "Import SRT": "导入 SRT", "Export SRT": "导出 SRT",
  "Manual": "手动", "Karaoke": "卡拉OK",
  // Toast
  "Effects can only be applied to video or image clips": "效果只能应用于视频或图片片段",
  "Failed to delete project": "删除项目失败", "Failed to load text effect. Please try again.": "加载文本效果失败，请重试。",
  "Failed to rename project": "重命名项目失败", "Failed to restore session": "恢复会话失败",
  "Failed to save before closing": "关闭前保存失败", "Failed to save project before closing": "关闭前保存项目失败",
  "Filter not downloaded yet": "滤镜尚未下载", "Project renamed": "项目已重命名", "Project saved": "项目已保存",
  "Recovered copy opened and saved safely": "已安全打开并保存恢复副本",
  "Select a video or image clip to apply this effect": "请选择视频或图片片段以应用此效果",
  "Visual clips must stay above the main video track": "视觉片段必须位于主视频轨道上方",
  // 遥测浮层
  "Filmstrip Pipeline Telemetry (Cmd+Shift+M)": "胶片条流水线遥测（Cmd+Shift+M）", "A/V drift max / p95": "音视频漂移最大值 / p95",
  "Pacing jank": "节奏卡顿", "Dropped frames": "丢帧", "Seek correct": "寻址正确", "Live 1s Polling Active": "每秒实时轮询中",
  "Press": "按下", "to toggle": "切换", "Eval:": "评估：", "Raster:": "栅格化：", "Requests:": "请求：",
  "Seek avg/max:": "寻址平均/最大：", "Seek correct:": "寻址正确：", "Stale/Cancel:": "过期/取消：", "Paint/Pacing:": "绘制/节奏：",
  "UI Drift:": "UI 漂移：", "A/V p95:": "音视频 p95：", "Avg": "平均", "Max": "最大", "Metric": "指标", "Tier": "层级",
  "Reqs": "请求数", "Cache(ms)": "缓存(ms)", "Paint(ms)": "绘制(ms)", "Hit%": "命中率", "Decode": "解码", "Downsample": "降采样",
  "Evict": "驱逐", "Seek": "寻址", "SRC": "源", "Native": "原生", "Frontend": "前端",
  // 历史命令名（撤销/重做标签）
  "Add Clip": "添加片段", "Add Track": "添加轨道", "Add Transition": "添加转场", "Delete Clip": "删除片段",
  "Delete Track": "删除轨道", "Delete Transition": "删除转场", "Detach Audio": "分离音频", "Duplicate Clips": "复制片段",
  "Group Clips": "组合片段", "Insert Gap": "插入空隙", "Insert Media": "插入媒体", "Merge Split Clips": "合并已分割片段",
  "Move Clip": "移动片段", "Move Clips": "移动片段", "Pack Track": "压缩轨道", "Relink Audio": "重新链接音频",
  "Resize Gap": "调整空隙大小", "Restore Gap": "恢复空隙", "Restore Insert Edit": "恢复插入编辑",
  "Restore Ripple Delete": "恢复波纹删除", "Restore Swapped Clips": "恢复已交换片段", "Restore Track": "恢复轨道",
  "Ripple Delete Clip": "波纹删除片段", "Ripple Delete Clips": "波纹删除片段", "Split Clip": "分割片段",
  "Swap Clips": "交换片段", "Toggle Gap Protection": "切换空隙保护", "Transform Clip": "变换片段", "Trim Clip": "修剪片段",
  "Undo Detach Audio": "撤销分离音频", "Undo Duplicate Clips": "撤销复制片段", "Undo Relink Audio": "撤销重新链接音频",
  "Ungroup Clips": "取消组合片段", "Unlink Audio": "取消链接音频", "Unpack Track": "展开轨道", "Update Clip": "更新片段",
  // 设置项
  "Preview Resolution": "预览分辨率", "Proxy Editing Mode": "代理编辑模式", "Anonymous Performance Telemetry": "匿名性能遥测",
  "Auto-clear cache on project close": "关闭项目时自动清除缓存", "Automatically frees GPU frame cache when closing a project.": "关闭项目时自动释放 GPU 帧缓存。",
  // 快捷键名
  "Play / Pause": "播放 / 暂停", "Step Back One Frame": "后退一帧", "Step Forward One Frame": "前进一帧",
  "Mark In Point (Source)": "标记入点（源）", "Mark Out Point (Source)": "标记出点（源）", "Exit Source Mode": "退出源模式",
  "Redo (Alt)": "重做（Alt）", "Split at Playhead": "在播放头分割", "Split Selected at Playhead": "在播放头分割选中片段",
  "Group Selected Clips": "组合选中片段", "Copy Selected Clips": "复制选中片段", "Paste Clips": "粘贴片段",
  "Select All Clips": "全选片段", "Deselect All Clips": "取消全选片段", "Clear Selection": "清除选择",
  "Nudge Right 1 Frame": "右移一帧", "Nudge Left 1 Frame": "左移一帧", "Nudge Right 10 Frames": "右移十帧", "Nudge Left 10 Frames": "左移十帧",
  "Select Clip on Track Above": "选择上方轨道的片段", "Select Clip on Track Below": "选择下方轨道的片段",
  "Toggle Ripple Edit": "切换波纹编辑", "Add Timeline Marker": "添加时间轴标记", "Toggle Track Lock": "切换轨道锁定",
  "Toggle Track Visibility": "切换轨道可见性", "Toggle Track Mute": "切换轨道静音", "Add New Track": "添加新轨道",
};

// ---------- 应用修正 ----------
for (const [k, v] of map) {
  let nv = v;
  for (const [from, to] of EXACT_FIXES) {
    if (k === from && nv === v) { nv = to; }
  }
  for (const [from, to] of SUB_FIXES) {
    if (nv.includes(from)) nv = nv.split(from).join(to);
  }
  map.set(k, nv);
}
// ---------- 合并新增 ----------
let added = 0, skipped = 0;
for (const [k, v] of Object.entries(NEW_KEYS)) {
  if (map.has(k)) { skipped++; continue; }
  map.set(k, v); added++;
}
console.log(`修正后词条: ${map.size}（新增 ${added}，跳过已存在 ${skipped}）`);

// ---------- 序列化 ----------
const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const lines = sorted.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
const newBlock = `const ZH_CN: Record<string, string> = {\n${lines.join("\n")}\n};`;

const newSrc = src.slice(0, start) + newBlock + src.slice(blockEnd + 2);
fs.writeFileSync(file, newSrc, "utf8");
console.log("已写入", file);

// 校验
const chk = fs.readFileSync(file, "utf8");
const b2 = chk.slice(chk.indexOf("const ZH_CN"), chk.indexOf("const EN_FROM_ZH_TW"));
const n = parseEntries(b2).length;
console.log("校验：新 ZH_CN 词条数 =", n);
