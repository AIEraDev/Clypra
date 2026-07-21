import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

import * as whisperSettingsModule from "@/components/settings/WhisperSettings";
import { WhisperSettings } from "@/components/settings/WhisperSettings";
import { resolveMessage } from "@/i18n";
import { settingsMessages } from "@/i18n/catalogs/settings";
import type { LocalizedMessage, MessageParams } from "@/i18n/types";
import {
  type ModelDownloadState,
  type WhisperModelSize,
  useCaptionStore,
} from "@/store/captionStore";
import whisperRustSource from "../../../src-tauri/src/commands/whisper.rs?raw";

type WhisperLanguage = {
  code: string;
  name: string;
  messageKey: string;
};

type WhisperModelInfo = {
  size: WhisperModelSize;
  params: string;
  vram: string;
  speedMessageKey: string;
  qualityMessageKey: string;
  recommended?: boolean;
};

const whisperExports = whisperSettingsModule as typeof whisperSettingsModule & {
  WHISPER_LANGUAGES?: readonly WhisperLanguage[];
  MODEL_INFO?: readonly WhisperModelInfo[];
  formatWhisperBytes?: (bytes: number) => string;
  localizeWhisperError?: (error?: string) => string;
};

const EXPECTED_LANGUAGES = [
  ["auto", "Auto-detect", "自动检测"],
  ["en", "English", "英语"],
  ["zh", "Chinese", "中文"],
  ["de", "German", "德语"],
  ["es", "Spanish", "西班牙语"],
  ["ru", "Russian", "俄语"],
  ["ko", "Korean", "韩语"],
  ["fr", "French", "法语"],
  ["ja", "Japanese", "日语"],
  ["pt", "Portuguese", "葡萄牙语"],
  ["tr", "Turkish", "土耳其语"],
  ["pl", "Polish", "波兰语"],
  ["ca", "Catalan", "加泰罗尼亚语"],
  ["nl", "Dutch", "荷兰语"],
  ["ar", "Arabic", "阿拉伯语"],
  ["sv", "Swedish", "瑞典语"],
  ["it", "Italian", "意大利语"],
  ["id", "Indonesian", "印度尼西亚语"],
  ["hi", "Hindi", "印地语"],
  ["fi", "Finnish", "芬兰语"],
  ["vi", "Vietnamese", "越南语"],
  ["he", "Hebrew", "希伯来语"],
  ["uk", "Ukrainian", "乌克兰语"],
  ["el", "Greek", "希腊语"],
  ["ms", "Malay", "马来语"],
  ["cs", "Czech", "捷克语"],
  ["ro", "Romanian", "罗马尼亚语"],
  ["da", "Danish", "丹麦语"],
  ["hu", "Hungarian", "匈牙利语"],
  ["ta", "Tamil", "泰米尔语"],
  ["no", "Norwegian", "挪威语"],
  ["th", "Thai", "泰语"],
  ["ur", "Urdu", "乌尔都语"],
  ["hr", "Croatian", "克罗地亚语"],
  ["bg", "Bulgarian", "保加利亚语"],
  ["lt", "Lithuanian", "立陶宛语"],
  ["la", "Latin", "拉丁语"],
  ["mi", "Maori", "毛利语"],
  ["ml", "Malayalam", "马拉雅拉姆语"],
  ["cy", "Welsh", "威尔士语"],
  ["sk", "Slovak", "斯洛伐克语"],
  ["te", "Telugu", "泰卢固语"],
  ["fa", "Persian", "波斯语"],
  ["lv", "Latvian", "拉脱维亚语"],
  ["bn", "Bengali", "孟加拉语"],
  ["sr", "Serbian", "塞尔维亚语"],
  ["az", "Azerbaijani", "阿塞拜疆语"],
  ["sl", "Slovenian", "斯洛文尼亚语"],
  ["kn", "Kannada", "卡纳达语"],
  ["et", "Estonian", "爱沙尼亚语"],
  ["mk", "Macedonian", "马其顿语"],
  ["br", "Breton", "布列塔尼语"],
  ["eu", "Basque", "巴斯克语"],
  ["is", "Icelandic", "冰岛语"],
  ["hy", "Armenian", "亚美尼亚语"],
  ["ne", "Nepali", "尼泊尔语"],
  ["mn", "Mongolian", "蒙古语"],
  ["bs", "Bosnian", "波斯尼亚语"],
  ["kk", "Kazakh", "哈萨克语"],
  ["sq", "Albanian", "阿尔巴尼亚语"],
  ["sw", "Swahili", "斯瓦希里语"],
  ["gl", "Galician", "加利西亚语"],
  ["mr", "Marathi", "马拉地语"],
  ["pa", "Punjabi", "旁遮普语"],
  ["si", "Sinhala", "僧伽罗语"],
  ["km", "Khmer", "高棉语"],
  ["sn", "Shona", "修纳语"],
  ["yo", "Yoruba", "约鲁巴语"],
  ["so", "Somali", "索马里语"],
  ["af", "Afrikaans", "南非荷兰语"],
  ["oc", "Occitan", "奥克语"],
  ["ka", "Georgian", "格鲁吉亚语"],
  ["be", "Belarusian", "白俄罗斯语"],
  ["tg", "Tajik", "塔吉克语"],
  ["sd", "Sindhi", "信德语"],
  ["gu", "Gujarati", "古吉拉特语"],
  ["am", "Amharic", "阿姆哈拉语"],
  ["yi", "Yiddish", "意第绪语"],
  ["lo", "Lao", "老挝语"],
  ["uz", "Uzbek", "乌兹别克语"],
  ["fo", "Faroese", "法罗语"],
  ["ht", "Haitian Creole", "海地克里奥尔语"],
  ["ps", "Pashto", "普什图语"],
  ["tk", "Turkmen", "土库曼语"],
  ["nn", "Nynorsk", "新挪威语"],
  ["mt", "Maltese", "马耳他语"],
  ["sa", "Sanskrit", "梵语"],
  ["lb", "Luxembourgish", "卢森堡语"],
  ["my", "Myanmar", "缅甸语"],
  ["bo", "Tibetan", "藏语"],
  ["tl", "Tagalog", "他加禄语"],
  ["mg", "Malagasy", "马达加斯加语"],
  ["as", "Assamese", "阿萨姆语"],
  ["tt", "Tatar", "鞑靼语"],
  ["ha", "Hausa", "豪萨语"],
  ["ba", "Bashkir", "巴什基尔语"],
  ["jw", "Javanese", "爪哇语"],
  ["su", "Sundanese", "巽他语"],
] as const;

const EXPECTED_UI_MESSAGES = {
  "settings.whisper.title": ["Auto-Captions Configuration", "自动字幕配置"],
  "settings.whisper.description": [
    "Configure Whisper speech recognition for automatic caption generation.",
    "配置 Whisper 语音识别以自动生成字幕。",
  ],
  "settings.whisper.language.label": ["Transcription Language", "转录语言"],
  "settings.whisper.language.select": ["Select language", "选择语言"],
  "settings.whisper.language.currentLabel": [
    "Transcription language: {{language}}",
    "转录语言：{{language}}",
  ],
  "settings.whisper.language.searchPlaceholder": [
    "Search languages...",
    "搜索语言…",
  ],
  "settings.whisper.language.searchLabel": [
    "Search transcription languages",
    "搜索转录语言",
  ],
  "settings.whisper.language.listLabel": [
    "Available transcription languages",
    "可选转录语言",
  ],
  "settings.whisper.language.noMatches": [
    'No languages match "{{query}}"',
    "没有与“{{query}}”匹配的语言",
  ],
  "settings.whisper.language.autoHint": [
    "Auto-detect works well for most content. Set a language explicitly to improve accuracy for accented speech or mixed-language content.",
    "自动检测适用于大多数内容。明确指定语言可提高带口音语音或混合语言内容的识别准确率。",
  ],
  "settings.whisper.models.title": ["Whisper Models", "Whisper 模型"],
  "settings.whisper.model.cardLabel": ["{{model}} model", "{{model}} 模型"],
  "settings.whisper.model.recommended": ["Recommended", "推荐"],
  "settings.whisper.model.activeBadge": ["Active", "使用中"],
  "settings.whisper.model.installed": ["Installed", "已安装"],
  "settings.whisper.model.params": ["{{params}} params", "{{params}} 参数"],
  "settings.whisper.model.speed.tiny": [
    "32× faster than large",
    "比 large 快 32 倍",
  ],
  "settings.whisper.model.speed.base": [
    "16× faster than large",
    "比 large 快 16 倍",
  ],
  "settings.whisper.model.speed.small": [
    "6× faster than large",
    "比 large 快 6 倍",
  ],
  "settings.whisper.model.speed.medium": [
    "2× faster than large",
    "比 large 快 2 倍",
  ],
  "settings.whisper.model.speed.largeV3": ["1× (baseline)", "1 倍（基准）"],
  "settings.whisper.model.quality.tiny": [
    "Fast, lower accuracy. Good for drafts.",
    "速度最快，准确率较低，适合草稿。",
  ],
  "settings.whisper.model.quality.base": [
    "Balanced for everyday use.",
    "速度与准确率均衡，适合日常使用。",
  ],
  "settings.whisper.model.quality.small": [
    "Good quality. Recommended for most users.",
    "质量良好，推荐大多数用户使用。",
  ],
  "settings.whisper.model.quality.medium": [
    "High accuracy. Better for accents.",
    "准确率高，更适合带口音的语音。",
  ],
  "settings.whisper.model.quality.largeV3": [
    "Best quality. Ideal for Nigerian/African accents and multilingual content.",
    "质量最佳，尤其适合尼日利亚及非洲口音和多语言内容。",
  ],
  "settings.whisper.download.button": ["Download", "下载"],
  "settings.whisper.download.downloading": ["Downloading", "正在下载"],
  "settings.whisper.download.progress": [
    "{{downloaded}} / {{total}}",
    "{{downloaded}} / {{total}}",
  ],
  "settings.whisper.download.progressWithSpeed": [
    "{{downloaded}} / {{total}} · {{speed}}/s",
    "{{downloaded}} / {{total}} · {{speed}}/s",
  ],
  "settings.whisper.download.progressLabel": [
    "Downloading {{model}}: {{percent}}%",
    "正在下载 {{model}}：{{percent}}%",
  ],
  "settings.whisper.download.cancel": ["Cancel", "取消"],
  "settings.whisper.download.cancelling": ["Cancelling...", "正在取消…"],
  "settings.whisper.download.retry": ["Retry", "重试"],
  "settings.whisper.model.use": ["Use this model", "使用此模型"],
  "settings.whisper.model.verifying": ["Verifying...", "正在验证…"],
  "settings.whisper.model.deleteTitle": [
    "Delete {{model}} model",
    "删除 {{model}} 模型",
  ],
  "settings.whisper.model.activeStatus": ["Model active", "模型已启用"],
  "settings.whisper.error.downloadFailed": ["Download failed", "下载失败"],
  "settings.whisper.error.downloadDetail": [
    "Download failed: {{error}}",
    "下载失败：{{error}}",
  ],
  "settings.whisper.error.cancelDetail": [
    "Failed to cancel download: {{error}}",
    "取消下载失败：{{error}}",
  ],
  "settings.whisper.error.filesMissing": [
    "Model files not found on disk. Please re-download.",
    "磁盘上未找到模型文件，请重新下载。",
  ],
  "settings.whisper.error.verifyFailed": [
    "Failed to verify model files.",
    "无法验证模型文件。",
  ],
  "settings.whisper.error.verifyDetail": [
    "Failed to verify model files: {{error}}",
    "验证模型文件失败：{{error}}",
  ],
  "settings.whisper.status.noneDownloaded": [
    "No model downloaded yet — download one above to enable auto-captions.",
    "尚未下载模型——请在上方下载一个模型以启用自动字幕。",
  ],
  "settings.whisper.status.noneActive": [
    'No active model selected. Click "Use this model" on a downloaded model to enable auto-captions.',
    "尚未选择启用的模型。请在已下载的模型上点击“使用此模型”以启用自动字幕。",
  ],
  "settings.whisper.status.activeModel": [
    "Active model: {{model}}",
    "当前模型：{{model}}",
  ],
  "settings.whisper.privacy.title": ["Local-First Privacy", "本地优先，保护隐私"],
  "settings.whisper.privacy.description": [
    "All models run locally on your device. Your audio never leaves your computer, ensuring complete privacy and offline functionality.",
    "所有模型均在你的设备上本地运行，音频不会离开电脑，既保护隐私，也可离线使用。",
  ],
} as const;

const DEFAULT_MODEL_STATE: ModelDownloadState = {
  status: "idle",
  progressBytes: 0,
  totalBytes: 0,
  speedBytesPerSec: 0,
};

function createDeferred() {
  let resolve: () => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = () => resolvePromise();
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function translate(key: string, params: MessageParams = {}) {
  return resolveMessage(
    (settingsMessages as Record<string, LocalizedMessage>)[key],
    key,
    params,
  );
}

function setCaptionState({
  language = "auto",
  activeModel = null,
  models = {},
}: {
  language?: string;
  activeModel?: WhisperModelSize | null;
  models?: Partial<Record<WhisperModelSize, Partial<ModelDownloadState>>>;
} = {}) {
  const modelState = Object.fromEntries(
    (["tiny", "base", "small", "medium", "large-v3"] as const).map(
      (size) => [size, { ...DEFAULT_MODEL_STATE, ...models[size] }],
    ),
  ) as Record<WhisperModelSize, ModelDownloadState>;

  useCaptionStore.setState((state) => ({
    ...state,
    captionSettings: {
      language,
      activeModel,
      languageHints: [],
      models: modelState,
    },
  }));
}

beforeEach(() => {
  localStorage.clear();
  setCaptionState();
  invokeMock.mockReset().mockResolvedValue(true);
  listenMock.mockReset().mockResolvedValue(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Whisper settings localization", () => {
  test("defines every Whisper UI label, status, description, and privacy message", () => {
    for (const [key, [en, zhCN]] of Object.entries(EXPECTED_UI_MESSAGES)) {
      expect((settingsMessages as Record<string, LocalizedMessage>)[key]).toEqual({
        en,
        zhCN,
      });
    }
  });

  test("keeps the configured language codes/order and gives every option a Chinese name", () => {
    expect(EXPECTED_LANGUAGES).toHaveLength(98);

    const languages = whisperExports.WHISPER_LANGUAGES;
    expect(languages).toBeDefined();
    if (!languages) return;

    expect(languages.map(({ code, name }) => [code, name])).toEqual(
      EXPECTED_LANGUAGES.map(([code, en]) => [code, en]),
    );
    expect(new Set(languages.map(({ code }) => code)).size).toBe(
      languages.length,
    );

    languages.forEach((language, index) => {
      const [code, en, zhCN] = EXPECTED_LANGUAGES[index];
      const messageKey = `settings.whisper.language.${code}`;

      expect(language.messageKey).toBe(messageKey);
      expect((settingsMessages as Record<string, LocalizedMessage>)[messageKey]).toEqual({
        en,
        zhCN,
      });
      expect(translate(messageKey).trim()).toBe(zhCN);
    });
  });

  test("preserves model IDs, technical sizes, filenames, and download URLs", () => {
    const models = whisperExports.MODEL_INFO;
    expect(models).toBeDefined();
    if (!models) return;

    expect(
      models.map(({ size, params, vram, recommended }) => ({
        size,
        params,
        vram,
        recommended: Boolean(recommended),
      })),
    ).toEqual([
      { size: "tiny", params: "39M", vram: "~1 GB", recommended: false },
      { size: "base", params: "74M", vram: "~1 GB", recommended: false },
      { size: "small", params: "244M", vram: "~2 GB", recommended: true },
      { size: "medium", params: "769M", vram: "~5 GB", recommended: false },
      { size: "large-v3", params: "1550M", vram: "~10 GB", recommended: false },
    ]);

    const expectedUrls = {
      tiny: "https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt",
      base: "https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt",
      small: "https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt",
      medium: "https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt",
      "large-v3": "https://openaipublic.azureedge.net/main/whisper/models/e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb/large-v3.pt",
    } as const;

    for (const [size, url] of Object.entries(expectedUrls)) {
      expect(whisperRustSource).toContain(`"${size}" => "${url}"`);
    }
    expect(whisperRustSource).toContain('models_dir.join(format!("{}.pt", size))');
  });

  test("interpolates model, progress, search, and raw error details without changing them", () => {
    const raw = '<img src=x onerror="window.__whisperPwned=true">';

    expect(translate("settings.whisper.model.params", { params: "244M" })).toBe(
      "244M 参数",
    );
    expect(
      translate("settings.whisper.download.progressWithSpeed", {
        downloaded: "1.0 MB",
        total: "4.0 MB",
        speed: "512.0 KB",
      }),
    ).toBe("1.0 MB / 4.0 MB · 512.0 KB/s");
    expect(
      translate("settings.whisper.model.deleteTitle", { model: "large-v3" }),
    ).toBe("删除 large-v3 模型");
    expect(
      translate("settings.whisper.language.noMatches", { query: raw }),
    ).toBe(`没有与“${raw}”匹配的语言`);
    expect(translate("settings.whisper.error.downloadDetail", { error: raw })).toBe(
      `下载失败：${raw}`,
    );
    expect(translate("settings.whisper.error.cancelDetail", { error: raw })).toBe(
      `取消下载失败：${raw}`,
    );
  });

  test("formats byte progress with the existing binary units", () => {
    const formatBytes = whisperExports.formatWhisperBytes;
    expect(formatBytes).toBeDefined();
    if (!formatBytes) return;

    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  test("renders all local Whisper headings, model descriptions, warnings, and privacy copy in Chinese", () => {
    render(React.createElement(WhisperSettings));

    expect(screen.getByText("自动字幕配置")).toBeInTheDocument();
    expect(
      screen.getByText("配置 Whisper 语音识别以自动生成字幕。"),
    ).toBeInTheDocument();
    expect(screen.getByText("转录语言")).toBeInTheDocument();
    expect(screen.getByText("Whisper 模型")).toBeInTheDocument();
    expect(screen.getByText("速度最快，准确率较低，适合草稿。")).toBeInTheDocument();
    expect(screen.getByText("速度与准确率均衡，适合日常使用。")).toBeInTheDocument();
    expect(screen.getByText("质量良好，推荐大多数用户使用。")).toBeInTheDocument();
    expect(screen.getByText("准确率高，更适合带口音的语音。")).toBeInTheDocument();
    expect(
      screen.getByText("质量最佳，尤其适合尼日利亚及非洲口音和多语言内容。"),
    ).toBeInTheDocument();
    expect(screen.getByText("尚未下载模型——请在上方下载一个模型以启用自动字幕。")).toBeInTheDocument();
    expect(screen.getByText("本地优先，保护隐私")).toBeInTheDocument();
    expect(
      screen.getByText(
        "所有模型均在你的设备上本地运行，音频不会离开电脑，既保护隐私，也可离线使用。",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "下载" })).toHaveLength(5);
    expect(screen.queryByText("Download")).not.toBeInTheDocument();
  });

  test("searches Chinese names, language codes, and original English names while storing the exact code", () => {
    render(React.createElement(WhisperSettings));

    const selector = screen.getByRole("combobox", {
      name: "转录语言：自动检测",
    });
    fireEvent.click(selector);

    const input = screen.getByRole("searchbox", { name: "搜索转录语言" });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(EXPECTED_LANGUAGES.length);
    expect(options.map((option) => option.getAttribute("data-language-code"))).toEqual(
      EXPECTED_LANGUAGES.map(([code]) => code),
    );

    fireEvent.change(input, { target: { value: "法语" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "法语" })).toHaveAttribute(
      "data-language-code",
      "fr",
    );

    fireEvent.change(input, { target: { value: "French" } });
    expect(screen.getByRole("option", { name: "法语" })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "pt" } });
    const portuguese = screen.getByRole("option", { name: "葡萄牙语" });
    fireEvent.click(portuguese);

    expect(useCaptionStore.getState().captionSettings.language).toBe("pt");
    expect(
      screen.getByRole("combobox", { name: "转录语言：葡萄牙语" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "转录语言：葡萄牙语" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索转录语言" }), {
      target: { value: "not-a-language" },
    });
    expect(
      screen.getByText("没有与“not-a-language”匹配的语言"),
    ).toBeInTheDocument();
  });

  test("localizes installed, active, downloading, and error states while rendering raw errors as text", () => {
    const rawError = '<img src=x onerror="window.__whisperPwned=true">';
    setCaptionState({
      activeModel: "small",
      models: {
        tiny: {
          status: "downloading",
          progressBytes: 1024 * 1024,
          totalBytes: 4 * 1024 * 1024,
          speedBytesPerSec: 512 * 1024,
        },
        base: { status: "downloaded" },
        small: { status: "downloaded" },
        medium: { status: "error", errorMessage: rawError },
      },
    });

    const { container } = render(React.createElement(WhisperSettings));

    expect(screen.getByText("正在下载")).toBeInTheDocument();
    expect(screen.getByText("1.0 MB / 4.0 MB · 512.0 KB/s")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "正在下载 tiny：25%" })).toBeInTheDocument();
    expect(screen.getByText("已安装")).toBeInTheDocument();
    expect(screen.getByText("使用中")).toBeInTheDocument();
    expect(screen.getByText("模型已启用")).toBeInTheDocument();
    expect(screen.getByText(`下载失败：${rawError}`)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(
      screen.getByRole("button", { name: "删除 base 模型" }),
    ).toHaveAttribute("title", "删除 base 模型");
    expect(
      screen.getByRole("button", { name: "删除 small 模型" }),
    ).toHaveAttribute("title", "删除 small 模型");
    expect(screen.getByText("当前模型：small")).toBeInTheDocument();
  });

  test("shows a translated verifying state and activates the same model ID", async () => {
    setCaptionState({ models: { base: { status: "downloaded" } } });
    render(React.createElement(WhisperSettings));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("verify_whisper_model_exists", {
        size: "base",
      });
    });

    let resolveVerification: (exists: boolean) => void = () => undefined;
    invokeMock.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveVerification = resolve;
        }),
    );

    fireEvent.click(screen.getByRole("button", { name: "使用此模型" }));
    expect(screen.getByRole("button", { name: "正在验证…" })).toBeDisabled();

    await act(async () => {
      resolveVerification(true);
    });

    await waitFor(() => {
      expect(useCaptionStore.getState().captionSettings.activeModel).toBe("base");
    });
  });

  test("keeps raw verification failure detail after the translated prefix", async () => {
    setCaptionState({ models: { base: { status: "downloaded" } } });
    render(React.createElement(WhisperSettings));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("verify_whisper_model_exists", {
        size: "base",
      });
    });

    invokeMock.mockRejectedValueOnce(new Error("EPERM: model file is locked"));
    fireEvent.click(screen.getByRole("button", { name: "使用此模型" }));

    expect(
      await screen.findByText(
        "验证模型文件失败：Error: EPERM: model file is locked",
      ),
    ).toBeInTheDocument();
  });

  test("keeps download commands and model IDs unchanged", async () => {
    render(React.createElement(WhisperSettings));

    const tinyCard = screen.getByRole("article", { name: "tiny 模型" });
    fireEvent.click(within(tinyCard).getByRole("button", { name: "下载" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("download_whisper_model", {
        size: "tiny",
      });
    });
    expect(useCaptionStore.getState().captionSettings.models.tiny.status).toBe(
      "downloaded",
    );
  });

  test("subscribes to whisper_model_progress and applies matching progress payloads", async () => {
    type ProgressListener = (event: {
      payload: {
        size: string;
        downloadedBytes: number;
        totalBytes: number;
        speedBytesPerSec: number;
      };
    }) => void;
    const progressListeners: ProgressListener[] = [];
    listenMock.mockImplementation((eventName, listener: ProgressListener) => {
      progressListeners.push(listener);
      return Promise.resolve(() => undefined);
    });

    render(React.createElement(WhisperSettings));

    await waitFor(() => {
      expect(listenMock).toHaveBeenCalledTimes(5);
    });
    expect(listenMock.mock.calls.map(([eventName]) => eventName)).toEqual(
      Array(5).fill("whisper_model_progress"),
    );

    act(() => {
      for (const listener of progressListeners) {
        listener({
          payload: {
            size: "base",
            downloadedBytes: 3 * 1024 * 1024,
            totalBytes: 12 * 1024 * 1024,
            speedBytesPerSec: 768 * 1024,
          },
        });
      }
    });

    expect(useCaptionStore.getState().captionSettings.models.base).toMatchObject({
      progressBytes: 3 * 1024 * 1024,
      totalBytes: 12 * 1024 * 1024,
      speedBytesPerSec: 768 * 1024,
    });
    expect(useCaptionStore.getState().captionSettings.models.tiny.progressBytes).toBe(0);
  });

  test("moves a failed download into the localized error state with raw detail", async () => {
    invokeMock.mockImplementation((command) =>
      command === "download_whisper_model"
        ? Promise.reject(new Error("HTTP 503: upstream unavailable"))
        : Promise.resolve(true),
    );
    render(React.createElement(WhisperSettings));

    const tinyCard = screen.getByRole("article", { name: "tiny 模型" });
    fireEvent.click(within(tinyCard).getByRole("button", { name: "下载" }));

    expect(
      await within(tinyCard).findByText(
        "下载失败：Error: HTTP 503: upstream unavailable",
      ),
    ).toBeInTheDocument();
    expect(useCaptionStore.getState().captionSettings.models.tiny).toMatchObject({
      status: "error",
      errorMessage: "Error: HTTP 503: upstream unavailable",
    });
  });

  test("retries the same model and returns it to downloaded state", async () => {
    setCaptionState({
      models: {
        tiny: {
          status: "error",
          errorMessage: "HTTP 503: upstream unavailable",
        },
      },
    });
    render(React.createElement(WhisperSettings));

    const tinyCard = screen.getByRole("article", { name: "tiny 模型" });
    fireEvent.click(within(tinyCard).getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(useCaptionStore.getState().captionSettings.models.tiny.status).toBe(
        "downloaded",
      );
    });
    expect(invokeMock).toHaveBeenCalledWith("download_whisper_model", {
      size: "tiny",
    });
  });

  test("shows one disabled cancelling action and hides download or retry while cancellation is pending", async () => {
    const download = createDeferred();
    const cancellation = createDeferred();
    invokeMock.mockImplementation((command) => {
      if (command === "download_whisper_model") {
        return download.promise;
      }
      if (command === "cancel_whisper_download") {
        return cancellation.promise;
      }
      return Promise.resolve(true);
    });
    render(React.createElement(WhisperSettings));

    const tinyCard = screen.getByRole("article", { name: "tiny 模型" });
    fireEvent.click(within(tinyCard).getByRole("button", { name: "下载" }));
    fireEvent.click(await within(tinyCard).findByRole("button", { name: "取消" }));

    const cancellingButton = await within(tinyCard).findByRole("button", {
      name: "正在取消…",
    });
    expect(cancellingButton).toBeDisabled();
    expect(within(tinyCard).queryByRole("button", { name: "取消" })).toBeNull();
    expect(within(tinyCard).queryByRole("button", { name: "下载" })).toBeNull();
    expect(within(tinyCard).queryByRole("button", { name: "重试" })).toBeNull();
    expect(useCaptionStore.getState().captionSettings.models.tiny.status).not.toBe(
      "idle",
    );

    fireEvent.click(cancellingButton);
    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "cancel_whisper_download",
      ),
    ).toHaveLength(1);
  });

  test("resets to idle only after the backend confirms cancellation cleanup", async () => {
    const download = createDeferred();
    const cancellation = createDeferred();
    invokeMock.mockImplementation((command) => {
      if (command === "download_whisper_model") return download.promise;
      if (command === "cancel_whisper_download") return cancellation.promise;
      return Promise.resolve(true);
    });
    render(React.createElement(WhisperSettings));

    const tinyCard = screen.getByRole("article", { name: "tiny 模型" });
    fireEvent.click(within(tinyCard).getByRole("button", { name: "下载" }));
    fireEvent.click(await within(tinyCard).findByRole("button", { name: "取消" }));

    await act(async () => {
      download.reject(new Error("Download cancelled"));
    });

    expect(useCaptionStore.getState().captionSettings.models.tiny.status).not.toBe(
      "idle",
    );
    expect(
      within(tinyCard).getByRole("button", { name: "正在取消…" }),
    ).toBeDisabled();

    await act(async () => {
      cancellation.resolve();
    });

    await waitFor(() => {
      expect(useCaptionStore.getState().captionSettings.models.tiny).toEqual(
        DEFAULT_MODEL_STATE,
      );
    });
    expect(within(tinyCard).getByRole("button", { name: "下载" })).toBeEnabled();
  });

  test("continues to downloaded when cancellation fails but the download later succeeds", async () => {
    const download = createDeferred();
    invokeMock.mockImplementation((command) => {
      if (command === "download_whisper_model") return download.promise;
      if (command === "cancel_whisper_download") {
        return Promise.reject(new Error("IPC unavailable"));
      }
      return Promise.resolve(true);
    });
    render(React.createElement(WhisperSettings));

    const tinyCard = screen.getByRole("article", { name: "tiny 模型" });
    fireEvent.click(within(tinyCard).getByRole("button", { name: "下载" }));
    fireEvent.click(await within(tinyCard).findByRole("button", { name: "取消" }));

    expect(
      await within(tinyCard).findByText(
        "取消下载失败：Error: IPC unavailable",
      ),
    ).toBeInTheDocument();
    expect(useCaptionStore.getState().captionSettings.models.tiny.status).toBe(
      "downloading",
    );
    expect(within(tinyCard).getByRole("button", { name: "取消" })).toBeEnabled();

    await act(async () => {
      download.resolve();
    });

    await waitFor(() => {
      expect(useCaptionStore.getState().captionSettings.models.tiny.status).toBe(
        "downloaded",
      );
    });
  });

  test("continues to the download error when no active cancellation task exists", async () => {
    const download = createDeferred();
    invokeMock.mockImplementation((command) => {
      if (command === "download_whisper_model") return download.promise;
      if (command === "cancel_whisper_download") {
        return Promise.reject("No active download found for: tiny");
      }
      return Promise.resolve(true);
    });
    render(React.createElement(WhisperSettings));

    const tinyCard = screen.getByRole("article", { name: "tiny 模型" });
    fireEvent.click(within(tinyCard).getByRole("button", { name: "下载" }));
    fireEvent.click(await within(tinyCard).findByRole("button", { name: "取消" }));

    expect(
      await within(tinyCard).findByText(
        "取消下载失败：No active download found for: tiny",
      ),
    ).toBeInTheDocument();
    expect(useCaptionStore.getState().captionSettings.models.tiny.status).toBe(
      "downloading",
    );

    await act(async () => {
      download.reject(new Error("HTTP 503: upstream unavailable"));
    });

    expect(
      await within(tinyCard).findByText(
        "下载失败：Error: HTTP 503: upstream unavailable",
      ),
    ).toBeInTheDocument();
    expect(useCaptionStore.getState().captionSettings.models.tiny).toMatchObject({
      status: "error",
      errorMessage: "Error: HTTP 503: upstream unavailable",
    });
  });

  test("deletes the exact active model and clears its downloaded state", async () => {
    setCaptionState({
      activeModel: "base",
      models: { base: { status: "downloaded" } },
    });
    render(React.createElement(WhisperSettings));

    fireEvent.click(screen.getByRole("button", { name: "删除 base 模型" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete_whisper_model", {
        size: "base",
      });
      expect(useCaptionStore.getState().captionSettings.models.base.status).toBe(
        "idle",
      );
      expect(useCaptionStore.getState().captionSettings.activeModel).toBeNull();
    });
  });

  test("maps only stable app-authored errors and preserves unknown detail verbatim", () => {
    const localizeError = whisperExports.localizeWhisperError;
    expect(localizeError).toBeDefined();
    if (!localizeError) return;

    expect(localizeError()).toBe("下载失败");
    expect(
      localizeError("Model files not found on disk. Please re-download."),
    ).toBe("磁盘上未找到模型文件，请重新下载。");
    expect(localizeError("Failed to verify model files.")).toBe(
      "无法验证模型文件。",
    );
    expect(
      localizeError(
        "Failed to verify model files: Error: EPERM: model file is locked",
      ),
    ).toBe("验证模型文件失败：Error: EPERM: model file is locked");
    expect(localizeError("HTTP 503: upstream unavailable")).toBe(
      "下载失败：HTTP 503: upstream unavailable",
    );
  });
});
