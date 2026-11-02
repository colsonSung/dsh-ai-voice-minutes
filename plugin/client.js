/**
 * Local AI Voice Minutes — full-page Harness Client.
 */
window.__ModuleLoader__.load({
  id: '@local/ai-voice-minutes',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'ai-voice-minutes';
    const PANEL_ID = 'ai-voice-minutes';
    const ROUTE = '/api/ai-minutes';
    const AUDIO_ROUTE = '/api/ai-minutes/audio';
    const DEFAULT_TRANSLATION_BASE_URL = 'http://127.0.0.1:6121/v1';
    const DEFAULT_TRANSLATION_MODEL = 'qwen3.5-4b-mtp';
    const DEFAULT_TRANSLATION_FALLBACK_PROVIDER = 'lmstudio';
    const DEFAULT_TRANSLATION_FALLBACK_MODEL = 'hy-mt2-7b';
    const DEFAULT_TRANSLATION_FALLBACK_BASE_URL = 'http://127.0.0.1:6121/v1';

    /**
     * The two looks the native overlay window can wear.
     *
     * The window used to be locked to the light pair, so it stayed a white
     * card on a dark desktop. It follows the host theme instead.
     */
    const OVERLAY_APPEARANCE = {
      light: { background: '#f6f6f7', text: '#1c1c1e' },
      dark: { background: '#1c1c1e', text: '#f6f6f7' },
    };

    /** The theme the shell is in; it toggles data-ds-dark-theme on the body. */
    function hostTheme() {
      if (typeof document === 'undefined') return 'light';
      for (const element of [document.body, document.documentElement]) {
        if (!element) continue;
        try {
          if (typeof element.getAttribute === 'function') {
            const value = element.getAttribute('data-ds-dark-theme');
            if (value === null) continue;
            return value === 'false' || value === '0' ? 'light' : 'dark';
          }
          if (typeof element.hasAttribute === 'function' && element.hasAttribute('data-ds-dark-theme')) {
            return 'dark';
          }
        } catch {
          /* A shell without the attribute simply has the light theme. */
        }
      }
      return 'light';
    }

    const DICT = {
      zh: {
        'app.title': 'Local AI Voice Minutes',
        'app.subtitle': '本地转写、结构化纪要与会议问答',
        'nav.label': 'Minutes',
        'library.title': '会议库',
        'library.empty': '还没有保存的会议',
        'library.hint': '完成转写后，将会议保存到这里。',
        'library.topics': '个议题',
        'action.new': '新建会议',
        'action.interpret': 'Live transcript',
        'action.interpretHint': '立即开始实时字幕、翻译和会议纪要',
        'action.settings': '设置',
        'action.refresh': '刷新',
        'action.choose': '选择音频',
        'action.change': '更换音频',
        'action.transcribe': '开始转写',
        'action.summarize': '生成纪要',
        'action.save': '保存会议',
        'action.ask': '提问',
        'action.delete': '删除',
        'action.close': '关闭',
        'status.asr': 'ASR',
        'status.llm': 'LLM',
        'status.online': '在线',
        'status.offline': '离线',
        'status.unknown': '检查中',
        'import.title': '导入会议音频',
        'import.hint': '支持 M4A、MP3、WAV、WebM、OGG 和 FLAC。音频在本机处理。',
        'import.empty': '选择一份录音，确认后再开始转写。',
        'import.selected': '已选择音频',
        'meeting.untitled': '未命名会议',
        'meeting.title': '会议标题',
        'meeting.titlePlaceholder': '输入会议标题',
        'transcript.title': '逐字稿',
        'transcript.empty': '转写完成后，带说话人与时间戳的内容会显示在这里。',
        'minutes.title': 'AI 纪要',
        'minutes.empty': '根据逐字稿生成结论、议题、决策和待办。',
        'minutes.summary': '结论',
        'minutes.topics': '议题',
        'minutes.chapters': '章节',
        'minutes.viewpoints': '观点',
        'minutes.decisions': '决策',
        'minutes.todos': '待办',
        'minutes.disputes': '未达成一致',
        'minutes.risks': '风险',
        'ask.title': '就这场会议提问',
        'ask.placeholder': '输入问题，Ctrl / ⌘ + Enter 发送',
        'ask.answer': '回答',
        'settings.title': '服务设置',
        'settings.asr': 'ASR 服务地址',
        'settings.llm': 'LLM 服务地址',
        'settings.model': '模型名称',
        'settings.speakers': '说话人数',
        'settings.apiKey': 'API Key',
        'settings.apiKeyPlaceholder': '留空则保持不变',
        'settings.save': '保存设置',
        'notice.saved': '会议已保存',
        'notice.settingsSaved': '设置已保存',
        'notice.audioDeleted': '音频文件已删除',
        'notice.meetingEnded': '会议已结束，录音已保存',
        'notice.deleted': '会议已删除',
        'notice.autoSaved': '已自动保存到本地会议库',
        'notice.deletedWithAudio': '会议与关联音频已删除',
        'error.chooseFile': '请先选择音频文件',
        'error.noTranscript': '请先完成转写',
        'error.settingsSaveFailed': '设置保存失败',
        'error.openPathFailed': '打开路径失败',
        'error.asrActionFailed': '本地 ASR 操作失败',
        'error.audioDeleteFailed': '删除音频文件失败',
        'error.deleteConfirm': '确定删除这场会议？此操作不可撤销。',
        'state.transcribing': '正在上传并转写，请稍候…',
        'state.summarizing': '正在生成结构化纪要…',
        'state.saving': '正在保存…',
        'state.asking': '正在思考…',
        'state.loading': '加载中…',
        'view.switch': '视图切换',
        'view.minutes': '会议纪要',
        'view.live': '实时',
        'live.title': '实时转写与翻译',
        'live.subtitle': '监听麦克风与系统音频，并显示原文和译文。',
        'live.start': '开始实时',
        'live.stop': '停止实时',
        'live.starting': '正在启动…',
        'live.stopping': '正在停止…',
        'live.source.auto': '自动识别',
        'live.source.zhEn': '仅支持中英文',
        'live.source.zh': '中文',
        'live.source.en': 'English',
        'live.language.zhHant': '繁體中文',
        'live.language.yue': '粤语',
        'live.language.ja': '日本語',
        'live.language.ko': '한국어',
        'live.language.th': 'ไทย',
        'live.language.id': 'Bahasa Indonesia',
        'live.incognito': '隐身模式',
        'live.incognitoEnabled': '已开启',
        'live.incognitoNotEnabled': '未开启',
        'live.controls.note': '笔记',
        'live.controls.flag': '标记',
        'live.topic': '会议议题',
        'live.minutesAuto': '会议纪要将自动更新到 AI Minutes…',
        'live.error.retry': '重试',
        'live.error.sameLanguage': '原文语言和译文语言不能相同',
        'live.error.endpoint': '服务地址',
        'live.marker.note': '笔记',
        'live.marker.flag': '标记',
        'library.search': '搜索会议',
        'library.importFile': '导入文件',
        'library.inProgress': '纪要生成中',
        'library.backToLive': '回到实时',
        'library.moreActions': '更多操作',
        'library.templates': '选择模板开始生成纪要',
        'library.moreTemplates': '更多模板 >',
        'library.select': '选择会议',
        'library.selected': '已选择 {count} 场',
        'library.create': '新建纪要',
        'library.filter.recent': '最近',
        'library.filter.created': '我创建的',
        'library.filter.shared': '共享的',
        'library.filter.favorite': '收藏',
        'library.view.list': '列表视图',
        'library.view.grid': '网格视图',
        'library.template.intelligentSlicing': '智能切片',
        'library.template.intelligentSlicingHint': '按议题自动切分并提炼结论',
        'library.template.visualSummary': '可视化摘要',
        'library.template.visualSummaryHint': '结构化要点与图表摘要',
        'library.template.classic': '经典纪要',
        'library.template.classicHint': '标准会议纪要结构',
        'library.template.meetingMinutes': '标准会议纪要',
        'library.template.meetingMinutesHint': '包含议题、决策与待办的完整模板',
        'live.sourceLanguage': '原文语言',
        'live.targetLanguage': '译文语言',
        'live.track': '音轨筛选',
        'live.track.all': '全部音轨',
        'live.track.mic': '麦克风',
        'live.track.system': '系统音频',
        'live.language.zh': '中文',
        'live.language.en': 'English',
        'live.original': '原文',
        'live.translation': '译文',
        'live.translationPending': '等待翻译…',
        'live.transcription': '实时转写',
        'live.summary': '实时摘要',
        'live.summaryLanguage': '总结语言',
        'live.summaryGenerating': '正在生成总结…',
        'live.notes': '备注',
        'live.play': '播放录音',
        'live.pauseTranscription': '暂停转写',
        'live.resumeTranscription': '继续转写',
        'live.endMeeting': '结束会议',
        'detail.recording': '录制中',
        'live.desktop': '桌面浮窗',
        'live.status.paused': '转写已暂停',
        'live.pause': '暂停录音',
        'live.audioTrack': '播放音轨',
        'live.mix': '混音',
        'live.empty': '开始实时会话后，原文和译文会显示在这里。',
        'live.noTrackEvents': '当前音轨筛选下还没有内容。',
        'live.status': '会话状态',
        'live.level': '实时音量',
        'live.status.active': '进行中',
        'live.status.running': '进行中',
        'live.status.starting': '启动中',
        'live.status.stopped': '已停止',
        'live.status.failed': '失败',
        'live.status.error': '错误',
        'live.status.idle': '未开始',
        'live.queue': '队列',
        'live.latency': '延迟',
        'live.degraded': '降级运行',
        'live.duration': '时长',
        'live.error': '实时会话错误',
        'live.details': '错误详情',
        'live.source.mic': '麦克风',
        'live.source.system': '系统音频',
        'live.source.unknown': '未知音轨',
        'action.favorite': '收藏',
        'action.edit': '编辑',
        'action.translation': '翻译',
        'action.share': '分享',
        'action.search': '搜索',
        'action.import': '导入音频',
        'notice.linkCopied': '链接已复制',
        'state.translating': '正在翻译…',
        'detail.homepage': '首页',
        'detail.back': '返回会议库',
        'detail.showOriginal': '显示原文',
        'detail.showSimplified': '显示简体',
        'detail.generateMinutes': '生成纪要',
        'detail.templateUsed': '模板',
        'detail.templateBackground': '会议背景',
        'detail.templateHighlights': '关键要点',
        'detail.templateConclusions': '关键结论',
        'detail.templateActions': '行动项',
        'detail.templateOpenItems': '待确认事项',
        'detail.templateConclusion': '会议结论',
        'detail.regenerateMinutes': '重新生成纪要',
        'detail.liveSummaryGenerating': '实时纪要生成中…',
        'detail.liveSummaryHint': '录音结束后会自动生成完整纪要',
        'speaker.letter': '说话人 {letter}',
        'library.liveBanner': '有正在进行的会议',
        'live.pass.provisional': '临时',
        'live.pass.corrected': '已校正',
        'live.finalize': '精修',
        'live.finalizing': '精修中',
        'live.finalizeHint': '对已录音频再跑一次精修，用最终文本替换临时字幕',
        'live.finalizePending': '精修中…',
        'live.finalizeFailed': '精修失败',
        'live.lastFinalized': '上次精修',
        'live.diagnostics': '诊断信息',
        'live.hotwords': '热词',
        'live.hotwords.none': '无',
        'live.overlayShow': '显示字幕浮窗',
        'live.overlayShown': '字幕浮窗已显示',
        'voice.playSample': '播放声音样本',
        'voice.unnamedGroup': '未命名声音（{count}）',
        'voice.expand': '展开',
        'voice.collapse': '收起',
        'voice.sampleUnavailable': '该声音没有可播放的样本',
        'voice.search': '搜索声纹',
        'voice.filterAll': '全部',
        'voice.filterNamed': '已命名',
        'voice.filterUnnamed': '未命名',
        'voice.noMatch': '没有匹配的声纹',
        'voice.sampleReady': '可播放样本',
        'voice.sampleMissing': '无样本',
        'voice.speakersTitle': '本场说话人',
        'voice.speakersHint': '点击说话人即可标注或修正姓名；声纹会永久保存并用于后续会议自动识别。',
        'voice.emptySpeakers': '暂无可标注的说话人',
        'voice.emptyTitle': '还没有声音标签',
        'voice.persistentHint': '声纹永久保存并自动备份，不可删除，但可以修正标注。',
        'notice.voiceSaved': '说话人标注已保存',

        'detail.transcribe': '转写',
        'detail.summary': 'AI 摘要',
        'detail.viewpoints': '观点树',
        'detail.chapter': '章节',
        'detail.outline': '大纲',
        'detail.hideDetails': '隐藏章节详情',
        'detail.showDetails': '显示章节详情',
        'detail.original': '原文',
        'detail.translation': '译文',
        'detail.play': '播放',
        'detail.pause': '暂停',
        'detail.speakerCount': '{count} 位说话人',
        'detail.skipBack': '后退 15 秒',
        'detail.skipForward': '前进 15 秒',
        'detail.playbackSpeed': '倍速',
        'detail.export': '导出',
        'detail.download': '下载',
        'detail.originalFile': '原文',
        'detail.audioFiles': '音频和视频文件',
        'detail.audioResources': '音频资源',
        'detail.audioUpload': '原始音频',
        'detail.audioMic': '麦克风音轨',
        'detail.audioSystem': '系统音轨',
        'detail.audioPreview': '试听',
        'detail.audioDownload': '下载完整音频',
        'detail.audioFull': '完整音频',
        'detail.deleteAudioConfirm': '删除这个音频文件？逐字稿、翻译和纪要都会保留。',
        'detail.copyLink': '复制链接',
        'detail.sendToChat': '发送到聊天',
        'detail.format': '文件格式',
        'detail.noAudio': '这场会议没有可播放的音频',
        'detail.saveChanges': '保存修改',
        'detail.backToLibrary': '返回会议库',
        'detail.searchPlaceholder': '搜索本次会议内容',
        'detail.creator': '创建人',
        'detail.source': '来源',
        'detail.size': '大小',
        'detail.createdAt': '创建时间',
        'detail.duration': '时长',
        'detail.chapters': '章节数',
        'detail.topics': '议题数',
        'detail.translationMissing': '选择语言后将在这里显示译文。',
        'settings.translationBaseUrl': '翻译服务地址',
        'settings.translationModel': '翻译模型',
        'settings.asrProvider': 'ASR 提供方',
        'settings.provider.local': '本地服务',
        'settings.provider.siliconflow': 'SiliconFlow 云端',
        'voice.title': '声音标签库',
        'voice.unnamed': '未命名声音',
        'voice.empty': '还没有声音标签',
        'voice.hint': '为说话人命名后，之后的会议会自动认出这个声音。',
        'voice.save': '保存',
        'voice.rename': '重命名声音',
        'voice.label': '说话人姓名',
        'history.recent': '近期会议总结',
        'history.suggestLabel': '你可能想问',
        'history.tileMindMap': '议题导图',
        'history.tileMindMapHint': '按议题梳理观点与结论',
        'history.tileKeyInsights': '关键洞察',
        'history.tileKeyInsightsHint': '摘要、决策与风险',
        'history.compareTitle': '翻译模型对比',
        'history.compareChatty': '存在多余说明',
        'history.compareEmpty': '出现空结果',
        'history.compareError': '翻译失败',
        'history.compareNoSentences': '当前没有可用于对比的句子',
        'history.compareNoModels': '请先读取可用模型',
        'history.newChat': '新对话',
        'history.expandAll': '查看全部',
        'history.collapse': '收起',
        'history.suggestDecisionsNow': '这次会议有哪些关键决策？',
        'history.suggestTodosNow': '还有哪些待办没有负责人？',
        'history.suggestRisksNow': '这次会议存在哪些风险和阻塞？',
        'history.suggestSummaryNow': '帮我总结这次会议的结论和下一步',
        'history.suggestCrossHistory': '这些历史会议有哪些共同的问题？',

        'history.chatTitle': 'AI 会议助手',
        'history.chatEmpty': '还没有提问',
        'history.chatHint': '基于历史会议的逐字稿与纪要进行问答并给出工作建议',
        'history.chatPlaceholder': '询问历史会议、待办或下一步建议',
        'history.send': '发送',
        'history.scopeAll': '全部历史会议',
        'history.scopeCurrent': '当前会议',
        'history.suggestTodos': '汇总待办事项',
        'history.suggestNext': '给出下一步建议',
        'history.suggestRisks': '识别风险与阻塞',
        'history.suggestDecisions': '回顾关键决策',
        'history.askFailed': '问答失败，请稍后重试。',
        'state.thinking': '思考中',
        'settings.glossary': '术语表',
        'settings.glossaryPlaceholder': '进件 = onboarding\nKYC = customer identification',
        'settings.glossaryHint': 'Hy-MT 系列会按术语表对齐；通用模型会把它作为提示附加在任务中。',
        'settings.promptMode': '提示词格式',
        'settings.promptModeAuto': '自动识别模型',
        'settings.promptModeGeneric': '通用大模型',
        'settings.promptModeHyMt': 'Hy-MT 专用',
        'settings.loadModels': '读取服务可用模型',
        'settings.compareModels': '对比翻译模型',
        'settings.availableModels': '选择服务端模型',
        'settings.noModels': '该服务没有返回可用模型',
        'settings.modelNotListed': '当前模型未在服务端列表中，请确认模型已加载',
        'error.modelsFailed': '读取模型列表失败',
        'assistant.open': 'AI 助手',
        'assistant.close': '关闭助手',
        'assistant.title': 'AI 会议助手',
        'home.greeting': '会议工作台',
        'home.subtitle': '开始一场会议、导入录音，或继续处理已有纪要。',
        'home.stat.meetings': '会议数',
        'home.stat.duration': '总时长',
        'home.stat.pending': '待生成纪要',
        'home.stat.live': '进行中',
        'library.status.ready': '已有纪要',
        'library.status.pending': '待生成纪要',
        'library.view.cards': '卡片',
        'detail.template': '纪要模板',
        'settings.translationFallbackSection': '本地模型兜底（可选）',
        'settings.translationFallback': '本地模型兜底',
        'settings.translationFallbackHint': '仅在 MiniMax 失败或不可用时使用本地模型；关闭后不再回退。',
        'settings.translationFallbackProvider': '兜底模型服务',
        'settings.translationFallbackModel': '兜底模型',
        'settings.translationFallbackBaseUrl': '兜底服务地址',
        'settings.provider.minimaxDefault': 'MiniMax（默认）',
        'settings.asrBackend': '识别后端',
        'settings.backend.whispercpp': 'whisper.cpp（本地离线）',
        'settings.backend.sensevoice': 'SenseVoice（实时字幕）',
        'settings.backend.funasr': 'Fun-ASR-Nano（精修）',
        'settings.backendHint.whispercpp': '本地 whisper.cpp：离线精度最高，适合会后整理与逐字稿归档。',
        'settings.backendHint.sensevoice': 'sherpa-onnx SenseVoiceSmall：实时字幕最快，中文标点更好，适合边开会边看字幕。',
        'settings.backendHint.funasr': 'Fun-ASR-Nano：负责 pass2 精修，支持术语热词，会议结束后自动校正临时字幕。',
        'settings.asr.serviceTitle': '本地 ASR 服务管理',
        'settings.asr.start': '启动服务',
        'settings.asr.stop': '停止服务',
        'settings.asr.restart': '重启服务',
        'settings.asr.autoStart': '插件启动时自动启动 ASR',
        'settings.asr.openModelDir': '打开文件夹',
        'settings.asr.openLauncher': '打开脚本',
        'settings.asr.modelList': '本地模型库',
        'settings.asr.activeModel': '正在使用',
        'settings.asr.noModel': '未选择模型',
        'settings.asr.inUse': '使用中',
        'settings.asr.downloaded': '已下载',
        'settings.asr.notDownloaded': '未下载',
        'settings.asr.downloadModel': '下载',
        'settings.asr.useModel': '设为使用',
        'settings.asr.selectModel': '选择本地 GGML 模型',
        'settings.asr.defaultModel': '使用默认模型',
        'settings.asr.modelDir': '模型目录',
        'settings.asr.launcher': '服务启动脚本',
        'settings.provider.minimax': 'MiniMax',
        'settings.provider.lmstudio': 'LM Studio',
        'settings.section.asr': 'ASR 转写服务',
        'settings.section.llm': 'Minutes LLM 纪要与问答',
        'settings.section.translation': 'Realtime Translation 实时翻译',
        'settings.section.overlay': '实时字幕浮窗',
        'settings.overlayBackground': '浮窗背景色',
        'settings.overlayText': '浮窗文字颜色',
        'settings.overlayOpacity': '浮窗不透明度',
        'settings.overlayCompact': '默认只显示最新一句',
        'settings.overlayHint': '浮窗默认只显示最新一句和译文；点右上角展开可以回看之前的对话。窗口的大小和位置会被记住。',
        'settings.asrModel': 'ASR 模型 ID',
        'settings.liveChunkSeconds': '实时字幕分段',
        'settings.chunk.3': '3 秒 · 推荐',
        'settings.chunk.5': '5 秒 · 更快',
        'settings.chunk.10': '10 秒 · 最完整',
        'settings.llmProvider': '纪要 LLM 提供方',
        'settings.llmApiKey': '纪要 LLM API Key',
        'settings.llmFallbackSection': '兜底模型（可选）',
        'settings.llmFallback': '启用兜底模型',
        'settings.llmFallbackHint': '仅在主纪要模型失败、不可用或答不出可解析的 JSON 时使用；关闭后不再回退。',
        'settings.llmFallbackProvider': '兜底模型服务',
        'settings.llmFallbackModel': '兜底模型',
        'settings.llmFallbackBaseUrl': '兜底服务地址',
        'settings.llmFallbackPath': '兜底接口路径',
        'settings.translationProvider': '翻译提供方',
        'settings.translationApiKey': '翻译 API Key',
        'settings.temperature': 'Temperature',
        'settings.maxTokens': 'Max tokens（0 为不限制）',
        'settings.reasoningEffort': 'Reasoning effort',
        'settings.reasoning.default': '服务端默认',
        'settings.reasoning.none': '关闭推理',
        'settings.reasoning.low': '低',
        'settings.reasoning.medium': '中',
        'settings.reasoning.high': '高',
        'settings.siliconflowBaseUrl': 'SiliconFlow 服务地址',
        'settings.siliconflowModel': 'SiliconFlow 模型',
        'settings.siliconflowApiKey': 'SiliconFlow API Key',
        'settings.cloudNotice': '使用 SiliconFlow 时，音频会发送到云端进行转写。',
      },
      en: {
        'app.title': 'Local AI Voice Minutes',
        'app.subtitle': 'Local transcription, structured minutes, and meeting Q&A',
        'nav.label': 'Minutes',
        'library.title': 'Meeting library',
        'library.empty': 'No saved meetings yet',
        'library.hint': 'Save a meeting after transcription to find it here.',
        'library.topics': 'topics',
        'action.new': 'New meeting',
        'action.interpret': 'Live transcript',
        'action.interpretHint': 'Start live captions, translation and minutes right away',
        'action.settings': 'Settings',
        'action.refresh': 'Refresh',
        'action.choose': 'Choose audio',
        'action.change': 'Change audio',
        'action.transcribe': 'Transcribe',
        'action.summarize': 'Generate minutes',
        'action.save': 'Save meeting',
        'action.ask': 'Ask',
        'action.delete': 'Delete',
        'action.close': 'Close',
        'status.asr': 'ASR',
        'status.llm': 'LLM',
        'status.online': 'Online',
        'status.offline': 'Offline',
        'status.unknown': 'Checking',
        'import.title': 'Import meeting audio',
        'import.hint': 'M4A, MP3, WAV, WebM, OGG, and FLAC are supported. Audio is processed locally.',
        'import.empty': 'Choose a recording, then start transcription explicitly.',
        'import.selected': 'Selected audio',
        'meeting.untitled': 'Untitled meeting',
        'meeting.title': 'Meeting title',
        'meeting.titlePlaceholder': 'Enter a meeting title',
        'transcript.title': 'Transcript',
        'transcript.empty': 'Speaker labels and timestamps will appear here after transcription.',
        'minutes.title': 'AI minutes',
        'minutes.empty': 'Generate conclusions, topics, decisions, and todos from the transcript.',
        'minutes.summary': 'Summary',
        'minutes.topics': 'Topics',
        'minutes.chapters': 'Chapters',
        'minutes.viewpoints': 'Viewpoints',
        'minutes.decisions': 'Decisions',
        'minutes.todos': 'Todos',
        'minutes.disputes': 'Open issues',
        'minutes.risks': 'Risks',
        'ask.title': 'Ask about this meeting',
        'ask.placeholder': 'Type a question; Ctrl / ⌘ + Enter to send',
        'ask.answer': 'Answer',
        'settings.title': 'Service settings',
        'settings.asr': 'ASR base URL',
        'settings.llm': 'LLM base URL',
        'settings.model': 'Model name',
        'settings.speakers': 'Speaker count',
        'settings.apiKey': 'API Key',
        'settings.apiKeyPlaceholder': 'Leave blank to keep the current key',
        'settings.save': 'Save settings',
        'notice.saved': 'Meeting saved',
        'notice.settingsSaved': 'Settings saved',
        'notice.audioDeleted': 'Audio file deleted',
        'notice.meetingEnded': 'The meeting ended and the recording was saved',
        'notice.deleted': 'Meeting deleted',
        'notice.autoSaved': 'Saved automatically to the local meeting library',
        'notice.deletedWithAudio': 'Meeting and linked audio deleted',
        'error.chooseFile': 'Choose an audio file first',
        'error.noTranscript': 'Transcribe the meeting first',
        'error.settingsSaveFailed': 'Failed to save settings',
        'error.openPathFailed': 'Failed to open the path',
        'error.asrActionFailed': 'Local ASR action failed',
        'error.audioDeleteFailed': 'Failed to delete the audio file',
        'error.deleteConfirm': 'Delete this meeting? This cannot be undone.',
        'state.transcribing': 'Uploading and transcribing…',
        'state.summarizing': 'Generating structured minutes…',
        'state.saving': 'Saving…',
        'state.asking': 'Thinking…',
        'state.loading': 'Loading…',
        'view.switch': 'Switch view',
        'view.minutes': 'Minutes',
        'view.live': 'Live',
        'live.title': 'Live transcription and translation',
        'live.subtitle': 'Listen to microphone and system audio with original and translated text.',
        'live.start': 'Start live',
        'live.stop': 'Stop live',
        'live.starting': 'Starting…',
        'live.stopping': 'Stopping…',
        'live.source.auto': 'Automatic Identification',
        'live.source.zhEn': 'Support only Chinese and English',
        'live.source.zh': '中文',
        'live.source.en': 'English',
        'live.language.zhHant': '繁體中文',
        'live.language.yue': '粤语',
        'live.language.ja': '日本語',
        'live.language.ko': '한국어',
        'live.language.th': 'ไทย',
        'live.language.id': 'Bahasa Indonesia',
        'live.incognito': 'Incognito',
        'live.incognitoEnabled': 'Enabled',
        'live.incognitoNotEnabled': 'Not Enabled',
        'live.controls.note': 'Note',
        'live.controls.flag': 'Flag',
        'live.topic': 'Meeting Topic',
        'live.minutesAuto': 'Meeting minutes will update automatically in AI Minutes...',
        'live.error.retry': 'Retry',
        'live.error.sameLanguage': 'The source and the target language cannot be the same',
        'live.error.endpoint': 'Endpoint',
        'live.marker.note': 'Note',
        'live.marker.flag': 'Flag',
        'library.search': 'Search meetings',
        'library.importFile': 'Import file',
        'library.inProgress': 'Minutes in progress',
        'library.backToLive': 'Back to live',
        'library.moreActions': 'More actions',
        'library.templates': 'Select template to start Minutes',
        'library.moreTemplates': 'More Templates >',
        'library.select': 'Select meeting',
        'library.selected': '{count} selected',
        'library.create': 'Create minutes',
        'library.filter.recent': 'Recent',
        'library.filter.created': 'Created',
        'library.filter.shared': 'Shared',
        'library.filter.favorite': 'Favorite',
        'library.view.list': 'List view',
        'library.view.grid': 'Grid view',
        'library.template.intelligentSlicing': '智能切片',
        'library.template.intelligentSlicingHint': 'Split the meeting into topics and extract conclusions',
        'library.template.visualSummary': '可视化摘要',
        'library.template.visualSummaryHint': 'Structured highlights and visual summary',
        'library.template.classic': 'Classic minutes',
        'library.template.classicHint': 'Standard meeting minutes structure',
        'library.template.meetingMinutes': 'Standard minutes',
        'library.template.meetingMinutesHint': 'Topics, decisions and action items',
        'live.sourceLanguage': 'Source language',
        'live.targetLanguage': 'Target language',
        'live.track': 'Track filter',
        'live.track.all': 'All tracks',
        'live.track.mic': 'Microphone',
        'live.track.system': 'System audio',
        'live.language.zh': '中文',
        'live.language.en': 'English',
        'live.original': 'Original',
        'live.translation': 'Translation',
        'live.translationPending': 'Waiting for translation…',
        'live.transcription': 'Transcription',
        'live.summary': 'Real-time Summary',
        'live.summaryLanguage': 'Summary language',
        'live.summaryGenerating': 'Generating the summary…',
        'live.notes': 'Notes',
        'live.play': 'Play recording',
        'live.pauseTranscription': 'Pause transcription',
        'live.resumeTranscription': 'Resume transcription',
        'live.endMeeting': 'End meeting',
        'detail.recording': 'Recording',
        'live.desktop': 'Desktop window',
        'live.status.paused': 'Transcription paused',
        'live.pause': 'Pause recording',
        'live.audioTrack': 'Playback track',
        'live.mix': 'Mixed audio',
        'live.empty': 'Start a live session to see original and translated text here.',
        'live.noTrackEvents': 'No events match the current track filter.',
        'live.status': 'Session status',
        'live.level': 'Live level',
        'live.status.active': 'Active',
        'live.status.running': 'Active',
        'live.status.starting': 'Starting',
        'live.status.stopped': 'Stopped',
        'live.status.failed': 'Failed',
        'live.status.error': 'Error',
        'live.status.idle': 'Not started',
        'live.queue': 'Queue',
        'live.latency': 'Latency',
        'live.degraded': 'Degraded',
        'live.duration': 'Duration',
        'live.error': 'Live session error',
        'live.details': 'Error details',
        'live.source.mic': 'Microphone',
        'live.source.system': 'System audio',
        'live.source.unknown': 'Unknown track',
        'action.favorite': 'Favorite',
        'action.edit': 'Edit',
        'action.translation': 'Translation',
        'action.share': 'Share',
        'action.search': 'Search',
        'action.import': 'Import audio',
        'notice.linkCopied': 'Link copied',
        'state.translating': 'Translating…',
        'detail.homepage': 'homepage',
        'detail.back': 'Back to library',
        'detail.showOriginal': 'Show original',
        'detail.showSimplified': 'Show simplified',
        'detail.generateMinutes': 'Generate minutes',
        'detail.templateUsed': 'Template',
        'detail.templateBackground': 'Background',
        'detail.templateHighlights': 'Highlights',
        'detail.templateConclusions': 'Conclusions',
        'detail.templateActions': 'Action items',
        'detail.templateOpenItems': 'Open items',
        'detail.templateConclusion': 'Conclusion',
        'detail.regenerateMinutes': 'Regenerate minutes',
        'detail.liveSummaryGenerating': 'Generating live minutes…',
        'detail.liveSummaryHint': 'Full minutes are generated when the recording ends',
        'speaker.letter': 'Speaker {letter}',
        'library.liveBanner': 'A meeting is recording',
        'live.pass.provisional': 'Provisional',
        'live.pass.corrected': 'Corrected',
        'live.finalize': 'Refine',
        'live.finalizing': 'Refining',
        'live.finalizeHint': 'Run pass 2 over the recorded audio and replace provisional captions with the final text',
        'live.finalizePending': 'Refining…',
        'live.finalizeFailed': 'Refinement failed',
        'live.lastFinalized': 'Last refined',
        'live.diagnostics': 'Diagnostics',
        'live.hotwords': 'Hotwords',
        'live.hotwords.none': 'none',
        'live.overlayShow': 'Show transcript window',
        'live.overlayShown': 'Transcript window is open',
        'voice.playSample': 'Play voice sample',
        'voice.unnamedGroup': 'Unnamed voices ({count})',
        'voice.expand': 'Expand',
        'voice.collapse': 'Collapse',
        'voice.sampleUnavailable': 'No playable sample for this voice',
        'voice.search': 'Search voices',
        'voice.filterAll': 'All',
        'voice.filterNamed': 'Named',
        'voice.filterUnnamed': 'Unnamed',
        'voice.noMatch': 'No matching voices',
        'voice.sampleReady': 'Sample available',
        'voice.sampleMissing': 'No sample',
        'voice.speakersTitle': 'Speakers in this meeting',
        'voice.speakersHint': 'Select a speaker to add or correct their name. Voiceprints are kept permanently and recognised in later meetings.',
        'voice.emptySpeakers': 'No speakers available for annotation',
        'voice.emptyTitle': 'No voice labels yet',
        'voice.persistentHint': 'Voiceprints are kept permanently with backups and can be corrected, never deleted.',
        'notice.voiceSaved': 'Speaker annotation saved',

        'detail.transcribe': 'Transcribe',
        'detail.summary': 'AI Summary',
        'detail.viewpoints': 'Viewpoint Tree',
        'detail.chapter': 'Chapter',
        'detail.outline': 'Outline',
        'detail.hideDetails': 'Hide chapter details',
        'detail.showDetails': 'Show chapter details',
        'detail.original': 'Original',
        'detail.translation': 'Translation',
        'detail.play': 'Play',
        'detail.pause': 'Pause',
        'detail.speakerCount': '{count} speakers',
        'detail.skipBack': 'Back 15 seconds',
        'detail.skipForward': 'Forward 15 seconds',
        'detail.playbackSpeed': 'Speed',
        'detail.export': 'Export',
        'detail.download': 'Download',
        'detail.originalFile': 'Original',
        'detail.audioFiles': 'Audio and video files',
        'detail.audioResources': 'Audio resources',
        'detail.audioUpload': 'Original audio',
        'detail.audioMic': 'Microphone track',
        'detail.audioSystem': 'System audio track',
        'detail.audioPreview': 'Preview',
        'detail.audioDownload': 'Download full audio',
        'detail.audioFull': 'Complete audio',
        'detail.deleteAudioConfirm': 'Delete this audio file? The transcript, the translation and the minutes are kept.',
        'detail.copyLink': 'Copy link',
        'detail.sendToChat': 'Send to chat',
        'detail.format': 'File Format',
        'detail.noAudio': 'No playable audio is available for this meeting',
        'detail.saveChanges': 'Save changes',
        'detail.backToLibrary': 'Back to library',
        'detail.searchPlaceholder': 'Search within this meeting',
        'detail.creator': 'Creator',
        'detail.source': 'Source',
        'detail.size': 'Size',
        'detail.createdAt': 'Created at',
        'detail.duration': 'Duration',
        'detail.chapters': 'Chapters',
        'detail.topics': 'Topics',
        'detail.translationMissing': 'Choose a language to see the translation here.',
        'settings.translationBaseUrl': 'Translation base URL',
        'settings.translationModel': 'Translation model',
        'settings.asrProvider': 'ASR provider',
        'settings.provider.local': 'Local service',
        'settings.provider.siliconflow': 'SiliconFlow cloud',
        'voice.title': 'Voice book',
        'voice.unnamed': 'Unnamed voice',
        'voice.empty': 'No voice labels yet',
        'voice.hint': 'Name a speaker once and later meetings recognise the same voice.',
        'voice.save': 'Save',
        'voice.rename': 'Rename voice',
        'voice.label': 'Speaker name',
        'history.recent': 'Recent meeting summaries',
        'history.suggestLabel': 'You may want to ask',
        'history.tileMindMap': 'Mind map',
        'history.tileMindMapHint': 'Topics, viewpoints, conclusions',
        'history.tileKeyInsights': 'Key insights',
        'history.tileKeyInsightsHint': 'Summary, decisions, risks',
        'history.compareTitle': 'Translation model comparison',
        'history.compareChatty': 'Added extra wording',
        'history.compareEmpty': 'Empty output',
        'history.compareError': 'Translation failed',
        'history.compareNoSentences': 'There are no sentences to compare yet',
        'history.compareNoModels': 'Load the available models first',
        'history.newChat': 'New chat',
        'history.expandAll': 'Show all',
        'history.collapse': 'Collapse',
        'history.suggestDecisionsNow': 'What decisions were made in this meeting?',
        'history.suggestTodosNow': 'Which action items still have no owner?',
        'history.suggestRisksNow': 'What risks and blockers came up?',
        'history.suggestSummaryNow': 'Summarise the conclusions and next steps',
        'history.suggestCrossHistory': 'What problems recur across these meetings?',

        'history.chatTitle': 'AI meeting assistant',
        'history.chatEmpty': 'No questions yet',
        'history.chatHint': 'Ask questions and get next-step advice grounded in past transcripts and minutes',
        'history.chatPlaceholder': 'Ask about past meetings, todos, or next steps',
        'history.send': 'Send',
        'history.scopeAll': 'All meetings',
        'history.scopeCurrent': 'Current meeting',
        'history.suggestTodos': 'Summarize todos',
        'history.suggestNext': 'Suggest next steps',
        'history.suggestRisks': 'Identify risks and blockers',
        'history.suggestDecisions': 'Review key decisions',
        'history.askFailed': 'The question failed. Please try again.',
        'state.thinking': 'Thinking',
        'settings.glossary': 'Glossary',
        'settings.glossaryPlaceholder': '进件 = onboarding\nKYC = customer identification',
        'settings.glossaryHint': 'Hy-MT models apply the glossary as terminology; other models receive it as an extra instruction.',
        'settings.promptMode': 'Prompt format',
        'settings.promptModeAuto': 'Detect from model',
        'settings.promptModeGeneric': 'Generic chat model',
        'settings.promptModeHyMt': 'Hy-MT format',
        'settings.loadModels': 'Load available models',
        'settings.compareModels': 'Compare translation models',
        'settings.availableModels': 'Choose a served model',
        'settings.noModels': 'The service returned no models',
        'settings.modelNotListed': 'The current model is not served yet, please load it first',
        'error.modelsFailed': 'Failed to read the model list',
        'assistant.open': 'AI assistant',
        'assistant.close': 'Close assistant',
        'assistant.title': 'AI meeting assistant',
        'home.greeting': 'Meeting workspace',
        'home.subtitle': 'Start a meeting, import a recording, or continue with existing minutes.',
        'home.stat.meetings': 'Meetings',
        'home.stat.duration': 'Total time',
        'home.stat.pending': 'Minutes pending',
        'home.stat.live': 'In progress',
        'library.status.ready': 'Minutes ready',
        'library.status.pending': 'Minutes pending',
        'library.view.cards': 'Cards',
        'detail.template': 'Minutes template',
        'settings.translationFallbackSection': 'Local fallback (optional)',
        'settings.translationFallback': 'Local fallback',
        'settings.translationFallbackHint': 'Used only when MiniMax fails or is unavailable; turn it off to disable the fallback.',
        'settings.translationFallbackProvider': 'Fallback service',
        'settings.translationFallbackModel': 'Fallback model',
        'settings.translationFallbackBaseUrl': 'Fallback endpoint',
        'settings.provider.minimaxDefault': 'MiniMax (default)',
        'settings.asrBackend': 'Recognition backend',
        'settings.backend.whispercpp': 'whisper.cpp (local offline)',
        'settings.backend.sensevoice': 'SenseVoice (realtime captions)',
        'settings.backend.funasr': 'Fun-ASR-Nano (refinement)',
        'settings.backendHint.whispercpp': 'Local whisper.cpp: highest offline accuracy, best for archived transcripts.',
        'settings.backendHint.sensevoice': 'sherpa-onnx SenseVoiceSmall: fastest realtime captions with better Chinese punctuation.',
        'settings.backendHint.funasr': 'Fun-ASR-Nano: runs pass 2 refinement and honours hotwords to correct provisional captions.',
        'settings.asr.serviceTitle': 'Local ASR service management',
        'settings.asr.start': 'Start service',
        'settings.asr.stop': 'Stop service',
        'settings.asr.restart': 'Restart service',
        'settings.asr.autoStart': 'Start ASR when the plugin starts',
        'settings.asr.openModelDir': 'Open folder',
        'settings.asr.openLauncher': 'Open script',
        'settings.asr.modelList': 'Local model library',
        'settings.asr.activeModel': 'In use',
        'settings.asr.noModel': 'No model selected',
        'settings.asr.inUse': 'In use',
        'settings.asr.downloaded': 'Downloaded',
        'settings.asr.notDownloaded': 'Not downloaded',
        'settings.asr.downloadModel': 'Download',
        'settings.asr.useModel': 'Use this model',
        'settings.asr.selectModel': 'Local GGML model',
        'settings.asr.defaultModel': 'Use default model',
        'settings.asr.modelDir': 'Model directory',
        'settings.asr.launcher': 'Service launcher',
        'settings.provider.minimax': 'MiniMax',
        'settings.provider.lmstudio': 'LM Studio',
        'settings.section.asr': 'ASR transcription service',
        'settings.section.llm': 'Minutes LLM for minutes and Q&A',
        'settings.section.translation': 'Realtime Translation service',
        'settings.section.overlay': 'Live transcript overlay',
        'settings.overlayBackground': 'Overlay background',
        'settings.overlayText': 'Overlay text colour',
        'settings.overlayOpacity': 'Overlay opacity',
        'settings.overlayCompact': 'Show only the newest line by default',
        'settings.overlayHint': 'The overlay shows the newest line and its translation; the button at the top right expands the earlier conversation. Its size and place are remembered.',
        'settings.asrModel': 'ASR model ID',
        'settings.liveChunkSeconds': 'Live caption chunk',
        'settings.chunk.3': '3 seconds · recommended',
        'settings.chunk.5': '5 seconds · faster',
        'settings.chunk.10': '10 seconds · most context',
        'settings.llmProvider': 'Minutes LLM provider',
        'settings.llmApiKey': 'Minutes LLM API Key',
        'settings.llmFallbackSection': 'Fallback model (optional)',
        'settings.llmFallback': 'Enable fallback model',
        'settings.llmFallbackHint': 'Used only when the primary minutes model fails, is unavailable, or answers with unparsable JSON; turn it off to disable the fallback.',
        'settings.llmFallbackProvider': 'Fallback service',
        'settings.llmFallbackModel': 'Fallback model',
        'settings.llmFallbackBaseUrl': 'Fallback endpoint',
        'settings.llmFallbackPath': 'Fallback endpoint path',
        'settings.translationProvider': 'Translation provider',
        'settings.translationApiKey': 'Translation API Key',
        'settings.temperature': 'Temperature',
        'settings.maxTokens': 'Max tokens (0 for unlimited)',
        'settings.reasoningEffort': 'Reasoning effort',
        'settings.reasoning.default': 'Server default',
        'settings.reasoning.none': 'Disable reasoning',
        'settings.reasoning.low': 'Low',
        'settings.reasoning.medium': 'Medium',
        'settings.reasoning.high': 'High',
        'settings.siliconflowBaseUrl': 'SiliconFlow base URL',
        'settings.siliconflowModel': 'SiliconFlow model',
        'settings.siliconflowApiKey': 'SiliconFlow API Key',
        'settings.cloudNotice': 'Audio is sent to SiliconFlow for transcription when cloud ASR is enabled.',
      },
    };

    // The plugin owns its own hue and its own surface ramp. The host's brand
    // token is achromatic, so it can never carry the accent; the accent hexes
    // live here as constants so the stylesheet itself stays free of literals.
    const ACCENT = { light: '#2f6be0', dark: '#74a6ff' };

    const CSS = `
.mvm-page{
  --mvm-surface-0:var(--dsw-alias-bg-base);
  --mvm-surface-1:color-mix(in oklab,var(--dsw-alias-bg-base) 94%,var(--dsw-alias-label-primary) 6%);
  --mvm-surface-2:color-mix(in oklab,var(--dsw-alias-bg-base) 89%,var(--dsw-alias-label-primary) 11%);
  --mvm-surface-3:color-mix(in oklab,var(--dsw-alias-bg-base) 84%,var(--dsw-alias-label-primary) 16%);
  --mvm-overlay:var(--dsw-alias-bg-overlay);
  --mvm-line:color-mix(in oklab,var(--dsw-alias-label-primary) 11%,transparent);
  --mvm-line-strong:color-mix(in oklab,var(--dsw-alias-label-primary) 18%,transparent);
  --mvm-shadow-card:0 1px 2px color-mix(in oklab,var(--dsw-alias-label-primary) 7%,transparent),0 4px 14px -6px color-mix(in oklab,var(--dsw-alias-label-primary) 10%,transparent);
  --mvm-shadow-float:0 2px 6px color-mix(in oklab,var(--dsw-alias-label-primary) 10%,transparent),0 16px 36px -12px color-mix(in oklab,var(--dsw-alias-label-primary) 22%,transparent);
  --mvm-shadow-drawer:-12px 0 32px -10px color-mix(in oklab,var(--dsw-alias-label-primary) 22%,transparent);
  --mvm-edge:inset 0 1px 0 color-mix(in oklab,var(--dsw-alias-label-primary) 7%,transparent);
  --mvm-accent:var(--mvm-accent-base);
  --mvm-accent-soft:color-mix(in oklab,var(--mvm-accent-base) 14%,transparent);
  --mvm-accent-line:color-mix(in oklab,var(--mvm-accent-base) 42%,transparent);
  --mvm-accent-ink:var(--mvm-accent-base);
  --mvm-on-accent:var(--dsw-alias-bg-layer-1);
  --mvm-ease:cubic-bezier(.23,1,.32,1);
  --mvm-dur-fast:100ms;
  --mvm-dur:200ms;
}
.mvm-page{--mvm-accent-base:${ACCENT.light}}
body[data-ds-dark-theme] .mvm-page{--mvm-accent-base:${ACCENT.dark}}
.mvm-page{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--mvm-surface-0);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.mvm-page *{box-sizing:border-box}
.mvm-page select option{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.mvm-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:22px 28px 18px;border-bottom:1px solid var(--mvm-line);background:var(--mvm-surface-1);flex:none}
.mvm-heading{min-width:0}
.mvm-title{margin:0;font-size:18px;line-height:1.3;font-weight:600;letter-spacing:-.02em}
.mvm-subtitle{margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-header-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.mvm-health{display:flex;align-items:center;gap:6px;margin-right:4px}
.mvm-health-item{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid var(--mvm-line);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:12px;background:var(--mvm-surface-2)}
.mvm-health-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.mvm-health-item.is-online .mvm-health-dot{background:var(--dsw-alias-state-success-primary)}
.mvm-health-item.is-offline .mvm-health-dot{background:var(--dsw-alias-state-error-primary)}
.mvm-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:32px;padding:6px 12px;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap}
.mvm-button:hover:not(:disabled){background:var(--mvm-surface-2)}
.mvm-button:focus-visible,.mvm-icon-button:focus-visible,.mvm-library-open:focus-visible{outline:2px solid var(--mvm-accent);outline-offset:2px}
.mvm-button:disabled,.mvm-icon-button:disabled{opacity:.45;cursor:not-allowed}
.mvm-button-primary{border-color:var(--mvm-accent);background:var(--mvm-accent);color:var(--mvm-on-accent)}
.mvm-button-primary:hover:not(:disabled){background:var(--mvm-accent);opacity:.88}
.mvm-button-danger{color:var(--dsw-alias-state-error-primary)}
.mvm-icon-button{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.mvm-icon-button:hover:not(:disabled){background:var(--mvm-surface-2);color:var(--dsw-alias-label-primary)}
.mvm-settings-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,var(--dsw-alias-bg-overlay) 82%,transparent);backdrop-filter:blur(3px)}
.mvm-settings-modal{width:min(1100px,100%);max-height:88vh;overflow-y:auto;margin:0;box-shadow:var(--mvm-shadow-float)}
.mvm-settings{margin:16px 28px 0;padding:16px 18px;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-lg);background:var(--mvm-surface-1);flex:none}
.mvm-settings-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.mvm-settings-layout{display:grid;grid-template-columns:168px minmax(0,1fr);gap:18px;align-items:start}
.mvm-settings-nav{display:flex;flex-direction:column;gap:4px;padding:5px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-2)}
.mvm-settings-tab{padding:9px 11px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.mvm-settings-tab:hover{background:var(--mvm-surface-1);color:var(--dsw-alias-label-primary)}
.mvm-settings-tab.is-active{background:var(--mvm-accent-soft);color:var(--mvm-accent-ink);font-weight:600;box-shadow:var(--mvm-shadow-card)}
.mvm-settings-content{min-width:0}
@media(max-width:760px){.mvm-settings-layout{grid-template-columns:1fr}.mvm-settings-nav{flex-direction:row;overflow-x:auto}.mvm-settings-tab{white-space:nowrap}}
.mvm-settings-actions{position:sticky;bottom:0;display:flex;justify-content:flex-end;margin-top:16px;padding-top:12px;background:var(--mvm-surface-1);border-top:1px solid var(--mvm-line)}
.mvm-section-title{margin:0;font-size:14px;font-weight:600}
.mvm-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.mvm-settings-section-title{grid-column:1/-1;margin-top:10px;padding-top:12px;border-top:1px solid var(--mvm-line);font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.mvm-settings-row{grid-column:1/-1;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mvm-settings-row .mvm-input{max-width:320px}
.mvm-asr-admin{grid-column:1/-1;display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-2)}
.mvm-asr-status-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mvm-model-picker{display:flex;flex-direction:column;gap:8px;position:relative}
.mvm-model-trigger{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:8px 10px;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.mvm-model-trigger:hover{border-color:var(--mvm-accent)}
.mvm-model-trigger-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mvm-model-caret{flex:none;color:var(--dsw-alias-label-secondary)}
.mvm-model-menu{position:absolute;z-index:20;top:calc(100% + 4px);left:0;right:0;max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:6px;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-overlay);box-shadow:var(--mvm-shadow-float)}
.mvm-model-option{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 8px;border-radius:var(--dsw-radius-sm)}
.mvm-model-option:hover{background:var(--mvm-surface-2)}
.mvm-model-option.is-active{background:var(--mvm-surface-2)}
.mvm-model-option-main{display:flex;align-items:center;gap:10px;flex:1;min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.mvm-model-option-name{font-weight:500;white-space:nowrap}
.mvm-model-option-size{color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
.mvm-model-option-actions{display:flex;align-items:center;gap:6px;flex:none}
.mvm-model-badge{flex:none;padding:2px 8px;border-radius:999px;background:var(--mvm-surface-1);color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-model-badge.is-active{background:var(--mvm-accent);color:var(--mvm-on-accent)}
.mvm-model-badge.is-ready{color:var(--dsw-alias-state-success-primary)}
.mvm-path-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.mvm-model-list-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.mvm-model-actions{display:flex;align-items:center;gap:6px;justify-content:flex-end}
.mvm-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.mvm-field-wide{grid-column:1/-1}
.mvm-label{color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-input,.mvm-textarea{width:100%;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:8px 10px}
.mvm-input:focus,.mvm-textarea:focus{outline:2px solid var(--mvm-accent);outline-offset:1px;border-color:transparent}
.mvm-textarea{resize:vertical;min-height:86px}
.mvm-body{display:grid;grid-template-columns:280px minmax(0,1fr);flex:1;min-height:0}
.mvm-library{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--mvm-line);background:var(--mvm-surface-1)}
.mvm-library-head{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 12px;border-bottom:1px solid var(--mvm-line)}
.mvm-library-list{flex:1;min-height:0;overflow-y:auto;padding:8px}
.mvm-library-item{display:flex;align-items:center;gap:4px;margin-bottom:4px;border:1px solid transparent;border-radius:var(--dsw-radius-sm);box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-library-item.is-active{border-color:var(--mvm-line-strong);background:var(--mvm-surface-2)}
.mvm-library-open{display:flex;flex:1;min-width:0;flex-direction:column;align-items:flex-start;gap:4px;padding:10px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:var(--dsw-radius-sm)}
.mvm-library-name{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.mvm-library-meta{color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-empty{padding:28px 18px;text-align:center;color:var(--dsw-alias-label-secondary)}
.mvm-empty-title{color:var(--dsw-alias-label-primary);font-weight:500;margin-bottom:5px}
.mvm-empty-text{font-size:12px;line-height:1.6}
.mvm-workspace{min-width:0;min-height:0;overflow-y:auto;padding:24px 28px 56px}
.mvm-detail{max-width:none;width:100%;min-height:0;margin:0 auto;display:flex;flex-direction:column;gap:16px}
.mvm-detail-page{width:100%;height:100%;min-height:0;max-width:none;display:flex;flex-direction:column;gap:16px;overflow:hidden}
.mvm-detail-main>.mvm-detail-header,.mvm-detail-main>.mvm-player,.mvm-detail-main>.mvm-detail-tabs,.mvm-detail-main>.mvm-card{flex:none}
.mvm-detail-page .mvm-transcript{width:100%;min-width:0}
.mvm-title-input{width:100%;padding:0 0 12px;border:0;border-bottom:1px solid var(--mvm-line);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:18px;font-weight:600}
.mvm-title-input:focus{outline:0;border-bottom-color:var(--mvm-accent-line)}
.mvm-card{border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-1);overflow:hidden;box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--mvm-line)}
.mvm-card-body{padding:16px}
.mvm-import{display:flex;align-items:center;gap:14px}
.mvm-file-icon{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:var(--dsw-radius-md);background:var(--mvm-surface-2);color:var(--mvm-accent);flex:none}
.mvm-file-meta{flex:1;min-width:0}
.mvm-file-name{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mvm-file-detail{margin-top:3px;color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-import-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.mvm-file-input{display:none}
.mvm-hint{margin-top:12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.mvm-progress{display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--mvm-accent);font-size:12px}
.mvm-spinner{width:13px;height:13px;border:2px solid var(--mvm-line-strong);border-top-color:var(--mvm-accent);border-radius:50%;animation:mvm-spin .7s linear infinite}
@keyframes mvm-spin{to{transform:rotate(360deg)}}
.mvm-transcript{max-height:none;overflow:visible;display:flex;flex-direction:column;gap:2px}
.mvm-segment{display:grid;grid-template-columns:64px max-content minmax(0,1fr);gap:10px;padding:9px 8px;border-radius:var(--dsw-radius-sm)}
.mvm-segment:nth-child(even){background:var(--mvm-surface-2)}
.mvm-time{color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums;padding-top:2px}
.mvm-speaker{color:var(--mvm-accent);font-size:12px;font-weight:600;padding-top:2px;white-space:nowrap}
.mvm-segment-text{white-space:pre-wrap;line-height:1.65}
.mvm-bilingual-segment{align-items:start}
.mvm-original-line{color:var(--dsw-alias-label-primary)}
.mvm-translation-line{margin-top:7px;padding:7px 10px;border-left:2px solid var(--mvm-accent-line);border-radius:0 var(--dsw-radius-sm) var(--dsw-radius-sm) 0;background:var(--mvm-surface-2);color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400;line-height:1.75}
.mvm-translation-skeleton{height:14px;margin-top:8px;border-radius:var(--dsw-radius-xs);background:linear-gradient(90deg,var(--mvm-surface-2),color-mix(in srgb,var(--mvm-line) 45%,var(--mvm-surface-2)),var(--mvm-surface-2));background-size:200% 100%;animation:mvm-shimmer 1.4s infinite}
.mvm-utterance{display:block;padding:18px 0 22px;border-bottom:1px solid var(--mvm-line)}
.mvm-utterance:last-child{border-bottom:0}
.mvm-utterance-head{display:flex;align-items:center;gap:10px;min-height:32px;margin-bottom:12px}
.mvm-utterance-badge{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;border-radius:var(--dsw-radius-sm);background:var(--mvm-accent);color:var(--mvm-surface-1);font-size:12px;font-weight:600}
.mvm-utterance-speaker{display:inline-flex;align-items:center;gap:10px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;font-weight:400;text-align:left;cursor:pointer}
.mvm-utterance-speaker:hover .mvm-utterance-speaker-name{color:var(--mvm-accent)}
.mvm-utterance-speaker-name{color:var(--dsw-alias-label-secondary)}
.mvm-utterance-time{color:var(--dsw-alias-label-secondary);font-size:14px;font-variant-numeric:tabular-nums}
.mvm-utterance-text{display:flex;flex-direction:column;gap:12px;padding-left:44px}
.mvm-utterance-original{color:var(--dsw-alias-label-primary);font-size:16px;line-height:1.75;white-space:pre-wrap}
.mvm-utterance-translation{color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1.75;white-space:pre-wrap}
@media(max-width:900px){.mvm-utterance-text{padding-left:0}}
.mvm-translating-banner{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-2);color:var(--mvm-accent);font-size:12px}
.mvm-translation-progress{flex:1;height:4px;overflow:hidden;border-radius:999px;background:color-mix(in srgb,var(--mvm-line) 40%,var(--mvm-surface-2))}
.mvm-translation-progress span{display:block;height:100%;background:var(--mvm-accent);transition:width .25s ease}
@keyframes mvm-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.mvm-plain-transcript{white-space:pre-wrap;line-height:1.7}
.mvm-summary{padding:14px 16px;border-left:3px solid var(--mvm-accent-line);background:var(--mvm-surface-2);border-radius:var(--dsw-radius-sm);line-height:1.7}
.mvm-minute-section{margin-top:18px}
.mvm-minute-heading{margin:0 0 9px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.mvm-summary-paragraph{margin:0;line-height:1.75}
.mvm-template-badge{padding:2px 8px;border-radius:999px;background:var(--mvm-surface-2);color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-topic-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
.mvm-topic{padding:12px 14px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-2);box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-topic-title{font-weight:600;margin-bottom:5px}
.mvm-topic-text{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.65}
.mvm-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.mvm-list-item{padding:10px 12px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-2)}
.mvm-list-title{font-weight:500}
.mvm-list-detail{margin-top:3px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.mvm-list-meta{margin-top:5px;color:var(--mvm-accent);font-size:12px}
.mvm-ask-answer{margin-top:12px;padding:13px 14px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-2);white-space:pre-wrap;line-height:1.7}
.mvm-ask-label{display:block;margin-bottom:6px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
.mvm-ask-actions{display:flex;justify-content:flex-end;margin-top:10px}
.mvm-alert{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:12px 28px 0;padding:10px 12px;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-sm);font-size:12px;flex:none}
.mvm-alert-error{color:var(--dsw-alias-state-error-primary);background:var(--mvm-surface-1)}
.mvm-alert-notice{color:var(--dsw-alias-state-success-primary);background:var(--mvm-surface-1)}
.mvm-settings-alert{margin:12px 0 0}
.mvm-card-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mvm-view-switch{display:inline-flex;padding:3px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-2)}
.mvm-view-tab{min-height:26px;padding:4px 10px;border:0;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.mvm-view-tab.is-active{background:var(--mvm-accent-soft);color:var(--mvm-accent-ink);font-weight:600}
.mvm-view-tab:focus-visible{outline:2px solid var(--mvm-accent);outline-offset:2px}
.mvm-live-workspace{flex:1;background:var(--mvm-surface-0)}
.mvm-live-container{width:100%;max-width:none;margin:0;display:flex;flex-direction:column;gap:12px}
.mvm-live-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.mvm-live-select{cursor:pointer}
.mvm-live-session-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.mvm-live-metrics{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-live-status-badge{display:inline-flex;align-items:center;gap:8px;padding:4px 10px;border:1px solid var(--mvm-line);border-radius:999px;background:var(--mvm-surface-1);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500}
.mvm-live-status-time{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.mvm-live-diagnostics{font-size:12px;color:var(--dsw-alias-label-secondary)}
.mvm-live-diagnostics-summary{cursor:pointer;padding:4px 8px;border-radius:var(--dsw-radius-sm);user-select:none}
.mvm-live-diagnostics-summary:hover{background:var(--mvm-surface-2)}
.mvm-live-diagnostics-body{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px}
.mvm-live-metric{padding:4px 8px;border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-2);font-variant-numeric:tabular-nums}
.mvm-live-metric.is-degraded{color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-state-error-primary)}
.mvm-live-alert{margin:0;white-space:pre-wrap;word-break:break-word}
.mvm-studio-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(320px,1fr);gap:18px;align-items:start}
.mvm-studio-column{min-width:0;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-1);overflow:hidden;box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-studio-header{display:flex;align-items:center;gap:16px;min-height:56px;padding:12px 16px;border-bottom:1px solid var(--mvm-line)}
.mvm-studio-title{margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em}
.mvm-studio-tabs{display:flex;align-items:center;gap:14px}
.mvm-studio-tab{padding:5px 0;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.mvm-studio-tab.is-active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--mvm-accent-line)}
.mvm-live-events{display:flex;flex-direction:column;max-height:62vh;overflow-y:auto;padding:10px 14px}
.mvm-live-event{padding:12px 14px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-2);margin-bottom:10px}
.mvm-live-event.is-error{border-color:var(--dsw-alias-state-error-primary)}
.mvm-transcript-column .mvm-live-event{border:0;border-bottom:1px solid var(--mvm-line);border-radius:0;background:transparent;padding:12px 4px;margin-bottom:0}
.mvm-summary-column .mvm-live-event{border-color:var(--mvm-accent)}
.mvm-live-event-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:9px;color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-live-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.mvm-live-text-label{display:block;margin-bottom:4px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
.mvm-live-text{white-space:pre-wrap;line-height:1.65;word-break:break-word}
.mvm-live-translation{color:var(--mvm-accent)}
.mvm-live-detail{margin-top:10px;padding-top:9px;border-top:1px solid var(--mvm-line);color:var(--dsw-alias-state-error-primary)}
.mvm-live-detail pre{margin:5px 0 0;white-space:pre-wrap;word-break:break-word;font:inherit;font-size:12px}
.mvm-playback-bar{position:sticky;bottom:0;z-index:2;display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-1)}
.mvm-playback-spacer{flex:1}
.mvm-live-audio{display:none}
.mvm-library-page{display:flex;flex-direction:column;gap:18px;width:100%;max-width:none;margin:0}
.mvm-library-page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.mvm-library-table{display:flex;flex-direction:column;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-lg);overflow-x:auto;background:var(--mvm-surface-1)}
.mvm-library-row{display:grid;grid-template-columns:32px minmax(260px,1.8fr) 150px 90px 120px 110px 90px 40px;align-items:center;gap:14px;width:100%;min-width:1180px;padding:13px 16px;border:0;border-bottom:1px solid var(--mvm-line);background:transparent;color:inherit;font:inherit;text-align:left}
.mvm-library-row:last-child{border-bottom:0}
button.mvm-library-row{cursor:pointer}
button.mvm-library-row:hover{background:var(--mvm-surface-2)}
.mvm-library-head{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;cursor:default}
.mvm-library-title-cell{display:flex;align-items:center;gap:12px;min-width:0}
.mvm-meeting-thumb{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;flex:none;border-radius:var(--dsw-radius-sm);background:var(--mvm-accent);color:var(--mvm-on-accent);font-size:12px;font-weight:600}
.mvm-library-title-copy{display:flex;flex-direction:column;gap:4px;min-width:0}
.mvm-library-title-copy strong,.mvm-library-title-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mvm-library-title-copy small{color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-library-title-cell .mvm-library-open{flex-direction:row;align-items:center;gap:12px;padding:0}
.mvm-library-size-cell{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.mvm-library-actions{display:flex;align-items:center;justify-content:flex-end}
.mvm-library-select-cell{display:flex;align-items:center;justify-content:center}
.mvm-library-row .mvm-library-title-cell{min-width:0}
.mvm-detail-page{width:100%;height:100%;min-height:0;max-width:none;margin:0;display:flex;flex-direction:column;gap:16px;overflow:hidden}
.mvm-detail-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) clamp(340px,26vw,420px);gap:18px;align-items:stretch}
.mvm-detail-main{display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0}
.mvm-detail-main>.mvm-detail-tab-content{flex:1;min-height:0;overflow-y:auto}
.mvm-detail-rail{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-lg);background:var(--mvm-surface-1);box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-rail-header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 16px;border-bottom:1px solid var(--mvm-line);background:var(--mvm-surface-2)}
.mvm-assistant-logo{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:1px solid color-mix(in oklab,var(--mvm-accent) 42%,var(--mvm-line));border-radius:var(--dsw-radius-sm);background:color-mix(in oklab,var(--mvm-accent) 14%,var(--mvm-surface-1));color:var(--mvm-accent);box-shadow:inset 0 1px 0 color-mix(in oklab,var(--dsw-alias-label-primary) 6%,transparent)}
.mvm-assistant-logo svg{stroke-width:1.8}
.mvm-rail-tools{display:flex;align-items:center;gap:8px}
.mvm-rail-scroll{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:16px;padding:14px 16px}
.mvm-rail-tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.mvm-rail-tile{display:flex;align-items:center;gap:9px;padding:11px 12px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-2);color:inherit;font:inherit;text-align:left;cursor:pointer;box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-rail-tile:hover{border-color:var(--mvm-accent);color:var(--mvm-accent)}
.mvm-rail-tile-icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-1);color:var(--mvm-accent)}
.mvm-rail-tile-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.mvm-rail-tile-body strong{font-size:12px;font-weight:600}
.mvm-rail-tile-body small{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4}
.mvm-rail-subtitle{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.mvm-rail-link{padding:0;border:0;background:transparent;color:var(--mvm-accent);font:inherit;font-size:12px;cursor:pointer}
.mvm-rail-label{margin-bottom:8px;color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-rail-suggestion-block{display:flex;flex-direction:column}
.mvm-rail-suggestion{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;margin-bottom:8px;padding:10px 12px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer;box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-rail-suggestion:last-child{margin-bottom:0}
.mvm-rail-suggestion:hover:not(:disabled){border-color:var(--mvm-accent);color:var(--mvm-accent)}
.mvm-rail-suggestion.is-primary{background:var(--mvm-surface-1);border-color:var(--mvm-line-strong)}
.mvm-rail-suggestion:disabled{opacity:.55;cursor:not-allowed}
.mvm-rail-suggestion-text{min-width:0}
.mvm-rail-suggestion-arrow{flex:none;color:var(--dsw-alias-label-secondary)}
.mvm-rail-composer{flex:none;padding:12px 16px;border-top:1px solid var(--mvm-line);background:var(--mvm-surface-1)}
.mvm-chat-empty{padding:2px 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7}
.mvm-compare-dialog{width:min(880px,100%)}
.mvm-compare-body{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:16px}
.mvm-compare-column{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-2);box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-compare-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}
.mvm-compare-flag{padding:2px 7px;border-radius:999px;background:var(--mvm-surface-1);color:var(--dsw-alias-state-warn-primary);font-size:12px}
.mvm-compare-samples{display:flex;flex-direction:column;gap:10px}
.mvm-compare-sample{display:flex;flex-direction:column;gap:4px;padding-bottom:10px;border-bottom:1px solid var(--mvm-line)}
.mvm-compare-sample:last-child{border-bottom:0;padding-bottom:0}
.mvm-compare-source{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.mvm-compare-target{color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.7}
.mvm-speaker-chip{display:inline-flex;align-items:center;padding:2px 7px;border:1px solid var(--mvm-line);border-radius:999px;background:transparent;color:var(--mvm-accent);font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex:none}
.mvm-speaker-chip:hover:not(:disabled){border-color:var(--mvm-accent);background:var(--mvm-surface-2)}
.mvm-speaker-chip.is-named{color:var(--dsw-alias-label-primary)}
.mvm-speaker-editor{display:inline-flex;align-items:center;gap:4px}
.mvm-speaker-input{width:110px;min-height:24px;padding:2px 7px;font-size:12px}
.mvm-voice-list{display:flex;flex-direction:column;max-height:200px;overflow-y:auto}
.mvm-voice-item{padding:0;border-bottom:1px solid var(--mvm-line)}
.mvm-voice-item:last-child{border-bottom:0}
.mvm-voice-button{display:flex;align-items:center;gap:8px;width:100%;padding:9px 13px;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.mvm-voice-button:hover{background:var(--mvm-surface-2)}
.mvm-voice-dot{width:7px;height:7px;flex:none;border-radius:50%;background:var(--dsw-alias-label-secondary)}
.mvm-voice-dot.is-named{background:var(--mvm-accent)}
.mvm-voice-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mvm-voice-rename{display:flex;align-items:center;gap:6px;padding:9px 13px}
.mvm-voice-rename .mvm-input{flex:1;min-width:0;min-height:26px;padding:3px 8px;font-size:12px}
.mvm-rail-card{display:flex;flex-direction:column;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-1);overflow:hidden;box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-rail-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;border-bottom:1px solid var(--mvm-line)}
.mvm-rail-title{margin:0;font-size:13px;font-weight:600;letter-spacing:-.01em}
.mvm-rail-count{padding:2px 8px;border-radius:999px;background:var(--mvm-surface-1);color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-rail-scope{max-width:130px;padding:4px 8px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.mvm-recent-list{display:flex;flex-direction:column;max-height:220px;overflow-y:auto}
.mvm-recent-item{display:block;width:100%;padding:10px 14px;border:0;border-bottom:1px solid var(--mvm-line);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mvm-recent-item:last-child{border-bottom:0}
.mvm-recent-item:hover{background:var(--mvm-surface-2)}
.mvm-recent-item.is-active{background:var(--mvm-surface-2);box-shadow:inset 2px 0 0 var(--mvm-accent)}
.mvm-recent-item-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px}
.mvm-recent-item-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500}
.mvm-recent-item-time{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-recent-item-excerpt{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.mvm-chat-card{flex:1;min-height:340px}
.mvm-chat-messages{flex:1;min-height:120px;max-height:none;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:0}
.mvm-chat-message{display:flex}
.mvm-chat-message.is-user{justify-content:flex-end}
.mvm-chat-message.is-assistant{justify-content:flex-start}
.mvm-chat-bubble{max-width:88%;padding:8px 11px;border-radius:var(--dsw-radius-md);font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
.mvm-chat-message.is-user .mvm-chat-bubble{background:var(--mvm-accent);color:var(--mvm-on-accent);border-bottom-right-radius:var(--dsw-radius-xs)}
.mvm-chat-message.is-assistant .mvm-chat-bubble{border:1px solid var(--mvm-line);border-bottom-left-radius:3px;background:var(--mvm-surface-2);color:var(--dsw-alias-label-primary)}
.mvm-chat-bubble.is-failed{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.mvm-chat-sources{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px}
.mvm-chat-source{padding:4px 9px;border:1px solid var(--mvm-line);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mvm-chat-source:hover{border-color:var(--mvm-accent);color:var(--mvm-accent)}
.mvm-chat-suggestions{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px}
.mvm-chat-chip{padding:5px 10px;border:1px solid var(--mvm-line);border-radius:999px;background:var(--mvm-surface-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.mvm-chat-chip:hover:not(:disabled){border-color:var(--mvm-accent);color:var(--mvm-accent)}
.mvm-chat-chip:disabled{opacity:.55;cursor:not-allowed}
.mvm-chat-input{display:flex;align-items:center;gap:8px;padding:12px 14px;border-top:1px solid var(--mvm-line);background:var(--mvm-surface-1)}
.mvm-chat-input .mvm-input{flex:1;min-width:0}
.mvm-detail-header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:12px 20px;position:relative}
.mvm-breadcrumb{display:flex;align-items:center;gap:8px;min-width:0;font-size:13px;color:var(--dsw-alias-label-secondary)}
.mvm-breadcrumb h2{margin:0;color:var(--dsw-alias-label-primary);font-size:18px;font-weight:600}
.mvm-link-button{padding:0;border:0;background:transparent;color:var(--mvm-accent);font:inherit;cursor:pointer}
.mvm-detail-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.mvm-detail-actions .mvm-button{min-height:30px}
.mvm-detail-search{grid-column:1/-1;width:100%;margin-top:0}
.mvm-translation-menu{position:relative}
.mvm-translation-options{position:absolute;z-index:20;top:calc(100% + 6px);right:0;display:flex;flex-direction:column;min-width:220px;padding:8px;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-overlay);box-shadow:var(--mvm-shadow-float)}
.mvm-translation-options button{padding:8px 10px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mvm-translation-options button:hover,.mvm-translation-options button.is-active{background:var(--mvm-surface-2);color:var(--mvm-accent)}
.mvm-bilingual-toggle{display:flex;align-items:center;gap:8px;margin-top:6px;padding:9px 10px;border-top:1px solid var(--mvm-line);color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-player{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-2);box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-player-timeline{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
.mvm-player-timeline input{flex:1;accent-color:var(--mvm-accent)}
.mvm-player-play{flex:none;min-width:76px;justify-content:center}
.mvm-player-controls{display:flex;align-items:center;gap:12px;padding-top:2px}
.mvm-skip-group{display:inline-flex;align-items:center;gap:3px;padding:3px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-1)}
.mvm-skip-button{display:inline-flex;align-items:center;justify-content:center;gap:3px;height:28px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;cursor:pointer}
.mvm-skip-button:hover:not(:disabled){background:var(--mvm-surface-2);color:var(--dsw-alias-label-primary)}
.mvm-skip-button:focus-visible,.mvm-rate-select:focus-visible{outline:2px solid var(--mvm-accent);outline-offset:2px}
.mvm-rate-control{display:inline-flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-rate-select{height:30px;min-width:74px;padding:0 8px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-1);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600}
.mvm-player-files{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mvm-player-files .mvm-button{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:12px}
.mvm-audio-select{max-width:180px;padding:4px 6px;font-size:12px}
.mvm-voice-error{margin:2px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px}
.mvm-speaker-control{position:relative;display:inline-flex}
.mvm-speaker-count{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid var(--mvm-line);border-radius:999px;background:var(--mvm-surface-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:500;white-space:nowrap;cursor:pointer}
.mvm-speaker-count:hover,.mvm-speaker-count[aria-expanded="true"]{border-color:var(--mvm-accent);color:var(--mvm-accent);background:var(--mvm-surface-1)}
.mvm-speaker-count:focus-visible{outline:2px solid var(--mvm-accent);outline-offset:2px}
.mvm-speaker-popover{position:absolute;z-index:35;top:calc(100% + 8px);left:0;width:320px;max-width:calc(100vw - 48px);overflow:hidden;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-lg);background:var(--mvm-surface-1);box-shadow:var(--mvm-shadow-float)}
.mvm-speaker-popover-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--mvm-line);color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}
.mvm-speaker-list{display:flex;flex-direction:column;max-height:260px;overflow-y:auto;padding:5px}
.mvm-speaker-person-row{display:flex;align-items:center;gap:3px;min-width:0;padding:0 3px}
.mvm-speaker-person-row .mvm-speaker-person,.mvm-speaker-person-row .mvm-speaker-editor-row{flex:1;min-width:0}
.mvm-speaker-play{flex:none;margin-left:2px}
.mvm-speaker-error{padding:0 14px 10px}
.mvm-speaker-person{display:flex;align-items:center;gap:9px;width:100%;min-height:38px;padding:7px 9px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.mvm-speaker-person:hover{background:var(--mvm-surface-2)}
.mvm-speaker-person-dot{width:8px;height:8px;flex:none;border-radius:50%;background:var(--dsw-alias-label-secondary)}
.mvm-speaker-person-dot.is-named{background:var(--mvm-accent)}
.mvm-speaker-person-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mvm-speaker-editor-row{display:flex;align-items:center;gap:6px;padding:6px}
.mvm-speaker-name-input{flex:1;min-width:0;min-height:30px;padding:4px 8px;font-size:12px}
.mvm-speaker-save{flex:none;min-height:30px;padding:4px 9px}
.mvm-speaker-hint{margin:0;padding:10px 14px;border-top:1px solid var(--mvm-line);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.55}
.mvm-speaker-empty{padding:18px 14px;color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center}
.mvm-detail-tabs{display:flex;align-items:center;gap:8px 20px;flex-wrap:wrap;border-bottom:1px solid var(--mvm-line)}
.mvm-detail-tab{padding:9px 0;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.mvm-detail-tab.is-active{color:var(--mvm-accent-line);border-bottom-color:var(--mvm-accent-line);font-weight:600}
.mvm-detail-tab-content{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:16px;min-width:0}
.mvm-edit-transcript{min-height:360px;font-family:inherit;line-height:1.65}
.mvm-summary-hero{display:flex;flex-direction:column;gap:8px;padding:22px 20px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-2);box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-summary-hero h2{margin:0;font-size:18px;font-weight:600}
.mvm-summary-hero p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);line-height:1.7}
.mvm-summary-stats{display:flex;gap:18px;margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-outline{display:flex;flex-direction:column;gap:4px}
.mvm-outline h3{margin:0 0 8px;font-size:16px}
.mvm-outline-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border:0;border-bottom:1px solid var(--mvm-line);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mvm-outline-item:hover{color:var(--mvm-accent)}
.mvm-outline-item span{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.mvm-viewpoint-tree{display:flex;flex-direction:column;gap:18px}
.mvm-viewpoint-group{display:flex;flex-direction:column;gap:10px;padding-left:14px;border-left:2px solid var(--mvm-accent-line)}
.mvm-viewpoint-group h3{margin:0;font-size:14px;color:var(--mvm-accent)}
.mvm-viewpoint-cards{display:flex;flex-direction:column;gap:8px}
.mvm-viewpoint-card{padding:12px 14px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-2)}
.mvm-viewpoint-card p{margin:6px 0 0;line-height:1.65}
.mvm-viewpoint-card small{display:block;margin-top:8px;color:var(--dsw-alias-state-warn-primary)}
.mvm-mindmap{gap:24px}
.mvm-mindmap-group{position:relative;display:flex;flex-direction:column;gap:12px;padding-left:24px;--mind-color:var(--mvm-accent)}
.mvm-mindmap-group::before{content:"";position:absolute;left:6px;top:12px;bottom:12px;width:2px;background:color-mix(in oklab,var(--mind-color) 42%,var(--mvm-line))}
.mvm-mindmap-group.tone-0{--mind-color:var(--dsw-alias-state-business-primary)}
.mvm-mindmap-group.tone-1{--mind-color:var(--dsw-alias-state-success-primary)}
.mvm-mindmap-group.tone-2{--mind-color:var(--dsw-alias-state-warn-primary)}
.mvm-mindmap-group.tone-3{--mind-color:var(--mvm-accent)}
.mvm-mindmap-group.tone-4{--mind-color:var(--dsw-alias-state-error-primary)}
.mvm-mindmap-theme{position:relative;align-self:flex-start;margin:0;padding:6px 12px;border:1px solid color-mix(in oklab,var(--mind-color) 30%,var(--mvm-line));border-radius:999px;background:color-mix(in oklab,var(--mind-color) 16%,var(--mvm-surface-1));color:color-mix(in oklab,var(--mind-color) 82%,var(--dsw-alias-label-primary));font-size:13px;font-weight:600;line-height:1.4}
.mvm-mindmap-theme::before{content:"";position:absolute;left:-24px;top:50%;width:18px;height:2px;background:color-mix(in oklab,var(--mind-color) 46%,var(--mvm-line))}
.mvm-mindmap-children{display:flex;flex-direction:column;gap:10px}
.mvm-mindmap-branch{position:relative;padding:12px 14px;border:1px solid color-mix(in oklab,var(--mind-color) 24%,var(--mvm-line));border-radius:var(--dsw-radius-md);background:color-mix(in oklab,var(--mind-color) 9%,var(--mvm-surface-1));box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-mindmap-branch::before,.mvm-mindmap-comparison::before{content:"";position:absolute;left:-20px;top:22px;width:18px;height:2px;background:color-mix(in oklab,var(--mind-color) 42%,var(--mvm-line))}
.mvm-mindmap-comparison{position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid color-mix(in oklab,var(--mind-color) 24%,var(--mvm-line));border-radius:var(--dsw-radius-md);background:color-mix(in oklab,var(--mind-color) 9%,var(--mvm-surface-1));overflow:hidden;box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-mindmap-compare-item{min-width:0;padding:12px 14px}
.mvm-mindmap-compare-item+.mvm-mindmap-compare-item{border-left:1px solid color-mix(in oklab,var(--mind-color) 22%,var(--mvm-line))}
.mvm-mindmap-stance{display:block;color:color-mix(in oklab,var(--mind-color) 82%,var(--dsw-alias-label-primary));font-size:13px;font-weight:600;line-height:1.45}
.mvm-mindmap-detail{margin:6px 0 0;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.65;white-space:pre-wrap}
.mvm-mindmap-risk{display:block;margin-top:8px;color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:1.5}
@media(max-width:900px){.mvm-mindmap-comparison{grid-template-columns:1fr}.mvm-mindmap-compare-item+.mvm-mindmap-compare-item{border-top:1px solid color-mix(in oklab,var(--mind-color) 22%,var(--mvm-line));border-left:0}}
.mvm-chapter-toolbar{display:flex;justify-content:flex-start}
.mvm-chapter-list{display:flex;flex-direction:column}
.mvm-chapter-row{display:grid;grid-template-columns:64px minmax(0,1fr) 64px;gap:12px;align-items:center;padding:12px 0;border:0;border-bottom:1px solid var(--mvm-line);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mvm-chapter-row.is-active{color:var(--mvm-accent)}
.mvm-chapter-detail{padding:16px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-2)}
.mvm-chapter-detail h3{margin:8px 0;font-size:16px}
.mvm-chapter-detail p{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.75}
.mvm-share-backdrop{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-overlay)}
.mvm-share-dialog{width:min(560px,100%);max-height:85vh;overflow-y:auto;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-lg);background:var(--mvm-surface-1);box-shadow:var(--mvm-shadow-float)}
.mvm-share-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--mvm-line)}
.mvm-share-content{display:flex;flex-direction:column;gap:14px;padding:18px}
.mvm-share-actions{display:flex;justify-content:flex-end}

/* live studio */
.mvm-live-header{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
.mvm-live-intro{display:flex;flex:1 1 280px;min-width:240px;flex-direction:column;gap:2px}
.mvm-live-back{align-self:flex-start;margin-bottom:6px}
.mvm-live-topbar{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.mvm-live-language{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.mvm-live-language-label{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.mvm-live-language .mvm-live-select{height:32px;min-width:132px;padding:4px 8px;font-size:12px}
.mvm-live-language:first-child .mvm-live-select{min-width:172px}
.mvm-live-track-filter{display:inline-flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.mvm-live-track-filter .mvm-live-select{height:30px;min-width:108px;padding:3px 8px;font-size:12px}
.mvm-live-topbar .mvm-button{white-space:nowrap}
.mvm-live-divider{width:1px;height:26px;background:var(--mvm-line)}
.mvm-incognito-badge{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border:1px solid var(--mvm-line);border-radius:999px;background:var(--mvm-surface-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.mvm-incognito-badge.is-on{border-color:var(--mvm-accent);color:var(--mvm-accent)}
.mvm-incognito-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-secondary)}
.mvm-incognito-badge.is-on .mvm-incognito-dot{background:var(--mvm-accent)}
.mvm-live-control-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:20px;z-index:30;display:flex;align-items:center;justify-content:center;gap:10px;max-width:calc(100vw - 40px);padding:10px 16px;border:1px solid var(--mvm-line-strong);border-radius:999px;background:var(--mvm-surface-1);box-shadow:var(--mvm-shadow-float)}
.mvm-live-workspace{padding-bottom:104px}
.mvm-live-banner{display:flex;align-items:center;gap:10px;margin:12px 0 0;padding:10px 14px;border:1px solid var(--dsw-alias-state-success-primary);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-1);color:var(--dsw-alias-label-primary);font-size:12px}
.mvm-live-banner .mvm-pulse-dot{background:var(--dsw-alias-state-success-primary)}
.mvm-live-banner-text{flex:1;min-width:0}
.mvm-back-button{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
.mvm-back-button:hover{border-color:var(--mvm-accent);color:var(--mvm-accent)}
.mvm-back-arrow{font-size:14px;line-height:1}
.mvm-detail-tabs-spacer{flex:1}
.mvm-transcript-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-bottom:6px}
.mvm-toggle-field{flex-direction:row;align-items:flex-start;gap:10px;grid-column:1/-1}
.mvm-toggle-field input[type=checkbox]{margin-top:3px;width:16px;height:16px;flex:none;accent-color:var(--mvm-accent)}
.mvm-toggle-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.mvm-home{width:100%;max-width:1160px;margin:0 auto;display:flex;flex-direction:column;gap:18px;min-height:0}
.mvm-home-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mvm-stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.mvm-stat-card{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-1);box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-stat-card.is-live{border-color:var(--dsw-alias-state-success-primary)}
.mvm-stat-value{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.mvm-stat-label{color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-home-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mvm-home-toolbar .mvm-library-search{max-width:280px}
.mvm-view-toggle{display:flex;align-items:center;gap:2px}
.mvm-view-toggle .mvm-icon-button{color:var(--dsw-alias-label-secondary)}
.mvm-view-toggle .mvm-icon-button.is-active{color:var(--mvm-accent);background:var(--mvm-surface-2)}
.mvm-icon-button.is-favorite{color:var(--dsw-alias-state-warn-primary)}
.mvm-meeting-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.mvm-meeting-card{display:flex;flex-direction:column;gap:10px;min-width:0;padding:14px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-1);box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-meeting-card:hover{border-color:var(--mvm-line-strong);background:var(--mvm-surface-2)}
.mvm-meeting-card.is-live{border-color:var(--dsw-alias-state-success-primary)}
.mvm-meeting-card-head{display:flex;align-items:flex-start;gap:10px;min-width:0}
.mvm-meeting-card-titles{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.mvm-meeting-card-title{padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;font-weight:600;text-align:left;cursor:pointer;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.mvm-meeting-card-title:hover{color:var(--mvm-accent)}
.mvm-meeting-card-meta{color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-meeting-card-star{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:color var(--mvm-dur-fast) ease,transform var(--mvm-dur-fast) ease}
.mvm-meeting-card-star:hover{color:var(--dsw-alias-state-warn-primary)}
.mvm-meeting-card-star:active{transform:scale(.97)}
.mvm-meeting-card-star.is-favorite{color:var(--dsw-alias-state-warn-primary)}
.mvm-meeting-card-excerpt{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.65;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mvm-meeting-card-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:auto;font-size:12px;color:var(--dsw-alias-label-secondary)}
.mvm-meeting-card-status{padding:2px 8px;border:1px solid var(--mvm-line);border-radius:999px;white-space:nowrap;flex:none}
.mvm-meeting-card-source{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:0 1 auto}
.mvm-home-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:48px 20px;border:1px dashed var(--mvm-line-strong);border-radius:var(--dsw-radius-lg);text-align:center}
.mvm-drawer-backdrop{position:fixed;inset:0;z-index:40;background:color-mix(in srgb,var(--dsw-alias-bg-overlay) 45%,transparent)}
.mvm-assistant-drawer{position:fixed;top:0;right:0;bottom:0;z-index:41;display:flex;flex-direction:column;width:min(420px,100vw);border-left:1px solid var(--mvm-line);background:var(--mvm-surface-1);box-shadow:var(--mvm-shadow-drawer)}
.mvm-detail-reader{display:flex;flex-direction:column;gap:16px;width:100%;max-width:1040px;margin:0 auto;min-height:0;flex:1;overflow-y:auto;padding-right:2px}
.mvm-summary-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mvm-template-picker{display:flex;align-items:center;gap:6px}
.mvm-template-picker .mvm-label{margin:0;white-space:nowrap}
.mvm-template-select{max-width:220px;min-height:30px;padding:4px 8px;font-size:12px}
.mvm-library-progress-pill.is-inline{margin-left:8px;padding:2px 9px;gap:5px;font-size:12px;font-weight:600;vertical-align:middle}
.mvm-pulse-dot{width:7px;height:7px;flex:none;border-radius:50%;background:var(--mvm-accent);animation:mvm-live-pulse 1.6s infinite}
.mvm-library-live-link{margin-top:4px;padding:0;border:0;background:transparent;color:var(--mvm-accent);font:inherit;font-size:12px;text-decoration:underline;cursor:pointer;white-space:nowrap;flex:none}
.mvm-library-title-row{display:flex;align-items:center;gap:4px;min-width:0;flex-wrap:wrap}
.mvm-voice-item.is-unnamed{opacity:.9}
.mvm-voice-play{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none;border:1px solid var(--mvm-line);border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.mvm-voice-play:hover{color:var(--mvm-accent);border-color:var(--mvm-accent)}
.mvm-voice-row{display:flex;align-items:center;gap:8px;width:100%;padding:8px 13px}
.mvm-voice-group-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 13px;border-top:1px solid var(--mvm-line);color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;background:transparent;border-left:0;border-right:0;border-bottom:0;width:100%;font-family:inherit;text-align:left}
.mvm-voicebook-trigger-wrap{position:relative;display:inline-flex}
.mvm-voicebook-trigger{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 10px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
.mvm-voicebook-trigger:hover,.mvm-voicebook-trigger[aria-expanded="true"]{border-color:var(--mvm-accent);color:var(--mvm-accent);background:var(--mvm-surface-2)}
.mvm-voicebook-trigger-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--mvm-surface-2);color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}
.mvm-voicebook-panel{position:absolute;z-index:36;top:calc(100% + 8px);right:0;width:360px;max-width:calc(100vw - 48px);max-height:min(560px,72vh);overflow-y:auto;display:flex;flex-direction:column;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-lg);background:var(--mvm-surface-1);box-shadow:var(--mvm-shadow-float)}
.mvm-voicebook-panel-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--mvm-line);background:var(--mvm-surface-1)}
.mvm-voicebook-panel-title{display:flex;align-items:center;gap:7px;flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}
.mvm-voicebook-panel-title>svg{flex:none;color:var(--mvm-accent)}
.mvm-voicebook-count{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 7px;border:1px solid var(--mvm-line);border-radius:999px;background:var(--mvm-surface-2);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;font-variant-numeric:tabular-nums}
.mvm-voicebook-empty-state{display:flex;flex-direction:column;align-items:center;gap:6px;padding:24px 18px;text-align:center;color:var(--dsw-alias-label-secondary)}
.mvm-voicebook-empty-state>svg{color:var(--mvm-accent);opacity:.85}
.mvm-voicebook-empty-state strong{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}
.mvm-voicebook-empty-state span{font-size:12px;line-height:1.6}
.mvm-voicebook-note{display:flex;align-items:flex-start;gap:6px;margin:0;padding:9px 12px;border-top:1px solid var(--mvm-line);color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.5}
.mvm-voicebook-note>svg{flex:none;margin-top:1px;color:var(--mvm-accent)}
.mvm-voicebook-group svg{flex:none;transition:transform var(--mvm-dur-fast) ease}
.mvm-voicebook-group svg.is-open{transform:rotate(180deg)}
.mvm-voicebook-tools{padding:10px 12px;border-top:1px solid var(--mvm-line);border-bottom:1px solid var(--mvm-line);background:var(--mvm-surface-2)}
.mvm-voicebook-search-input{width:100%;min-height:32px;padding:5px 9px;font-size:12px;background:var(--mvm-surface-1)}
.mvm-voicebook-filters{display:flex;align-items:center;gap:4px;margin-top:8px;padding:3px;border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-1)}
.mvm-voicebook-filter{flex:1;min-width:0;min-height:26px;padding:3px 6px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
.mvm-voicebook-filter:hover{color:var(--dsw-alias-label-primary)}
.mvm-voicebook-filter.is-active{background:var(--mvm-surface-2);color:var(--mvm-accent);box-shadow:var(--mvm-shadow-card),var(--mvm-edge)}
.mvm-voicebook-list{flex:none;max-height:280px;padding:4px;gap:4px}
.mvm-voicebook-row{gap:8px;padding:6px 8px;border-radius:var(--dsw-radius-sm)}
.mvm-voicebook-row:hover{background:var(--mvm-surface-2)}
.mvm-voicebook-play{width:28px;height:28px;border:0;background:color-mix(in oklab,var(--mvm-accent) 12%,var(--mvm-surface-1));color:var(--mvm-accent)}
.mvm-voicebook-play:hover{background:color-mix(in oklab,var(--mvm-accent) 20%,var(--mvm-surface-1))}
.mvm-voice-name-button{flex:1;min-width:0;gap:10px;padding:2px 4px}
.mvm-voice-name-button:hover{background:transparent}
.mvm-voice-name-block{display:flex;flex:1;min-width:0;flex-direction:column;align-items:flex-start;gap:1px}
.mvm-voice-name{font-size:13px;font-weight:600}
.mvm-voice-meta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}
.mvm-voice-edit-icon{flex:none;color:var(--dsw-alias-label-secondary)}
.mvm-voicebook-group{margin-top:4px;padding:8px 10px;font-weight:500}
.mvm-voicebook-rename{margin:4px 8px;padding:8px;border-radius:var(--dsw-radius-sm);background:var(--mvm-surface-2)}
.mvm-voicebook-empty{padding:20px 12px;color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center}
.mvm-voicebook-trigger:focus-visible,.mvm-voicebook-filter:focus-visible,.mvm-voicebook-play:focus-visible,.mvm-voice-name-button:focus-visible,.mvm-voicebook-group:focus-visible{outline:2px solid var(--mvm-accent);outline-offset:2px}
.mvm-live-recording-dots{display:inline-flex;align-items:center;gap:4px}
.mvm-live-recording-dots span{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-secondary)}
.mvm-live-recording-dots.is-live span{background:var(--dsw-alias-state-error-primary);animation:mvm-live-pulse 1.2s infinite}
.mvm-live-recording-dots.is-live span:nth-child(2){animation-delay:.2s}
.mvm-live-recording-dots.is-live span:nth-child(3){animation-delay:.4s}
@keyframes mvm-live-pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1.1)}}
.mvm-live-timer{min-width:48px;font-variant-numeric:tabular-nums;font-size:13px;color:var(--dsw-alias-label-primary)}
.mvm-live-control-button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid var(--mvm-line);border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.mvm-live-control-button:hover{color:var(--mvm-accent);border-color:var(--mvm-accent)}
.mvm-live-topic{display:flex;flex-direction:column;gap:10px;padding:12px 14px}
.mvm-live-topic-chip{align-self:flex-start;padding:6px 14px;border-radius:999px;background:var(--dsw-alias-state-success-primary);color:var(--mvm-surface-1);font-size:12px;font-weight:600}
.mvm-live-topic-children{display:flex;flex-direction:column;gap:10px;margin-left:18px;padding-left:14px;border-left:1px solid var(--mvm-line)}
.mvm-live-topic-card{padding:12px 14px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-2)}
.mvm-live-skeletons{display:flex;flex-direction:column;gap:10px;margin-left:18px}
.mvm-live-skeleton{display:block;height:14px;border-radius:var(--dsw-radius-sm);background:linear-gradient(90deg,var(--mvm-surface-2),color-mix(in srgb,var(--mvm-line) 45%,var(--mvm-surface-2)),var(--mvm-surface-2));background-size:200% 100%;animation:mvm-shimmer 1.4s infinite}
.mvm-live-skeleton:nth-child(2){width:80%}
.mvm-live-skeleton:nth-child(3){width:62%}
.mvm-live-summary-footer{margin:12px 14px;padding:9px 12px;border-radius:var(--dsw-radius-md);background:var(--mvm-surface-2);color:var(--dsw-alias-label-secondary);font-size:12px}
.mvm-live-event.is-provisional .mvm-live-text{color:var(--dsw-alias-label-secondary)}
.mvm-live-event.is-provisional{opacity:.92}
.mvm-live-event.is-corrected .mvm-live-text{color:var(--dsw-alias-label-primary)}
.mvm-pass-badge{display:inline-flex;align-items:center;gap:5px;padding:1px 7px;border-radius:999px;font-size:12px;line-height:1.6;font-weight:500}
.mvm-pass-badge.is-provisional{border:1px dashed var(--mvm-line-strong);color:var(--dsw-alias-label-secondary)}
.mvm-pass-dot{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-secondary);animation:mvm-live-pulse 1.6s infinite}
.mvm-pass-badge.is-corrected{border:1px solid var(--mvm-line);color:var(--dsw-alias-label-secondary)}
.mvm-live-hotwords{max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mvm-live-marker{display:flex;align-items:center;gap:8px;margin:6px 0;padding:6px 10px;border-left:2px solid var(--mvm-accent-line);border-radius:0 var(--dsw-radius-sm) var(--dsw-radius-sm) 0;background:var(--mvm-surface-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.mvm-live-marker-kind{flex:none;color:var(--mvm-accent);font-weight:600}
.mvm-live-marker.is-flag{border-left-color:var(--dsw-alias-state-warn-primary)}
.mvm-live-marker.is-flag .mvm-live-marker-kind{color:var(--dsw-alias-state-warn-primary)}
.mvm-live-alert-body{display:flex;flex-direction:column;gap:4px}
.mvm-live-alert-actions{display:flex;align-items:center;gap:8px}
/* library */
.mvm-library-shell{display:grid;grid-template-columns:minmax(0,1fr) clamp(320px,26vw,400px);gap:18px;flex:1;min-height:0}
.mvm-library-main{display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0;overflow-y:auto}
.mvm-library-header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;position:relative}
.mvm-library-overflow{position:absolute;z-index:20;top:calc(100% + 6px);right:0;display:flex;flex-direction:column;min-width:170px;padding:6px;border:1px solid var(--mvm-line-strong);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-overlay);box-shadow:var(--mvm-shadow-float)}
.mvm-library-overflow button{padding:7px 10px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.mvm-library-overflow button:hover{background:var(--mvm-surface-2)}
.mvm-library-search{flex:1;min-width:220px}
.mvm-library-progress-pill{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;background:var(--dsw-alias-state-success-primary);color:var(--mvm-surface-1);font-size:12px;font-weight:600}
.mvm-template-section{display:flex;flex-direction:column;gap:10px}
.mvm-template-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.mvm-template-card{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-1);color:inherit;font:inherit;text-align:left;cursor:pointer}
.mvm-template-card:hover{border-color:var(--mvm-accent)}
.mvm-template-card.is-active{border-color:var(--mvm-accent-line);box-shadow:inset 0 0 0 1px var(--mvm-accent)}
.mvm-template-name{font-size:13px;font-weight:600}
.mvm-template-desc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.mvm-template-more{padding:12px;border:1px dashed var(--mvm-line-strong);border-radius:var(--dsw-radius-md);background:transparent;color:var(--mvm-accent);font:inherit;font-size:12px;cursor:pointer}
.mvm-library-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.mvm-library-filter{padding:6px 12px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.mvm-library-filter.is-active{background:var(--mvm-surface-2);color:var(--dsw-alias-label-primary);font-weight:600}
.mvm-library-select-cell{display:flex;align-items:center;justify-content:center}
.mvm-library-progress{display:inline-flex;align-items:center;gap:6px;margin-top:4px;padding:3px 9px;border-radius:999px;background:var(--dsw-alias-state-success-primary);color:var(--mvm-surface-1);font-size:12px;font-weight:600;animation:mvm-live-pulse 1.8s infinite}
.mvm-library-live-link{align-self:flex-start;margin-top:6px;padding:0;border:0;background:transparent;color:var(--mvm-accent);font:inherit;font-size:12px;cursor:pointer}
.mvm-library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.mvm-library-grid .mvm-library-row{grid-template-columns:32px minmax(0,1fr) 40px;grid-template-rows:auto;align-items:start;gap:8px 12px;min-width:0;padding:12px 14px;border:1px solid var(--mvm-line);border-radius:var(--dsw-radius-md);background:var(--mvm-surface-2)}
.mvm-library-grid .mvm-library-title-cell{grid-column:2 / -1;grid-row:1}
.mvm-library-grid .mvm-library-select-cell{grid-column:1;grid-row:1}
.mvm-library-grid .mvm-library-actions{grid-column:3;grid-row:1;justify-content:flex-end}
.mvm-library-grid .mvm-library-row>span:not(.mvm-library-select-cell):not(.mvm-library-title-cell):not(.mvm-library-actions){grid-column:2 / -1;text-align:left}

/* one focus ring for every control the page owns */
.mvm-page button:focus-visible,.mvm-page input:focus-visible,.mvm-page select:focus-visible,.mvm-page textarea:focus-visible,.mvm-page summary:focus-visible,.mvm-page [tabindex]:focus-visible{outline:2px solid var(--mvm-accent);outline-offset:2px}

/* motion — only transform and opacity move */
.mvm-button,.mvm-icon-button,.mvm-quick-button,.mvm-view-tab,.mvm-settings-tab,.mvm-detail-tab,.mvm-studio-tab,.mvm-library-filter,.mvm-model-option,.mvm-translation-options button,.mvm-library-overflow button,.mvm-rail-tile,.mvm-rail-suggestion,.mvm-chat-chip,.mvm-chat-source,.mvm-speaker-chip,.mvm-template-card,.mvm-back-button,.mvm-incognito-badge,.mvm-library-item,.mvm-library-open{transition:background-color var(--mvm-dur-fast) ease,border-color var(--mvm-dur-fast) ease,color var(--mvm-dur-fast) ease,box-shadow var(--mvm-dur) var(--mvm-ease),transform var(--mvm-dur-fast) ease}
.mvm-button:active:not(:disabled),.mvm-icon-button:active:not(:disabled),.mvm-quick-button:active:not(:disabled),.mvm-view-tab:active:not(:disabled),.mvm-settings-tab:active:not(:disabled),.mvm-detail-tab:active:not(:disabled),.mvm-studio-tab:active:not(:disabled),.mvm-library-filter:active:not(:disabled),.mvm-rail-tile:active:not(:disabled),.mvm-rail-suggestion:active:not(:disabled),.mvm-chat-chip:active:not(:disabled),.mvm-chat-source:active:not(:disabled),.mvm-speaker-chip:active:not(:disabled),.mvm-template-card:active:not(:disabled),.mvm-back-button:active:not(:disabled),.mvm-incognito-badge:active:not(:disabled){transform:scale(.97)}
.mvm-model-menu,.mvm-translation-options,.mvm-library-overflow,.mvm-settings-modal,.mvm-share-dialog{animation:mvm-float-in var(--mvm-dur) var(--mvm-ease)}
.mvm-assistant-drawer{animation:mvm-fade-in var(--mvm-dur) var(--mvm-ease)}
@keyframes mvm-float-in{from{opacity:0;transform:scale(.93)}to{opacity:1;transform:scale(1)}}
@keyframes mvm-fade-in{from{opacity:0}to{opacity:1}}

/* the live ribbon — the plugin's signature device */
.mvm-ribbon{display:flex;align-items:center;gap:10px;min-width:220px}
.mvm-ribbon-track{position:relative;display:flex;align-items:center;justify-content:space-between;gap:2px;width:196px;height:28px;padding-bottom:6px}
.mvm-ribbon-bars{position:absolute;left:0;top:0;right:0;bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:2px;overflow:hidden}
.mvm-ribbon-bar{width:3px;height:100%;border-radius:var(--dsw-radius-xs);background:var(--mvm-accent-line);transform:scaleY(.08);transform-origin:center;transition:transform 120ms var(--mvm-ease),background-color var(--mvm-dur-fast) ease}
.mvm-ribbon.is-live .mvm-ribbon-bar{background:var(--mvm-accent)}
.mvm-ribbon-rule{position:absolute;left:0;right:0;bottom:0;height:2px;border-radius:999px;background:var(--mvm-accent);transform-origin:left center;transform:scaleX(.35);opacity:.55;animation:mvm-ribbon-breathe 2.4s var(--mvm-ease) infinite}
@keyframes mvm-ribbon-breathe{0%,100%{transform:scaleX(.35);opacity:.45}50%{transform:scaleX(1);opacity:.95}}
.mvm-ribbon-label{color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap}
@media(max-width:1400px){.mvm-library-shell{grid-template-columns:1fr}}
@media(max-width:1240px){.mvm-detail-body{grid-template-columns:1fr}.mvm-detail-rail{overflow:visible}}
@media(max-width:1100px){.mvm-live-header{align-items:flex-start;flex-direction:column;gap:10px}.mvm-live-topbar{justify-content:flex-start}}
@media(max-width:960px){.mvm-studio-grid{grid-template-columns:1fr}.mvm-detail-header{grid-template-columns:1fr}.mvm-detail-actions{justify-content:flex-start}.mvm-library-page-head{flex-direction:column}}
@media(max-width:760px){.mvm-live-controls,.mvm-live-pair{grid-template-columns:1fr}.mvm-playback-bar{flex-wrap:wrap}}
@media(max-width:900px){.mvm-header{padding:18px;flex-direction:column}.mvm-header-actions{justify-content:flex-start}.mvm-settings{margin:12px 18px 0}.mvm-settings-grid{grid-template-columns:1fr}.mvm-body{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.mvm-library{max-height:220px;border-right:0;border-bottom:1px solid var(--mvm-line)}.mvm-workspace{padding:18px}.mvm-import{align-items:flex-start;flex-wrap:wrap}.mvm-segment{grid-template-columns:54px max-content minmax(0,1fr);gap:6px}.mvm-alert{margin:10px 18px 0}}
@media(prefers-reduced-motion:reduce){.mvm-page *,.mvm-page *::before,.mvm-page *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}.mvm-ribbon-rule{animation:none;transform:scaleX(1);opacity:.9}}
`;

    function Icon({ name, size = 16, fill = 'none' }) {
      const paths = {
        mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm-7-3a7 7 0 0 0 14 0M12 19v3m-4 0h8',
        plus: 'M12 5v14M5 12h14',
        settings: 'M12.22 2h-.44a2 2 0 0 0-2 1.72l-.12.85a2 2 0 0 1-1.18 1.52l-.2.09a2 2 0 0 1-1.9 0l-.69-.34a2 2 0 0 0-2.61.77l-.22.38a2 2 0 0 0 .73 2.62l.6.44a2 2 0 0 1 .72 1.64v.22a2 2 0 0 1-.72 1.64l-.6.44a2 2 0 0 0-.73 2.62l.22.38a2 2 0 0 0 2.61.77l.69-.34a2 2 0 0 1 1.9 0l.2.09a2 2 0 0 1 1.18 1.52l.12.85a2 2 0 0 0 2 1.72h.44a2 2 0 0 0 2-1.72l.12-.85a2 2 0 0 1 1.18-1.52l.2-.09a2 2 0 0 1 1.9 0l.69.34a2 2 0 0 0 2.61-.77l.22-.39a2 2 0 0 0-.73-2.61l-.6-.44a2 2 0 0 1-.72-1.64v-.22a2 2 0 0 1 .72-1.64l.6-.44a2 2 0 0 0 .73-2.61l-.22-.39a2 2 0 0 0-2.61-.77l-.69.34a2 2 0 0 1-1.9 0l-.2-.09a2 2 0 0 1-1.18-1.52l-.12-.85a2 2 0 0 0-2-1.72ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
        window: 'M3.5 5.5A1.5 1.5 0 0 1 5 4h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-13Zm10 2h6v5h-6V7.5Z',
        refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
        rewind: 'M11 19 2 12l9-7v14Zm11 0-9-7 9-7v14Z',
        forward: 'm13 5 9 7-9 7V5ZM2 5l9 7-9 7V5Z',
        users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
        file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8M8 17h5',
        play: 'm8 5 11 7-11 7Z',
        pause: 'M8 5v14M16 5v14',
        sparkles: 'm12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z',
        save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM17 21v-8H7v8M7 3v5h8',
        trash: 'M3 6h18M8 6V4h8v2m3 0-1 16H6L5 6m5 4v8m4-8v8',
        close: 'M18 6 6 18M6 6l12 12',
        ask: 'M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z',
        folder: 'M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
        edit: 'M4 20h4l10-10-4-4L4 16v4Zm10-14 4 4',
        flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
        list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
        grid: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
        star: 'M12 2.6l3.05 6.18 6.82.99-4.94 4.81 1.17 6.79L12 18.2l-6.1 3.21 1.17-6.79L2.13 9.77l6.82-.99L12 2.6Z',
        'arrow-left': 'M19 12H5m7 7-7-7 7-7',
        'arrow-right': 'M5 12h14m-7-7 7 7-7 7',
        caret: 'm6 9 6 6 6-6',
      };
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill,
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': 'true',
      }, h('path', { d: paths[name] || paths.file }));
    }

    const QUICK_CSS = [
      '.mvm-quick{display:inline-flex}',
      '.mvm-quick-button{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color 100ms ease,color 100ms ease,transform 100ms ease}',
      '.mvm-quick-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.mvm-quick-button:active:not(:disabled){transform:scale(.97)}',
      '.mvm-quick-button.is-busy{opacity:.45}',
      '.mvm-quick-button.is-failed{color:var(--dsw-alias-state-error-primary)}',
    ].join('');

    /**
     * Install the plugin's stylesheets once, in the document head.
     *
     * The sheet used to live inside the React tree, so every render rebuilt
     * and re-parsed the whole thing. The module system removes the elements
     * with the plugin.
     *
     * @returns {() => void} the cleanup
     */
    function installStyles() {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function' || !document.head) {
        return () => {};
      }
      const sheets = [
        { id: 'page', css: CSS },
        { id: 'quick', css: QUICK_CSS },
      ];
      const elements = sheets.map((sheet) => {
        const element = document.createElement('style');
        element.setAttribute('data-plugin', NS);
        element.setAttribute('data-sheet', sheet.id);
        element.textContent = sheet.css;
        document.head.appendChild(element);
        return element;
      });
      return () => { for (const element of elements) element.remove(); };
    }

    /**
     * Keep the native overlay window in the host theme.
     *
     * The window lives outside the page, so it cannot read the shell's tokens.
     * The page watches the theme the shell toggles and tells the Host, which
     * pushes the matching colours to the window.
     *
     * @returns {() => void} the cleanup
     */
    function watchHostTheme() {
      if (typeof document === 'undefined') return () => {};
      let current = hostTheme();
      void callHost('overlay-theme', { theme: current }).catch(() => {});
      if (typeof MutationObserver !== 'function') return () => {};
      const observer = new MutationObserver(() => {
        const theme = hostTheme();
        if (theme === current) return;
        current = theme;
        void callHost('overlay-theme', { theme }).catch(() => {});
      });
      const watch = { attributes: true, attributeFilter: ['data-ds-dark-theme'] };
      for (const element of [document.body, document.documentElement]) {
        if (element) observer.observe(element, watch);
      }
      return () => observer.disconnect();
    }

    /**
     * The quick live button.
     *
     * One click starts the live capture and opens the transcript window; when
     * a session is already running it only brings that window back.
     */
    function QuickLiveButton({ t }) {
      const [busy, setBusy] = React.useState(false);
      const [problem, setProblem] = React.useState('');
      const start = React.useCallback(async () => {
        if (busy) return;
        setBusy(true);
        try {
          const active = await callHost('live-active', {});
          if (active?.session?.id) {
            await callHost('live-overlay-open', { id: active.session.id });
          } else {
            const result = await callHost('live-start', { sourceLanguage: 'auto', targetLanguage: 'en' });
            await callHost('live-overlay-open', { id: result?.session?.id });
          }
          setProblem('');
        } catch (cause) {
          setProblem(cause?.message || String(cause));
        } finally {
          setBusy(false);
        }
      }, [busy]);
      const label = problem || t?.('live.start') || '开始实时';
      return h('span', { className: 'mvm-quick' },
        h('button', {
          type: 'button',
          className: `mvm-quick-button${busy ? ' is-busy' : ''}${problem ? ' is-failed' : ''}`,
          onClick: () => void start(),
          title: label,
          'aria-label': label,
        }, h(Icon, { name: 'mic', size: 15 })));
    }

    function PanelIcon(props) {
      return h('span', { style: { display: 'inline-flex', opacity: props.active ? 1 : 0.65 } },
        h(Icon, { name: 'mic', size: props.size || 18 }));
    }

    async function responseJson(res) {
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* handled below */ }
      if (!res.ok) {
        const detail = data?.error?.message || text.slice(0, 180);
        const error = new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
        if (data?.error?.detail !== undefined) error.detail = data.error.detail;
        throw error;
      }
      if (!data || typeof data !== 'object') throw new Error('Invalid server response');
      return data;
    }

    function sanitizePayload(value) {
      const seen = new WeakSet();
      const walk = (item) => {
        if (typeof item === 'function' || typeof item === 'symbol') return undefined;
        if (item === null || typeof item !== 'object') return item;
        if (typeof Element !== 'undefined' && item instanceof Element) return undefined;
        if (seen.has(item)) return undefined;
        seen.add(item);
        if (Array.isArray(item)) return item.map(walk).filter((entry) => entry !== undefined);
        const output = {};
        for (const [key, entry] of Object.entries(item)) {
          const cleaned = walk(entry);
          if (cleaned !== undefined) output[key] = cleaned;
        }
        return output;
      };
      return walk(value);
    }

    async function callHost(method, payload) {
      const res = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, payload: sanitizePayload(payload ?? {}) }),
      });
      const data = await responseJson(res);
      if (data.ok !== true) {
        const error = new Error(data?.error?.message || 'Request failed');
        if (data?.error?.detail !== undefined) error.detail = data.error.detail;
        throw error;
      }
      return data.result;
    }

    async function uploadAudio(file) {
      const res = await fetch(AUDIO_ROUTE, { method: 'POST', body: file });
      const data = await responseJson(res);
      if (data.ok !== true) throw new Error(data?.error?.message || 'Audio upload failed');
      return data.result;
    }

    function formatTime(value) {
      // A media source that never reports its length leaves the duration at
      // Infinity, which must never reach the clock.
      const number = Number(value);
      const total = Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
      const minutes = Math.floor(total / 60);
      const seconds = String(total % 60).padStart(2, '0');
      return `${minutes}:${seconds}`;
    }

    /** mm:ss (or h:mm:ss) clock that tolerates fractional seconds. */
    function formatClock(value) {
      const total = Math.max(0, Math.floor(Number(value) || 0));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      const pad = (part) => String(part).padStart(2, '0');
      return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
    }

    /** Normalise segment start values to elapsed seconds from the meeting start. */
    function relativeStarts(items) {
      const values = (items || []).map((item) => {
        const value = Number(item?.start);
        if (!Number.isFinite(value) || value < 0) return null;
        return value;
      });
      const known = values.filter((value) => value !== null);
      const base = known.length ? Math.min(...known) : 0;
      const rebase = base >= 86400;
      return values.map((value) => {
        if (value === null) return null;
        // Meeting segment.start values are already seconds. Rebase them
        // directly; a second unit conversion turns real intervals into 1/1000.
        return rebase ? Math.max(0, value - base) : value;
      });
    }

    /** Stable Speaker A/B/C letters in first-encounter order. */
    function speakerLetterMap(items) {
      const map = new Map();
      for (const item of items || []) {
        const key = item?.speaker ? String(item.speaker) : '';
        if (!key || map.has(key)) continue;
        map.set(key, String.fromCharCode(65 + map.size));
      }
      return map;
    }

    function formatBytes(value) {
      const bytes = Number(value) || 0;
      if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function formatDate(value) {
      if (!value) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
    }

    function formatLiveTimestamp(value) {
      if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
        const totalSeconds = Math.max(0, Math.floor(Number(value) / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const pad = (part) => String(part).padStart(2, '0');
        return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
      }
      return value ? formatDate(value) : '';
    }

    function mergeLiveEvents(events, correctedKeys) {
      const groups = new Map();
      for (const event of events) {
        if (!event || event.type === 'status') continue;
        const key = `${event.source || ''}:${event.chunkId ?? `seq-${event.seq ?? groups.size}`}`;
        const previous = groups.get(key) || {};
        const pass = event.pass || previous.pass || '';
        const corrected = pass === 'final' && (previous.pass === 'provisional' || previous.corrected === true || Boolean(correctedKeys && correctedKeys.has(key)));
        let originalText = previous.originalText || '';
        let translatedText = previous.translatedText || '';
        if (event.type === 'transcript') {
          originalText = event.text || originalText;
          translatedText = event.translation || translatedText;
        } else if (event.type === 'translation') {
          originalText = event.transcript || originalText;
          translatedText = event.translation || event.text || translatedText;
        } else {
          originalText = event.text || originalText;
          translatedText = event.translation || translatedText;
        }
        groups.set(key, {
          ...previous,
          ...event,
          pass,
          corrected,
          originalText,
          translatedText,
          type: previous.type === 'error' || event.type === 'error' ? 'error' : 'transcript',
          detail: event.detail || previous.detail,
          timestamp: event.timestamp ?? previous.timestamp,
          seq: previous.seq ?? event.seq,
        });
      }
      return [...groups.values()].sort((left, right) => (Number(left.seq) || 0) - (Number(right.seq) || 0));
    }

    /** Normalise a multi-line hotword list into the comma separated form the Host expects. */
    function parseHotwords(value) {
      const seen = new Set();
      const words = String(value || '')
        .split(/[,\n，、]/)
        .map((word) => word.trim())
        .filter((word) => word.length > 0);
      for (const word of words) seen.add(word);
      return [...seen].join(',');
    }

    function formatLiveDetail(value) {
      if (value === null || value === undefined || value === '') return '';
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value, null, 2); } catch { return String(value); }
    }

    function formatLiveMetric(value) {
      if (value === null || value === undefined || value === '') return '—';
      if (typeof value === 'object') return formatLiveDetail(value) || '—';
      return String(value);
    }

    function liveErrorMessage(cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const detail = formatLiveDetail(cause?.detail);
      return detail && !message.includes(detail) ? `${message}\n${detail}` : message;
    }

    function isLiveTerminal(status) {
      return ['stopped', 'failed', 'error', 'ended', 'cancelled', 'canceled'].includes(String(status || '').toLowerCase());
    }

    /** How many bars the live ribbon shows. */
    const RIBBON_BARS = 28;

    /**
     * The live ribbon — the plugin's signature device.
     *
     * A band of amplitude bars driven by the loudness the capture measures on
     * the audio frames, under an accent rule that breathes. Only the
     * transform of a bar changes, so the band never reflows the page.
     */
    function LiveRibbon({ t, live }) {
      const barsRef = React.useRef(null);
      const levelsRef = React.useRef([]);
      const paint = React.useCallback(() => {
        const bars = barsRef.current;
        if (!bars) return;
        const levels = levelsRef.current;
        for (let index = 0; index < bars.children.length; index += 1) {
          const value = Math.min(1, Math.max(0, Number(levels[index]) || 0));
          bars.children[index].style.transform = 'scaleY(' + (0.08 + value * 0.92).toFixed(3) + ')';
        }
      }, []);
      React.useEffect(() => {
        let disposed = false;
        let timer = null;
        const tick = async () => {
          try {
            const result = await callHost('live-level', {});
            if (disposed) return;
            const level = result?.recording ? Number(result.level) || 0 : 0;
            levelsRef.current = [level, ...levelsRef.current].slice(0, RIBBON_BARS);
            paint();
          } catch {
            /* A Host without the route leaves the ribbon at rest. */
          } finally {
            if (!disposed) timer = setTimeout(tick, 120);
          }
        };
        if (live) {
          void tick();
        } else {
          levelsRef.current = [];
          paint();
        }
        return () => {
          disposed = true;
          if (timer !== null) clearTimeout(timer);
        };
      }, [live, paint]);
      return h('div', {
        className: `mvm-ribbon${live ? ' is-live' : ''}`,
        role: 'img', 'aria-label': t('live.level'),
      },
        h('div', { className: 'mvm-ribbon-track' },
          h('div', { className: 'mvm-ribbon-bars', ref: barsRef, 'aria-hidden': 'true' },
            Array.from({ length: RIBBON_BARS }, (unused, index) => h('span', { className: 'mvm-ribbon-bar', key: index }))),
          h('span', { className: 'mvm-ribbon-rule', 'aria-hidden': 'true' })),
        h('span', { className: 'mvm-ribbon-label', 'aria-hidden': 'true' }, t('live.level')));
    }

    function Button({ icon, children, primary = false, danger = false, className = '', ...props }) {
      const classes = ['mvm-button', primary ? 'mvm-button-primary' : '', danger ? 'mvm-button-danger' : '', className].filter(Boolean).join(' ');
      return h('button', { type: 'button', className: classes, ...props },
        icon ? h(Icon, { name: icon, size: 15 }) : null, children);
    }

    function EmptyState({ title, children }) {
      return h('div', { className: 'mvm-empty' },
        h('div', { className: 'mvm-empty-title' }, title),
        h('div', { className: 'mvm-empty-text' }, children));
    }

    function MinutesPage({ t, ...props }) {
      const [health, setHealth] = React.useState(null);
      const [healthBusy, setHealthBusy] = React.useState(false);
      const [settings, setSettings] = React.useState(null);
      const [settingsOpen, setSettingsOpen] = React.useState(false);
      const [settingsTab, setSettingsTab] = React.useState('asr');
      const [meetings, setMeetings] = React.useState([]);
      const [libraryBusy, setLibraryBusy] = React.useState(false);
      const [meetingId, setMeetingId] = React.useState('');
      const [createdAt, setCreatedAt] = React.useState('');
      const [title, setTitle] = React.useState('');
      const [selectedFile, setSelectedFile] = React.useState(null);
      const [audioId, setAudioId] = React.useState('');
      const [transcript, setTranscript] = React.useState('');
      const [transcriptSimplified, setTranscriptSimplified] = React.useState('');
      const [segments, setSegments] = React.useState([]);
      const [duration, setDuration] = React.useState(0);
      const [minutes, setMinutes] = React.useState(null);
      const [question, setQuestion] = React.useState('');
      const [answer, setAnswer] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [error, setError] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const fileRef = React.useRef(null);
      const [view, setView] = React.useState('minutes');
      const [liveSourceLanguage, setLiveSourceLanguage] = React.useState('auto');
      const [liveTargetLanguage, setLiveTargetLanguage] = React.useState('en');
      const [liveIncognito, setLiveIncognito] = React.useState(false);
      const [liveMarks, setLiveMarks] = React.useState([]);
      const [templates, setTemplates] = React.useState([]);
      const [selectedTemplate, setSelectedTemplate] = React.useState('intelligent-slicing');
      const [librarySearch, setLibrarySearch] = React.useState('');
      const [libraryFilter, setLibraryFilter] = React.useState('recent');
      const [libraryView, setLibraryView] = React.useState('grid');
      const [assistantOpen, setAssistantOpen] = React.useState(false);
      const [librarySelection, setLibrarySelection] = React.useState([]);
      const [libraryOverflowOpen, setLibraryOverflowOpen] = React.useState(false);
      const [liveTrack, setLiveTrack] = React.useState('all');
      const [liveSession, setLiveSession] = React.useState(null);
      const [liveEvents, setLiveEvents] = React.useState([]);
      const [liveBusy, setLiveBusy] = React.useState('');
      const [liveError, setLiveError] = React.useState('');
      const liveAfterRef = React.useRef(0);
      const liveEventsRef = React.useRef(null);
      const provisionalChunksRef = React.useRef(new Set());
      const [finalizeBusy, setFinalizeBusy] = React.useState(false);
      const [finalizeStatus, setFinalizeStatus] = React.useState(null);
      const [overlayOpen, setOverlayOpen] = React.useState(false);
      const [liveSummary, setLiveSummary] = React.useState(null);
      const [liveSummaryLanguage, setLiveSummaryLanguage] = React.useState('zh');
      const [liveSummaryBusy, setLiveSummaryBusy] = React.useState(false);
      const [meetingRecording, setMeetingRecording] = React.useState(false);
      const [voicebookOpen, setVoicebookOpen] = React.useState(false);
      const voicebookTriggerRef = React.useRef(null);
      const [voiceSearch, setVoiceSearch] = React.useState('');
      const [voiceFilter, setVoiceFilter] = React.useState('all');
      const [speakerListOpen, setSpeakerListOpen] = React.useState(false);
      const speakerControlRef = React.useRef(null);
      const [unnamedOpen, setUnnamedOpen] = React.useState(false);
      const [showOriginalText, setShowOriginalText] = React.useState(false);
      const voiceSampleRef = React.useRef(null);
      const speakerSampleRef = React.useRef(null);
      const liveMountedRef = React.useRef(true);
      const liveIsActive = Boolean(liveSession?.id) && !isLiveTerminal(liveSession?.status);
      const [liveRightTab, setLiveRightTab] = React.useState('summary');
      const [livePlaying, setLivePlaying] = React.useState(false);
      const liveAudioRef = React.useRef(null);
      const speakerPollRef = React.useRef({ timer: null, id: '' });
      const [showImport, setShowImport] = React.useState(false);
      const [favorite, setFavorite] = React.useState(false);
      const [detailTab, setDetailTab] = React.useState('transcribe');
      const [selectedChapter, setSelectedChapter] = React.useState(0);
      const [chapterDetails, setChapterDetails] = React.useState(true);
      const [translationOpen, setTranslationOpen] = React.useState(false);
      const [translationLanguage, setTranslationLanguage] = React.useState('original');
      const [bilingual, setBilingual] = React.useState(true);
      const [translationMap, setTranslationMap] = React.useState({});
      const [translationBusy, setTranslationBusy] = React.useState(false);
      const [translationProgress, setTranslationProgress] = React.useState({ done: 0, total: 0 });
      const [historyMessages, setHistoryMessages] = React.useState([]);
      const [historyBusy, setHistoryBusy] = React.useState(false);
      const [historyQuestion, setHistoryQuestion] = React.useState('');
      const [historyScope, setHistoryScope] = React.useState('all');
      const [historySources, setHistorySources] = React.useState([]);
      const [recentExpanded, setRecentExpanded] = React.useState(false);
      const [speakerLabels, setSpeakerLabels] = React.useState({});
      const [voiceProfiles, setVoiceProfiles] = React.useState([]);
      const [labelingSpeaker, setLabelingSpeaker] = React.useState('');
      const [labelingUtteranceIndex, setLabelingUtteranceIndex] = React.useState(null);
      const [labelDraft, setLabelDraft] = React.useState('');
      const [renamingProfile, setRenamingProfile] = React.useState('');
      const [searchOpen, setSearchOpen] = React.useState(false);
      const [searchQuery, setSearchQuery] = React.useState('');
      const [editing, setEditing] = React.useState(false);
      const [editTranscript, setEditTranscript] = React.useState('');
      const [shareOpen, setShareOpen] = React.useState(false);
      const [shareTab, setShareTab] = React.useState('share');
      const [exportFormat, setExportFormat] = React.useState('Markdown');
      const [detailPlaying, setDetailPlaying] = React.useState(false);
      const [detailTime, setDetailTime] = React.useState(0);
      const [detailDuration, setDetailDuration] = React.useState(0);
      const [playbackRate, setPlaybackRate] = React.useState(1);
      const detailAudioRef = React.useRef(null);
      const [asrStatus, setAsrStatus] = React.useState(null);
      const [availableModels, setAvailableModels] = React.useState([]);
      const [compareResults, setCompareResults] = React.useState(null);
      const [compareBusy, setCompareBusy] = React.useState(false);
      const [asrBusy, setAsrBusy] = React.useState('');
      const [asrModelChoice, setAsrModelChoice] = React.useState('');
      const [asrModelOpen, setAsrModelOpen] = React.useState(false);
      const [voiceSampleError, setVoiceSampleError] = React.useState({ id: '', message: '' });
      const [audioFiles, setAudioFiles] = React.useState([]);
      const [selectedAudioId, setSelectedAudioId] = React.useState('');
      const [audioBusy, setAudioBusy] = React.useState('');

      const refreshHealth = React.useCallback(async () => {
        setHealthBusy(true);
        try {
          const result = await callHost('health');
          setHealth(result);
          const overlay = OVERLAY_APPEARANCE[hostTheme()] || OVERLAY_APPEARANCE.light;
          if (result.settings) setSettings({
            translationBaseUrl: DEFAULT_TRANSLATION_BASE_URL,
            translationModel: DEFAULT_TRANSLATION_MODEL,
            translationFallbackEnabled: true,
            translationFallbackProvider: DEFAULT_TRANSLATION_FALLBACK_PROVIDER,
            translationFallbackModel: DEFAULT_TRANSLATION_FALLBACK_MODEL,
            translationFallbackBaseUrl: DEFAULT_TRANSLATION_FALLBACK_BASE_URL,
            liveChunkSeconds: 3,
            overlayBackground: overlay.background,
            overlayText: overlay.text,
            overlayOpacity: 1,
            overlayCompact: true,
            ...result.settings,
          });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setHealthBusy(false);
        }
      }, []);

      const refreshMeetings = React.useCallback(async () => {
        setLibraryBusy(true);
        try {
          const result = await callHost('list');
          setMeetings(result.meetings || []);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setLibraryBusy(false);
        }
      }, []);

      const refreshAsrStatus = React.useCallback(async () => {
        try {
          setAsrStatus(await callHost('asr-status'));
        } catch (cause) {
          setAsrStatus({ online: false, health: { detail: cause instanceof Error ? cause.message : String(cause) } });
        }
      }, []);

      React.useEffect(() => {
        void refreshHealth();
        void refreshMeetings();
        void refreshAsrStatus();
      }, [refreshHealth, refreshMeetings, refreshAsrStatus]);

      React.useEffect(() => {
        if (!assistantOpen) return undefined;
        if (typeof document === 'undefined') return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setAssistantOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [assistantOpen]);

      React.useEffect(() => {
        if (!settingsOpen) return undefined;
        if (typeof document === 'undefined') return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setSettingsOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [settingsOpen]);

      // Opening the panel must show what the host holds right now, not the copy
      // that was cached when the page mounted. The health route carries the
      // settings, so no extra request is needed.
      React.useEffect(() => {
        if (!settingsOpen) return undefined;
        void refreshHealth();
        return undefined;
      }, [settingsOpen, refreshHealth]);

      const libraryHasActiveSession = meetings.some((meeting) => meeting.inProgress)
        || (Boolean(liveSession) && ['recording', 'starting', 'active'].includes(String(liveSession.status || '').toLowerCase()));

      React.useEffect(() => {
        if (!libraryHasActiveSession) return undefined;
        let timer = null;
        const tick = () => {
          void refreshMeetings();
          timer = setTimeout(tick, 5000);
        };
        timer = setTimeout(tick, 5000);
        return () => { if (timer !== null) clearTimeout(timer); };
      }, [libraryHasActiveSession, refreshMeetings]);

      React.useEffect(() => {
        let cancelled = false;
        const loadTemplates = async () => {
          try {
            const result = await callHost('templates');
            if (!cancelled && Array.isArray(result?.templates) && result.templates.length) setTemplates(result.templates);
          } catch {
            /* The built-in template list is used when the Host route is unavailable. */
          }
        };
        void loadTemplates();
        return () => { cancelled = true; };
      }, []);

      React.useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => setNotice(''), 3200);
        return () => clearTimeout(timer);
      }, [notice]);

      React.useEffect(() => {
        liveMountedRef.current = true;
        return () => { liveMountedRef.current = false; };
      }, []);

      React.useEffect(() => {
        if (view !== 'live' || !liveSession?.id || isLiveTerminal(liveSession.status)) return undefined;
        const id = liveSession.id;
        let disposed = false;
        let terminal = false;
        let timer = null;
        const poll = async () => {
          if (disposed) return;
          try {
            const result = await callHost('live-status', { id, after: liveAfterRef.current });
            if (disposed) return;
            if (result.session) {
              terminal = isLiveTerminal(result.session.status);
              setLiveSession(result.session);
            }
            const incoming = Array.isArray(result.events) ? result.events : [];
            if (incoming.length) mergeIncomingEvents(incoming);
            setLiveError('');
          } catch (cause) {
            if (!disposed) setLiveError(liveErrorMessage(cause));
          } finally {
            if (!disposed && !terminal) timer = setTimeout(poll, 1500);
          }
        };
        void poll();
        return () => {
          disposed = true;
          if (timer !== null) clearTimeout(timer);
        };
      }, [view, liveSession?.id, liveSession?.status]);

      const rememberPasses = (incoming) => {
        for (const event of (Array.isArray(incoming) ? incoming : [])) {
          if (!event || event.pass !== 'provisional') continue;
          provisionalChunksRef.current.add(`${event.source || ''}:${event.chunkId ?? `seq-${event.seq}`}`);
        }
      };

      const mergeIncomingEvents = (incoming) => {
        const list = Array.isArray(incoming) ? incoming : [];
        rememberPasses(list);
        if (!list.length) return;
        liveAfterRef.current = Math.max(liveAfterRef.current, ...list.map((event) => Number(event.seq) || 0));
        setLiveEvents((current) => {
          const merged = new Map(current.map((event) => [event.seq, event]));
          for (const event of list) merged.set(event.seq, { ...merged.get(event.seq), ...event });
          return [...merged.values()].sort((left, right) => (Number(left.seq) || 0) - (Number(right.seq) || 0));
        });
      };

      /** Re-attach to a recording that is still running in the Host (page switch, reload, plugin switch). */
      const syncLiveActive = React.useCallback(async () => {
        try {
          const result = await callHost('live-active');
          if (!result?.session) return;
          setLiveSession(result.session);
          const events = Array.isArray(result.events) ? result.events : [];
          if (events.length) {
            rememberPasses(events);
            liveAfterRef.current = Math.max(0, ...events.map((event) => Number(event.seq) || 0));
            setLiveEvents([...events].sort((left, right) => (Number(left.seq) || 0) - (Number(right.seq) || 0)));
          }
        } catch {
          /* Host without live-active support */
        }
      }, []);

      React.useEffect(() => {
        void syncLiveActive();
      }, [syncLiveActive]);

      React.useEffect(() => {
        if (view !== 'live' || liveSession) return undefined;
        void syncLiveActive();
        return undefined;
      }, [view, liveSession, syncLiveActive]);

      React.useEffect(() => {
        const timer = setInterval(() => {
          if (!liveIsActive) void syncLiveActive();
        }, 15000);
        return () => clearInterval(timer);
      }, [liveIsActive, syncLiveActive]);

      React.useEffect(() => {
        if (!liveSession?.id) return undefined;
        let disposed = false;
        const load = async () => {
          try {
            const result = await callHost('live-overlay-status');
            if (!disposed) setOverlayOpen(Boolean(result?.open));
          } catch {
            /* ignore */
          }
        };
        void load();
        const timer = setInterval(load, 8000);
        return () => { disposed = true; clearInterval(timer); };
      }, [liveSession?.id]);

      React.useEffect(() => {
        if (!liveIsActive || !liveSession?.id) return undefined;
        let disposed = false;
        let timer = null;
        const load = async () => {
          try {
            const result = await callHost('live-summary', { id: liveSession.id, language: liveSummaryLanguage });
            if (!disposed && result?.summary) setLiveSummary(result.summary);
          } catch {
            /* minutes are not ready yet */
          } finally {
            if (!disposed) timer = setTimeout(load, 45000);
          }
        };
        void load();
        return () => { disposed = true; if (timer !== null) clearTimeout(timer); };
      }, [liveIsActive, liveSession?.id, liveSummaryLanguage]);

      /** Switch the language of the summary and generate it again. */
      const onSummaryLanguage = async (language) => {
        setLiveSummaryLanguage(language);
        setLiveSummary(null);
        setLiveSummaryBusy(true);
        setLiveError('');
        try {
          const result = await callHost('live-summary', { id: liveSession?.id, language, force: true });
          if (result?.summary) setLiveSummary(result.summary);
        } catch (cause) {
          setLiveError(liveErrorMessage(cause));
        } finally {
          setLiveSummaryBusy(false);
        }
      };

      /** The summary as a flat list of readable blocks. */
      const liveSummaryBlocks = (mins) => {
        const blocks = [];
        if (!mins) return blocks;
        if (mins.summary) blocks.push({ title: t('detail.summary'), text: mins.summary });
        if (mins.background) blocks.push({ title: t('detail.templateBackground'), text: mins.background });
        for (const item of mins.topics || []) blocks.push({ title: item.title || '', text: item.summary || '' });
        for (const item of mins.highlights || []) blocks.push({ title: item.title || '', text: item.detail || '' });
        for (const item of mins.conclusions || []) blocks.push({ title: '', text: typeof item === 'string' ? item : item.title || item.text || '' });
        for (const item of mins.actions || []) blocks.push({ title: '', text: item.text || '' });
        for (const item of mins.openItems || []) blocks.push({ title: '', text: item.text || '' });
        return blocks.filter((block) => String(block.text || '').trim());
      };

      const stopLivePlayback = () => {
        const element = liveAudioRef.current;
        if (element) {
          element.pause();
          // load() releases the pending request, but the src attribute stays:
          // React owns it, and removing it left the element with no media.
          element.load();
          try { element.currentTime = 0; } catch { /* the media is not seekable yet */ }
        }
        setLivePlaying(false);
      };

      const onLivePlayPause = async () => {
        const element = liveAudioRef.current;
        if (!element || !liveSession?.id) return;
        try {
          if (!element.paused) {
            element.pause();
            setLivePlaying(false);
          } else {
            await element.play();
            setLivePlaying(true);
          }
        } catch (cause) {
          setLivePlaying(false);
          setLiveError(liveErrorMessage(cause));
        }
      };

      React.useEffect(() => {
        stopLivePlayback();
        return () => {
          const element = liveAudioRef.current;
          if (element) {
            element.pause();
            element.load();
            try { element.currentTime = 0; } catch { /* the media is not seekable yet */ }
          }
        };
      }, [view, liveTrack, liveSession?.id]);

      const onLiveStart = async () => {
        if (liveBusy || liveIsActive) return;
        if (liveSourceLanguage === liveTargetLanguage) {
          setLiveError(t('live.error.sameLanguage'));
          return;
        }
        stopLivePlayback();
        setLiveBusy('start');
        setLiveError('');
        setLiveSession(null);
        setLiveEvents([]);
        liveAfterRef.current = 0;
        try {
          const payload = {
            sourceLanguage: liveHostSourceLanguage(),
            targetLanguage: liveTargetLanguage,
          };
          if (settings?.asrBackend) payload.backend = settings.asrBackend;
          const hotwords = parseHotwords(settings?.hotwords);
          if (hotwords) payload.hotwords = hotwords;
          if (liveIncognito) payload.incognito = true;
          const result = await callHost('live-start', payload);
          if (liveMountedRef.current) setLiveSession(result.session || null);
        } catch (cause) {
          if (liveMountedRef.current) setLiveError(liveErrorMessage(cause));
        } finally {
          if (liveMountedRef.current) setLiveBusy('');
        }
      };

      /**
       * One click: go live and start the interpretation right away, so the
       * live captions, the translation and the minutes need no extra step.
       */
      const onStartInterpretation = async () => {
        if (liveBusy || liveIsActive) return;
        resetDraft();
        setView('live');
        await onLiveStart();
      };

      const onLivePause = async () => {
        const id = liveSession?.id;
        if (!id || liveBusy) return;
        setLiveBusy('pause');
        setLiveError('');
        try {
          const result = await callHost(liveSession?.transcriptionPaused ? 'live-resume' : 'live-pause', { id });
          if (liveMountedRef.current) setLiveSession(result.session || null);
        } catch (cause) {
          if (liveMountedRef.current) setLiveError(liveErrorMessage(cause));
        } finally {
          if (liveMountedRef.current) setLiveBusy('');
        }
      };

      const onLiveOverlayOpen = async () => {
        try {
          await callHost('live-overlay-open', { id: liveSession?.id });
          if (liveMountedRef.current) setOverlayOpen(true);
        } catch (cause) {
          if (liveMountedRef.current) setLiveError(liveErrorMessage(cause));
        }
      };

      /** Generate and persist the minutes for a finished meeting. */
      const autoSummarize = async (meeting) => {
        const text = String(meeting?.transcript || '').trim();
        if (!text) return;
        setBusy('summarize');
        setError('');
        try {
          const result = await callHost('summarize', {
            transcript: text,
            context: {
              title: meeting.title || t('meeting.untitled'),
              date: meeting.createdAt || new Date().toISOString(),
              template: selectedTemplate,
            },
          });
          if (!result?.minutes) return;
          setMinutes(result.minutes);
          await callHost('save', {
            meeting: {
              id: meeting.id,
              title: meeting.title || t('meeting.untitled'),
              createdAt: meeting.createdAt,
              transcript: text,
              minutes: result.minutes,
              template: selectedTemplate,
            },
          });
          setNotice(t('notice.autoSaved'));
          await refreshMeetings();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy('');
        }
      };

      const onLiveStop = async () => {
        const id = liveSession?.id;
        if (!id || liveBusy) return;
        stopLivePlayback();
        setLiveBusy('stop');
        setLiveError('');
        try {
          const result = await callHost('live-stop', { id });
          if (liveMountedRef.current) {
            setLiveSession(result.session || null);
            if (result.meeting?.id) {
              await refreshMeetings();
              await onOpen(result.meeting.id);
              setView('minutes');
              if (result.meeting.transcript && !result.meeting.minutes) {
                void autoSummarize(result.meeting);
              }
            }
          }
        } catch (cause) {
          if (liveMountedRef.current) setLiveError(liveErrorMessage(cause));
        } finally {
          if (liveMountedRef.current) setLiveBusy('');
        }
      };

      const liveHostSourceLanguage = () => (
        liveSourceLanguage === 'zh' || liveSourceLanguage === 'en' ? liveSourceLanguage : 'auto'
      );

      const onBackToLive = async (meeting) => {
        setView('live');
        setShowImport(false);
        const id = meeting?.id;
        if (!id) return;
        try {
          const status = await callHost('live-status', { id, after: 0 });
          if (status.session) setLiveSession(status.session);
          setLiveEvents(Array.isArray(status.events) ? status.events : []);
          liveAfterRef.current = Array.isArray(status.events)
            ? Math.max(0, ...status.events.map((event) => Number(event.seq) || 0))
            : 0;
        } catch (cause) {
          setLiveError(liveErrorMessage(cause));
        }
      };

      const onToggleIncognito = () => setLiveIncognito((value) => !value);

      const onLiveMark = async (kind) => {
        const id = liveSession?.id;
        if (!id) return;
        setLiveBusy('mark');
        setLiveError('');
        try {
          await callHost('live-mark', { id, kind, text: '', timestamp: Date.now() });
          setLiveMarks((current) => [...current, { kind, timestamp: Date.now() }]);
        } catch (cause) {
          setLiveError(liveErrorMessage(cause));
        } finally {
          setLiveBusy('');
        }
      };

      const onLiveRetry = async () => {
        const id = liveSession?.id;
        if (!id) return;
        setLiveBusy('retry');
        setLiveError('');
        try {
          const result = await callHost('live-status', { id, after: liveAfterRef.current });
          const incoming = Array.isArray(result.events) ? result.events : [];
          if (incoming.length) mergeIncomingEvents(incoming);
          if (result.session) {
            setLiveSession(result.session);
            // The overlay can pick the language, so the dropdown follows it.
            const language = String(result.session.targetLanguage || '');
            if (language && language !== liveTargetLanguage) setLiveTargetLanguage(language);
          }
        } catch (cause) {
          setLiveError(liveErrorMessage(cause));
        } finally {
          setLiveBusy('');
        }
      };

      const refreshFinalizeStatus = React.useCallback(async (id) => {
        const sessionId = id || liveSession?.id;
        if (!sessionId) return;
        try {
          const status = await callHost('live-summary-status', { id: sessionId });
          setFinalizeStatus(status || null);
        } catch {
          /* summary status is optional */
        }
      }, [liveSession?.id]);

      const onLiveFinalize = async () => {
        const id = liveSession?.id;
        if (!id || finalizeBusy) return;
        setFinalizeBusy(true);
        setLiveError('');
        try {
          await callHost('live-finalize', { id, force: true });
          await refreshFinalizeStatus(id);
          await onLiveRetry();
        } catch (cause) {
          setLiveError(t('live.finalizeFailed') + '：' + liveErrorMessage(cause));
        } finally {
          setFinalizeBusy(false);
        }
      };

      React.useEffect(() => {
        if (!liveIsActive || !liveSession?.id) return undefined;
        void refreshFinalizeStatus(liveSession.id);
        const timer = setInterval(() => { void refreshFinalizeStatus(liveSession.id); }, 10000);
        return () => clearInterval(timer);
      }, [liveIsActive, liveSession?.id, refreshFinalizeStatus]);

      React.useEffect(() => {
        if (view !== 'live') return;
        const element = liveEventsRef.current;
        if (!element) return;
        const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
        if (distance < 80) element.scrollTop = element.scrollHeight;
      }, [liveEvents, view]);

      const resetDraft = () => {
        setShowImport(false);
        setMeetingId('');
        setCreatedAt('');
        setTitle('');
        setSelectedFile(null);
        setAudioId('');
        setTranscript('');
        setTranscriptSimplified('');
        setSegments([]);
        setDuration(0);
        setMinutes(null);
        setFavorite(false);
        setQuestion('');
        setAnswer('');
        setError('');
        setNotice('');
        if (fileRef.current) fileRef.current.value = '';
      };

      const onFile = (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        resetDraft();
        setSelectedFile(file);
        setTitle(file.name.replace(/\.[^.]+$/, ''));
        setShowImport(true);
        if (fileRef.current) fileRef.current.value = '';
      };

      const persistMeeting = async (patch = {}) => {
        const payload = {
          id: meetingId || undefined,
          createdAt: createdAt || undefined,
          title: title || t('meeting.untitled'),
          audioId: audioId || undefined,
          transcript,
          segments,
          duration,
          minutes: minutes || undefined,
          template: selectedTemplate,
          ...patch,
        };
        const result = await callHost('save', { meeting: payload });
        if (result?.meeting) {
          setMeetingId(result.meeting.id);
          setCreatedAt(result.meeting.createdAt || '');
        }
        return result;
      };

      const onTranscribe = async () => {
        if (!selectedFile) {
          setError(t('error.chooseFile'));
          return;
        }
        setBusy('transcribe');
        setError('');
        setNotice('');
        try {
          const stored = await uploadAudio(selectedFile);
          setAudioId(stored.id);
          const result = await callHost('transcribe', {
            audio: { audioId: stored.id },
            options: { filename: selectedFile.name },
          });
          setTranscript(result.transcript || '');
          setTranscriptSimplified(result.transcriptSimplified || '');
          setSegments(result.segments || []);
          setDuration(result.duration || 0);
          setMinutes(null);
          setAnswer('');
          setSpeakerLabels(result.speakerLabels || {});
          await persistMeeting({
            title: title || selectedFile.name.replace(/\.[^.]+$/, ''),
            transcript: result.transcript || '',
            segments: result.segments || [],
            duration: result.duration || 0,
            minutes: undefined,
            voiceprints: result.voiceprints || undefined,
            speakerLabels: result.speakerLabels || {},
            speakerProfiles: result.speakerProfiles || {},
          });
          setNotice(t('notice.autoSaved'));
          await refreshMeetings();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy('');
        }
      };

      const onSummarize = async () => {
        if (!transcript) {
          setError(t('error.noTranscript'));
          return;
        }
        setBusy('summarize');
        setError('');
        try {
          const result = await callHost('summarize', {
            transcript,
            context: {
              title: title || t('meeting.untitled'),
              date: createdAt || new Date().toISOString(),
              template: selectedTemplate,
            },
          });
          setMinutes(result.minutes);
          await persistMeeting({ minutes: result.minutes });
          setNotice(t('notice.autoSaved'));
          await refreshMeetings();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy('');
        }
      };

      const onSave = async () => {
        if (!transcript) {
          setError(t('error.noTranscript'));
          return;
        }
        if (editing) {
          setTranscript(editTranscript);
          setSegments([]);
        }
        setBusy('save');
        setError('');
        try {
          const result = await callHost('save', {
            meeting: {
              id: meetingId || undefined,
              createdAt: createdAt || undefined,
              title: title.trim() || t('meeting.untitled'),
              audioId: audioId || undefined,
              transcript: editing ? editTranscript : transcript,
              segments: editing ? [] : segments,
              duration,
              minutes,
            },
          });
          setMeetingId(result.meeting.id);
          setCreatedAt(result.meeting.createdAt || '');
          setShowImport(true);
          setEditing(false);
          setNotice(t('notice.saved'));
          await refreshMeetings();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy('');
        }
      };

      // The capture track is a source, not a person. While a long recording is
      // still being clustered, keep asking the host for the labelled segments.
      const needsSpeakerLabels = (items) => Array.isArray(items) && items.length > 0
        && items.every((segment) => ['', 'mic', 'system', 'mix'].includes(String(segment.speaker || '')));

      const stopSpeakerPoll = () => {
        const poll = speakerPollRef.current;
        if (poll.timer) clearTimeout(poll.timer);
        poll.timer = null;
        poll.id = '';
      };

      const pollSpeakerLabels = (id) => {
        stopSpeakerPoll();
        const poll = speakerPollRef.current;
        poll.id = id;
        const attempt = async (left) => {
          if (poll.id !== id) return;
          try {
            const result = await callHost('get', { id });
            const meeting = result.meeting || {};
            if (!Array.isArray(meeting.segments) || !meeting.segments.length) {
              stopSpeakerPoll();
              return;
            }
            setSegments(meeting.segments);
            if (!needsSpeakerLabels(meeting.segments)) {
              stopSpeakerPoll();
              return;
            }
          } catch {
            /* the record may not be readable yet */
          }
          if (left <= 0) {
            stopSpeakerPoll();
            return;
          }
          poll.timer = setTimeout(() => { void attempt(left - 1); }, 3000);
        };
        poll.timer = setTimeout(() => { void attempt(20); }, 1500);
      };

      React.useEffect(() => () => stopSpeakerPoll(), []);

      /** End the recording of the meeting on screen, save it and write the minutes. */
      const onEndMeeting = async () => {
        const id = meetingId;
        if (!id || liveBusy !== '') return;
        setLiveBusy('stop');
        setError('');
        try {
          await callHost('live-stop', { id });
          setMeetingRecording(false);
          setNotice(t('notice.meetingEnded'));
          await refreshMeetings();
          await onOpen(id);
        } catch (cause) {
          setError(liveErrorMessage(cause));
        } finally {
          setLiveBusy('');
        }
      };

      const onOpen = async (id) => {
        setShowImport(true);
        setSpeakerListOpen(false);
        setLabelingSpeaker(''); setLabelingUtteranceIndex(null);
        setLabelDraft('');
        setBusy(`open:${id}`);
        setError('');
        try {
          const result = await callHost('get', { id });
          const meeting = result.meeting;
          setMeetingId(meeting.id || id);
          setCreatedAt(meeting.createdAt || '');
          setTitle(meeting.title || t('meeting.untitled'));
          setSelectedFile(null);
          setAudioId(meeting.audioId || '');
          setTranscript(meeting.transcript || '');
          setTranscriptSimplified(meeting.transcriptSimplified || '');
          setSegments(meeting.segments || []);
          setMeetingRecording(Boolean(meeting.inProgress));
          setDuration(meeting.duration || 0);
          setMinutes(meeting.minutes || null);
          setFavorite(Boolean(meeting.favorite));
          if (needsSpeakerLabels(meeting.segments)) pollSpeakerLabels(meeting.id || id);
          else stopSpeakerPoll();
          if (meeting.template) setSelectedTemplate(meeting.template);
          setSpeakerLabels(meeting.speakerLabels || {});
          await refreshAudioFiles(meeting.id || id);
          setQuestion('');
          setAnswer('');
          setSettingsOpen(false);
          if (globalThis.window?.location && globalThis.window?.history) {
            const url = new URL(globalThis.window.location.href);
            url.searchParams.set('meeting', meeting.id || id);
            globalThis.window.history.replaceState(null, '', url);
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy('');
        }
      };

      const onBackToLibrary = () => {
        setView('minutes');
        setShowImport(false);
        if (globalThis.window?.location && globalThis.window?.history) {
          const url = new URL(globalThis.window.location.href);
          url.searchParams.delete('meeting');
          globalThis.window.history.replaceState(null, '', url);
        }
      };

      /**
       * Open a meeting from a list. A meeting that is still recording belongs
       * to the live view, because the detail page carries none of the live
       * controls; opening it there strands the reader without a way to act.
       */
      const onOpenMeeting = async (meeting) => {
        if (meeting?.inProgress || meeting?.liveStatus === 'recording') {
          await onBackToLive(meeting);
          return;
        }
        await onOpen(meeting.id);
      };

      const onToggleMeetingFavorite = async (id) => {
        const target = meetings.find((meeting) => meeting.id === id);
        if (!target) return;
        const nextFavorite = !target.favorite;
        setMeetings((current) => current.map((meeting) => meeting.id === id ? { ...meeting, favorite: nextFavorite } : meeting));
        try {
          await callHost('save', { meeting: { id, favorite: nextFavorite } });
        } catch (cause) {
          setMeetings((current) => current.map((meeting) => meeting.id === id ? { ...meeting, favorite: target.favorite } : meeting));
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      };

      const onToggleFavorite = async () => {
        const nextFavorite = !favorite;
        setFavorite(nextFavorite);
        if (!meetingId) return;
        try {
          await callHost('save', {
            meeting: {
              id: meetingId, createdAt: createdAt || undefined,
              title: title || t('meeting.untitled'), audioId: audioId || undefined,
              transcript, segments, duration, minutes, favorite: nextFavorite,
            },
          });
          setMeetings((current) => current.map((meeting) => meeting.id === meetingId ? { ...meeting, favorite: nextFavorite } : meeting));
        } catch (cause) {
          setFavorite(!nextFavorite);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      };

      React.useEffect(() => {
        const id = new URLSearchParams(globalThis.window?.location?.search || '').get('meeting');
        if (id) void onOpen(id);
      }, []);

      const onDelete = async (id) => {
        if (!window.confirm(t('error.deleteConfirm'))) return;
        setBusy(`delete:${id}`);
        setError('');
        try {
          const result = await callHost('delete', { id });
          if (meetingId === id) resetDraft();
          setNotice(result.audioDeleted ? t('notice.deletedWithAudio') : t('notice.deleted'));
          await refreshMeetings();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy('');
        }
      };

      const onAsk = async () => {
        const q = question.trim();
        if (!q || !transcript) return;
        setBusy('ask');
        setError('');
        try {
          const result = await callHost('ask', {
            transcript,
            question: q,
            context: { title: title || t('meeting.untitled'), meetingId: meetingId || undefined },
          });
          setAnswer(result.answer || '');
          setQuestion('');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy('');
        }
      };

      const onSettingsSave = async (nextSettings = settings) => {
        if (!nextSettings) return;
        setBusy('settings');
        setError('');
        try {
          const result = await callHost('settings', { settings: nextSettings });
          setSettings(result);
          setNotice(t('notice.settingsSaved'));
          await refreshHealth();
          await refreshAsrStatus();
        } catch (cause) {
          setError(t('error.settingsSaveFailed') + '：' + (cause instanceof Error ? cause.message : String(cause)));
        } finally {
          setBusy('');
        }
      };

      const onAsrAction = async (action, payload = {}) => {
        setAsrBusy(action);
        setError('');
        try {
          const result = await callHost(action, payload);
          setAsrStatus(result.status || result);
          // Only a whisper.cpp file is a whisperCppModel; a downloaded folder is not.
          if (result.path && /\.bin$/.test(String(result.path))) {
            setSettings((current) => ({ ...current, whisperCppModel: result.path }));
          }
          await refreshHealth();
          return result;
        } catch (cause) {
          setError(t('error.asrActionFailed') + '：' + (cause instanceof Error ? cause.message : String(cause)));
          return null;
        } finally {
          setAsrBusy('');
        }
      };

      const onCompareModels = async () => {
        const source = segments.length ? segments.map((segment) => segment.text || '') : (transcript || '').split('\n');
        const sentences = source.map((text) => String(text || '').trim()).filter((text) => text.length > 1).slice(0, 6);
        const current = settings?.translationModel || '';
        const models = [current, ...availableModels.filter((model) => model && model !== current)].filter(Boolean).slice(0, 2);
        if (!sentences.length) {
          setError(t('history.compareNoSentences'));
          return;
        }
        if (!models.length) {
          setError(t('history.compareNoModels'));
          return;
        }
        setCompareBusy(true);
        setError('');
        try {
          const result = await callHost('compare-translation', {
            sentences,
            models,
            options: {
              sourceLanguage: liveSourceLanguage, targetLanguage: liveTargetLanguage,
              promptLanguage: uiLanguage(), glossary: settings?.translationGlossary || '',
            },
          });
          setCompareResults(result);
        } catch (cause) {
          setError(t('error.modelsFailed') + '：' + (cause instanceof Error ? cause.message : String(cause)));
        } finally {
          setCompareBusy(false);
        }
      };

      const onLoadModels = async () => {
        setBusy('models');
        setError('');
        try {
          const result = await callHost('list-models', { options: { baseUrl: settings?.translationBaseUrl || '' } });
          setAvailableModels(result.models || []);
          if (!(result.models || []).length) setNotice(t('settings.noModels'));
        } catch (cause) {
          setError(t('error.modelsFailed') + '：' + (cause instanceof Error ? cause.message : String(cause)));
        } finally {
          setBusy('');
        }
      };

      const onOpenPath = async (path) => {
        try {
          await callHost('open-path', { path });
        } catch (cause) {
          setError(t('error.openPathFailed') + '：' + (cause instanceof Error ? cause.message : String(cause)));
        }
      };

      const onAsrModelSelect = async (id) => {
        const result = await onAsrAction('asr-select-model', { id });
        // The host moved the model outside the form, so the form has to follow:
        // otherwise "Save settings" writes the stale path back over the switch.
        const saved = result?.settings;
        if (saved) {
          setSettings((current) => ({
            ...current,
            asrBackend: saved.asrBackend ?? current.asrBackend,
            whisperCppModel: saved.whisperCppModel ?? current.whisperCppModel,
            senseVoiceDir: saved.senseVoiceDir ?? current.senseVoiceDir,
            funAsrDir: saved.funAsrDir ?? current.funAsrDir,
          }));
        }
      };

      const asrModelEntry = asrStatus?.catalog?.entries?.find((entry) => entry.id === (asrModelChoice || asrStatus?.catalog?.activeId)) || null;

      const onAsrModelChoice = async (id) => {
        setAsrModelChoice(id);
        const entry = asrStatus?.catalog?.entries?.find((item) => item.id === id);
        if (!entry) return;
        if (entry.downloaded) await onAsrModelSelect(entry.id);
        else await onAsrAction('asr-download-model', { id });
      };

      const onAsrAutoStartToggle = async (checked) => {
        await onSettingsSave({ ...settings, asrAutoStart: checked });
      };

      const updateSetting = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
      const isBusy = busy !== '';

      // The dot already carries the state, so the badge only names the service;
      // the full status and detail stay in the tooltip.
      const healthBadge = (key, label) => {
        const item = health?.[key];
        const state = item ? (item.alive ? 'is-online' : 'is-offline') : '';
        const status = item ? t(item.alive ? 'status.online' : 'status.offline') : t('status.unknown');
        return h('span', { className: `mvm-health-item ${state}`, title: `${label} · ${status}${item?.detail ? ` — ${item.detail}` : ''}` },
          h('span', { className: 'mvm-health-dot' }),
          label);
      };

      const settingField = (key, labelKey, options = {}) => h('label', { className: `mvm-field ${options.wide ? 'mvm-field-wide' : ''}` },
        h('span', { className: 'mvm-label' }, t(labelKey)),
        h('input', {
          className: 'mvm-input',
          'aria-label': t(labelKey),
          type: options.type || 'text',
          min: options.min,
          step: options.step,
          value: settings?.[key] ?? '',
          placeholder: options.placeholderKey ? t(options.placeholderKey) : '',
          onChange: (event) => updateSetting(key, options.number ? Number(event.target.value) : event.target.value),
        }));

      const settingArea = (key, labelKey, options = {}) => h('label', { className: `mvm-field ${options.wide ? 'mvm-field-wide' : ''}` },
        h('span', { className: 'mvm-label' }, t(labelKey)),
        h('textarea', {
          className: 'mvm-textarea', rows: options.rows || 3, value: settings?.[key] ?? '',
          'aria-label': t(labelKey),
          placeholder: options.placeholderKey ? t(options.placeholderKey) : '',
          onChange: (event) => updateSetting(key, event.target.value),
        }));

      const settingSelect = (key, labelKey, choices, fallback = 'local') => h('label', { className: 'mvm-field' },
        h('span', { className: 'mvm-label' }, t(labelKey)),
        h('select', {
          className: 'mvm-input', value: settings?.[key] || fallback,
          'aria-label': t(labelKey),
          onChange: (event) => updateSetting(key, event.target.value),
        }, choices.map(([value, label]) => h('option', { value, key: value }, t(label)))));

      const settingToggle = (key, labelKey, options = {}) => {
        const checked = settings?.[key] ?? options.defaultValue ?? false;
        return h('label', { className: 'mvm-field mvm-field-wide mvm-toggle-field' },
          h('input', {
            type: 'checkbox', checked: Boolean(checked), 'aria-label': t(labelKey),
            onChange: (event) => updateSetting(key, Boolean(event.target.checked)),
          }),
          h('span', { className: 'mvm-toggle-copy' },
            h('span', { className: 'mvm-label' }, t(labelKey)),
            options.hintKey ? h('span', { className: 'mvm-hint' }, t(options.hintKey)) : null));
      };

      // The player follows the file the reader picked in the audio list; without a
      // list it falls back to the meeting's own recording.
      const selectedAudioFile = audioFiles.find((file) => file.id === selectedAudioId) || null;
      // The length the timeline uses. The media reports its own length when it
      // can; otherwise the meeting length stands in, and never Infinity.
      const playerDuration = (() => {
        const media = Number(detailDuration);
        if (Number.isFinite(media) && media > 0) return media;
        const meeting = Number(duration);
        return Number.isFinite(meeting) && meeting > 0 ? meeting : 0;
      })();
      const detailAudioSrc = selectedAudioFile
        ? selectedAudioFile.url
        : audioId
          ? `/api/ai-minutes/meeting-audio?id=${encodeURIComponent(audioId)}`
          : meetingId.startsWith('realtime-')
            ? `/api/ai-minutes/live-audio?id=${encodeURIComponent(meetingId)}&track=mic`
            : '';

      // React owns the audio src. Removing the attribute here left the element
      // with no source, so play() failed with "the media was removed from the
      // document" and the timeline never moved.
      const stopDetailAudio = () => {
        const element = detailAudioRef.current;
        if (element) {
          element.pause();
          try { element.currentTime = 0; } catch { /* the media is not seekable yet */ }
        }
        setDetailPlaying(false);
        setDetailTime(0);
        setDetailDuration(0);
      };

      React.useEffect(() => {
        stopDetailAudio();
        return () => {
          const element = detailAudioRef.current;
          if (element) {
            element.pause();
            try { element.currentTime = 0; } catch { /* the media is not seekable yet */ }
          }
        };
      }, [meetingId, audioId, selectedAudioId]);

      /** Load the audio files that belong to the open meeting. */
      const refreshAudioFiles = async (id) => {
        const target = String(id || '');
        if (!target) {
          setAudioFiles([]);
          setSelectedAudioId('');
          return;
        }
        try {
          const result = await callHost('audio-list', { id: target });
          const files = Array.isArray(result?.files) ? result.files : [];
          setAudioFiles(files);
          setSelectedAudioId((current) => (files.some((file) => file.id === current) ? current : files[0]?.id || ''));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      };

      /** Play one of the meeting's audio files. */
      const onSelectAudio = (file) => {
        if (!file?.id) return;
        setSelectedAudioId(file.id);
      };

      /** Delete one audio file; the transcript and the minutes stay. */
      const onDeleteAudio = async (file) => {
        if (!file?.id) return;
        if (!globalThis.window?.confirm?.(t('detail.deleteAudioConfirm'))) return;
        setAudioBusy(file.id);
        setError('');
        try {
          const result = await callHost('audio-delete', { id: meetingId, kind: file.kind, track: file.track });
          const files = Array.isArray(result?.files) ? result.files : [];
          setAudioFiles(files);
          setSelectedAudioId((current) => (files.some((item) => item.id === current) ? current : files[0]?.id || ''));
          if (!files.length) stopDetailAudio();
          setNotice(t('notice.audioDeleted'));
          await refreshMeetings();
        } catch (cause) {
          setError(t('error.audioDeleteFailed') + '：' + (cause instanceof Error ? cause.message : String(cause)));
        } finally {
          setAudioBusy('');
        }
      };

      const onDetailPlayPause = async () => {
        const element = detailAudioRef.current;
        if (!element || !detailAudioSrc) return;
        try {
          if (element.paused) {
            await element.play();
            setDetailPlaying(true);
          } else {
            element.pause();
            setDetailPlaying(false);
          }
        } catch (cause) {
          setDetailPlaying(false);
          // A play that a new load aborted is not a failure the reader has to act on.
          if (cause?.name === 'AbortError') return;
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      };

      const skip = (seconds) => {
        const element = detailAudioRef.current;
        if (!element) return;
        const max = Number.isFinite(element.duration) ? element.duration : detailDuration || duration || 0;
        const next = Math.max(0, Math.min(max || 0, (element.currentTime || 0) + seconds));
        element.currentTime = next;
        setDetailTime(next);
      };

      const onDetailSeek = (event) => {
        const next = Number(event.target.value) || 0;
        if (detailAudioRef.current) detailAudioRef.current.currentTime = next;
        setDetailTime(next);
      };

      const changePlaybackRate = (value) => {
        const next = Number(value) || 1;
        setPlaybackRate(next);
        if (detailAudioRef.current) detailAudioRef.current.playbackRate = next;
      };

      const copyText = async (value) => {
        if (globalThis.navigator?.clipboard?.writeText) {
          await globalThis.navigator.clipboard.writeText(value);
        } else if (globalThis.window?.prompt) {
          globalThis.window.prompt(t('detail.copyLink'), value);
        }
      };

      const copyLink = async () => {
        const origin = globalThis.window?.location?.origin || '';
        await copyText(`${origin}/?meeting=${encodeURIComponent(meetingId)}`);
        setNotice(t('notice.linkCopied'));
      };

      const onTranslateLanguage = async (language) => {
        setTranslationLanguage(language);
        setTranslationOpen(false);
        if (language === 'original' || translationMap[language]) return;
        setTranslationBusy(true);
        setError('');
        const sourceLines = segments.length ? segments.map((segment) => segment.text || '') : transcript.split('\n');
        const translatedLines = Array(sourceLines.length).fill('');
        let nextIndex = 0;
        let completed = 0;
        setTranslationProgress({ done: 0, total: sourceLines.length });
        try {
          const worker = async () => {
            while (nextIndex < sourceLines.length) {
              const index = nextIndex++;
              const sourceText = sourceLines[index];
              if (sourceText.trim()) {
                const result = await callHost('translate', {
                  text: sourceText,
                  options: {
                    sourceLanguage: 'auto', targetLanguage: language,
                    promptLanguage: uiLanguage(), glossary: settings?.translationGlossary || '',
                  },
                });
                translatedLines[index] = result.translation || '';
              }
              completed += 1;
              setTranslationProgress({ done: completed, total: sourceLines.length });
              setTranslationMap((current) => ({
                ...current,
                [language]: {
                  ...(current[language] || {}),
                  lines: [...translatedLines],
                  text: translatedLines.join('\n'),
                },
              }));
            }
          };
          await Promise.all([worker(), worker()]);
          let summary = '';
          if (minutes?.summary) {
            const result = await callHost('translate', {
              text: minutes.summary,
              options: {
                sourceLanguage: 'auto', targetLanguage: language,
                promptLanguage: uiLanguage(), glossary: settings?.translationGlossary || '',
              },
            });
            summary = result.translation || '';
          }
          setTranslationMap((current) => ({
            ...current,
            [language]: {
              ...(current[language] || {}),
              lines: [...translatedLines],
              text: translatedLines.join('\n'),
              summary,
            },
          }));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setTranslationBusy(false);
          setTranslationProgress({ done: 0, total: 0 });
        }
      };

      const uiLanguage = () => (globalThis.navigator?.language || '').startsWith('zh') ? 'zh' : 'en';

      React.useEffect(() => {
        const active = asrStatus?.catalog?.activeId || '';
        if (active) setAsrModelChoice(active);
      }, [asrStatus?.catalog?.activeId]);

      const refreshVoices = React.useCallback(async () => {
        try {
          const result = await callHost('voices');
          setVoiceProfiles(result.profiles || []);
        } catch {
          setVoiceProfiles([]);
        }
      }, []);

      React.useEffect(() => {
        void refreshVoices();
      }, [refreshVoices]);

      React.useEffect(() => {
        if (!voicebookOpen || typeof document === 'undefined') return undefined;
        const onOutside = (event) => {
          if (voicebookTriggerRef.current?.contains?.(event.target)) return;
          setVoicebookOpen(false);
        };
        const onEscape = (event) => {
          if (event.key !== 'Escape') return;
          setVoicebookOpen(false);
        };
        document.addEventListener('mousedown', onOutside);
        document.addEventListener('keydown', onEscape);
        return () => {
          document.removeEventListener('mousedown', onOutside);
          document.removeEventListener('keydown', onEscape);
        };
      }, [voicebookOpen]);

      React.useEffect(() => {
        if (!speakerListOpen || typeof document === 'undefined') return undefined;
        const onOutside = (event) => {
          if (speakerControlRef.current?.contains?.(event.target)) return;
          setSpeakerListOpen(false);
          setLabelingSpeaker(''); setLabelingUtteranceIndex(null);
          setLabelDraft('');
        };
        const onEscape = (event) => {
          if (event.key !== 'Escape') return;
          setSpeakerListOpen(false);
          setLabelingSpeaker(''); setLabelingUtteranceIndex(null);
          setLabelDraft('');
        };
        document.addEventListener('mousedown', onOutside);
        document.addEventListener('keydown', onEscape);
        return () => {
          document.removeEventListener('mousedown', onOutside);
          document.removeEventListener('keydown', onEscape);
        };
      }, [speakerListOpen]);

      const commitSpeakerLabel = async (speaker) => {
        const name = labelDraft.trim();
        if (!speaker) return;
        try {
          const result = await callHost('voice-save', { meetingId: meetingId || undefined, speaker, name });
          setLabelingSpeaker(''); setLabelingUtteranceIndex(null);
          setLabelDraft('');
          if (result?.speakerLabels) setSpeakerLabels(result.speakerLabels);
          setNotice(t('notice.voiceSaved'));
          await refreshVoices();
          await refreshMeetings();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      };

      const commitVoiceRename = async (profileId) => {
        const name = labelDraft.trim();
        setRenamingProfile('');
        setLabelDraft('');
        try {
          const result = await callHost('voice-rename', { profileId, name });
          setVoiceProfiles(result.profiles || []);
          if (meetingId) {
            const current = await callHost('get', { id: meetingId });
            setSpeakerLabels(current.meeting?.speakerLabels || {});
          }
          await refreshMeetings();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      };

      const onHistoryAsk = async (question) => {
        const text = String(question ?? historyQuestion ?? '').trim();
        if (!text || historyBusy) return;
        setHistoryQuestion('');
        setHistoryBusy(true);
        setError('');
        setHistoryMessages((current) => [...current, { role: 'user', text }]);
        try {
          const result = await callHost('ask-history', {
            question: text,
            options: { scope: historyScope, meetingId: meetingId || undefined },
          });
          setHistoryMessages((current) => [...current, { role: 'assistant', text: result.answer || '' }]);
          setHistorySources(result.sources || []);
        } catch (cause) {
          setHistoryMessages((current) => [...current, { role: 'assistant', text: t('history.askFailed'), failed: true }]);
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setHistoryBusy(false);
        }
      };

      const downloadText = (filename, content, type) => {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      };

      const onExport = () => {
        const safeTitle = (title || 'meeting').replace(/[\\/:*?"<>|]/g, '-');
        if (exportFormat === 'WAV') {
          if (!detailAudioSrc) {
            setError(t('detail.noAudio'));
            return;
          }
          const anchor = document.createElement('a');
          anchor.href = detailAudioSrc;
          anchor.download = `${safeTitle}.wav`;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        } else if (exportFormat === 'JSON') {
          downloadText(`${safeTitle}.json`, JSON.stringify({
            id: meetingId, title, createdAt, duration, transcript, segments, minutes,
            translations: translationMap,
          }, null, 2), 'application/json');
        } else {
          const lines = [
            `# ${title || t('meeting.untitled')}`,
            '',
            `${t('detail.createdAt')}: ${formatDate(createdAt)}`,
            `${t('detail.duration')}: ${formatTime(duration)}`,
            '',
            `## ${t('minutes.summary')}`,
            minutes?.summary || '—',
            '',
            `## ${t('minutes.topics')}`,
            ...(minutes?.topics || []).map((topic) => `- **${topic.title}** ${topic.summary || ''}`),
            '',
            `## ${t('minutes.decisions')}`,
            ...(minutes?.decisions || []).map((item) => `- ${item.title || item.text || ''}`),
            '',
            `## ${t('minutes.todos')}`,
            ...(minutes?.todos || []).map((item) => `- ${item.text || ''}`),
            '',
            `## ${t('transcript.title')}`,
            transcript,
          ];
          downloadText(`${safeTitle}.md`, lines.join('\n'), 'text/markdown');
        }
        setShareOpen(false);
      };

      const matchesSearch = (value) => !searchQuery || String(value || '').toLowerCase().includes(searchQuery.toLowerCase());

      /** The current meeting's people, annotated from the player speaker count. */
      const renderSpeakerList = () => {
        const speakers = [...new Set(segments.map((segment) => segment.speaker).filter(Boolean))];
        const letters = speakerLetterMap(segments);
        const renderPlay = (speaker) => h('button', {
          type: 'button', className: 'mvm-voice-play mvm-speaker-play',
          title: t('voice.playSample'), 'aria-label': t('voice.playSample'),
          onClick: () => playSpeakerSample(speaker),
        }, h(Icon, { name: 'play', size: 11 }));
        return h('div', { className: 'mvm-speaker-control', ref: speakerControlRef },
          h('button', {
            type: 'button', className: 'mvm-speaker-count',
            'aria-expanded': speakerListOpen, 'aria-haspopup': 'dialog',
            'aria-controls': 'mvm-speaker-popover', title: t('voice.speakersTitle'),
            onClick: () => {
              setSpeakerListOpen((value) => !value);
              setLabelingSpeaker(''); setLabelingUtteranceIndex(null);
              setLabelDraft('');
            },
          },
            h(Icon, { name: 'users', size: 14 }),
            t('detail.speakerCount', { count: speakers.length }),
            h(Icon, { name: 'caret', size: 12 })),
          speakerListOpen ? h('div', {
            id: 'mvm-speaker-popover', className: 'mvm-speaker-popover',
            role: 'dialog', 'aria-label': t('voice.speakersTitle'),
          },
            h('div', { className: 'mvm-speaker-popover-head' },
              h('span', null, t('voice.speakersTitle')),
              h('span', { className: 'mvm-hint' }, String(speakers.length))),
            speakers.length ? h('div', { className: 'mvm-speaker-list' }, speakers.map((speaker) => {
              const letter = letters.get(speaker) || '';
              const fallback = letter ? t('speaker.letter').replace('{letter}', letter) : speaker;
              const label = speakerLabels[speaker] || fallback;
              if (labelingSpeaker === speaker) {
                return h('div', { key: speaker, className: 'mvm-speaker-person-row' },
                  renderPlay(speaker),
                  h('form', {
                    className: 'mvm-speaker-editor-row',
                    onSubmit: (event) => { event.preventDefault(); void commitSpeakerLabel(speaker); },
                  },
                    h('input', {
                      className: 'mvm-input mvm-speaker-name-input', value: labelDraft,
                      placeholder: t('voice.label'), 'aria-label': t('voice.label'), autoFocus: true,
                      onChange: (event) => setLabelDraft(event.target.value),
                    }),
                    h(Button, {
                      icon: 'save', primary: true, type: 'button', className: 'mvm-speaker-save',
                      disabled: !labelDraft.trim(), onClick: () => void commitSpeakerLabel(speaker),
                    }, t('voice.save'))));
              }
              return h('div', { key: speaker, className: 'mvm-speaker-person-row' },
                renderPlay(speaker),
                h('button', {
                  type: 'button', className: 'mvm-speaker-person',
                  title: t('voice.label'),
                  onClick: () => { setLabelingSpeaker(speaker); setLabelDraft(speakerLabels[speaker] || ''); },
                },
                  h('span', { className: `mvm-speaker-person-dot ${speakerLabels[speaker] ? 'is-named' : ''}` }),
                  h('span', { className: 'mvm-speaker-person-label' }, label),
                  h(Icon, { name: 'edit', size: 13 })));
            })) : h('div', { className: 'mvm-speaker-empty' }, t('voice.emptySpeakers')),
            voiceSampleError.id.startsWith('speaker:') && voiceSampleError.message
              ? h('div', { className: 'mvm-voice-error mvm-speaker-error', role: 'alert' }, voiceSampleError.message)
              : null,
            h('p', { className: 'mvm-speaker-hint' }, t('voice.speakersHint')),
            h('audio', { ref: speakerSampleRef, preload: 'none', className: 'mvm-live-audio' })) : null);
      };

      const renderAudioPlayer = () => h('div', { className: 'mvm-player' },
        // The element is only mounted once it has a real source: an empty src
        // resolves to the page URL, which fails and leaves the media without a
        // length, so the timeline would show Infinity.
        detailAudioSrc ? h('audio', {
          ref: detailAudioRef, src: detailAudioSrc, preload: 'metadata', className: 'mvm-live-audio',
          onLoadedMetadata: (event) => {
            const value = Number(event.target.duration);
            setDetailDuration(Number.isFinite(value) && value > 0 ? value : Number(duration) || 0);
          },
          onTimeUpdate: (event) => setDetailTime(event.target.currentTime || 0),
          onPlay: () => setDetailPlaying(true),
          onPause: () => setDetailPlaying(false),
          onEnded: () => setDetailPlaying(false),
          onError: () => { if (detailAudioSrc) setError(t('detail.noAudio')); },
        }) : null,
        h('div', { className: 'mvm-player-timeline' },
          h(Button, {
            icon: detailPlaying ? 'pause' : 'play', primary: true, className: 'mvm-player-play',
            onClick: onDetailPlayPause, disabled: !detailAudioSrc,
          }, detailPlaying ? t('detail.pause') : t('detail.play')),
          h('span', null, formatTime(detailTime)),
          h('input', {
            type: 'range', min: 0, max: playerDuration, step: 1,
            value: Math.min(detailTime, playerDuration),
            disabled: !detailAudioSrc, onChange: onDetailSeek,
            'aria-label': t('detail.play'),
          }),
          h('span', null, formatTime(playerDuration))),
        renderAudioFiles(),
        h('div', { className: 'mvm-player-controls' },
          renderSpeakerList(),
          h('div', { className: 'mvm-skip-group', role: 'group', 'aria-label': t('detail.playbackSpeed') },
            h('button', {
              type: 'button', className: 'mvm-skip-button mvm-skip-back', onClick: () => skip(-15),
              title: t('detail.skipBack'), 'aria-label': t('detail.skipBack'),
            }, h(Icon, { name: 'rewind', size: 13 }), h('span', null, '15')),
            h('button', {
              type: 'button', className: 'mvm-skip-button mvm-skip-forward', onClick: () => skip(15),
              title: t('detail.skipForward'), 'aria-label': t('detail.skipForward'),
            }, h(Icon, { name: 'forward', size: 13 }), h('span', null, '15'))),
          h('span', { className: 'mvm-playback-spacer' }),
          h('label', { className: 'mvm-rate-control' },
            h('span', null, t('detail.playbackSpeed')),
            h('select', {
              className: 'mvm-rate-select', value: String(playbackRate),
              'aria-label': t('detail.playbackSpeed'),
              onChange: (event) => changePlaybackRate(event.target.value),
            }, [0.75, 1, 1.25, 1.5, 2].map((rate) => h('option', { value: String(rate), key: rate }, `${rate}×`))))));

      /** The audio files of this meeting, as a compact row inside the player. */
      const renderAudioFiles = () => {
        if (!audioFiles.length) return null;
        const label = (file) => t(file.kind === 'upload' ? 'detail.audioUpload'
          : file.kind === 'mix' ? 'detail.audioFull'
            : file.track === 'system' ? 'detail.audioSystem' : 'detail.audioMic');
        return h('div', { className: 'mvm-player-files' },
          audioFiles.length > 1 ? h('select', {
            className: 'mvm-input mvm-audio-select', value: selectedAudioId,
            'aria-label': t('detail.audioResources'),
            onChange: (event) => onSelectAudio(audioFiles.find((file) => file.id === event.target.value)),
          }, audioFiles.map((file) => h('option', { value: file.id, key: file.id }, label(file)))) : h('span', { className: 'mvm-hint' }, label(audioFiles[0])),
          selectedAudioFile ? h('a', {
            className: 'mvm-button', href: selectedAudioFile.downloadUrl, download: '',
            title: t('detail.audioDownload'),
          }, h(Icon, { name: 'save', size: 14 }), t('detail.audioDownload')) : null,
          selectedAudioFile ? h(Button, {
            icon: 'trash', danger: true, title: t('action.delete'),
            onClick: () => onDeleteAudio(selectedAudioFile), disabled: audioBusy !== '',
          }) : null);
      };

      const renderImportCard = () => meetingId ? null : h('section', { className: 'mvm-card' },
        h('div', { className: 'mvm-card-head' },
          h('h2', { className: 'mvm-section-title' }, t('import.title')),
          selectedFile ? h('span', { className: 'mvm-label' }, t('import.selected')) : null),
        h('div', { className: 'mvm-card-body' },
          h('input', {
            className: 'mvm-file-input', type: 'file', ref: fileRef,
            accept: 'audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac', onChange: onFile,
          }),
          h('div', { className: 'mvm-import' },
            h('span', { className: 'mvm-file-icon' }, h(Icon, { name: 'file', size: 21 })),
            h('div', { className: 'mvm-file-meta' },
              h('div', { className: 'mvm-file-name' }, selectedFile ? selectedFile.name : t('import.empty')),
              selectedFile ? h('div', { className: 'mvm-file-detail' }, `${selectedFile.type || 'audio'} · ${formatBytes(selectedFile.size)}`) : null),
            h('div', { className: 'mvm-import-actions' },
              h(Button, { icon: 'file', onClick: () => fileRef.current?.click(), disabled: isBusy }, selectedFile ? t('action.change') : t('action.choose')),
              h(Button, { icon: 'play', primary: true, onClick: onTranscribe, disabled: isBusy || !selectedFile },
                busy === 'transcribe' ? t('state.transcribing') : t('action.transcribe')))),
          h('div', { className: 'mvm-hint' }, t('import.hint')),
          busy === 'transcribe' ? h('div', { className: 'mvm-progress' }, h('span', { className: 'mvm-spinner' }), t('state.transcribing')) : null));

      const renderTopics = () => (minutes?.topics || []).length ? h('section', { className: 'mvm-minute-section' },
        h('h3', { className: 'mvm-minute-heading' }, t('minutes.topics')),
        h('div', { className: 'mvm-topic-grid' }, minutes.topics.map((topic, index) => h('article', { className: 'mvm-topic', key: index },
          h('div', { className: 'mvm-topic-title' }, topic.title || ''),
          h('div', { className: 'mvm-topic-text' }, topic.summary || ''))))) : null;

      const renderChapters = () => (minutes?.chapters || []).length ? h('section', { className: 'mvm-minute-section' },
        h('h3', { className: 'mvm-minute-heading' }, t('minutes.chapters')),
        h('ul', { className: 'mvm-list' }, minutes.chapters.map((chapter, index) => h('li', { className: 'mvm-list-item', key: index },
          h('div', { className: 'mvm-list-title' }, `${formatTime(chapter.start)} · ${chapter.title || ''}`),
          h('div', { className: 'mvm-list-detail' }, chapter.summary || ''))))) : null;

      const renderViewpoints = () => (minutes?.viewpoints || []).length ? h('section', { className: 'mvm-minute-section' },
        h('h3', { className: 'mvm-minute-heading' }, t('minutes.viewpoints')),
        h('div', { className: 'mvm-topic-grid' }, minutes.viewpoints.map((viewpoint, index) => h('article', { className: 'mvm-topic', key: index },
          h('div', { className: 'mvm-topic-title' }, viewpoint.theme || ''),
          (viewpoint.cards || []).map((card, cardIndex) => h('div', { className: 'mvm-topic-text', key: cardIndex },
            `${card.stance || ''}${card.stance && card.detail ? ' · ' : ''}${card.detail || ''}`,
            card.risk ? h('div', { className: 'mvm-list-meta' }, card.risk) : null)))))) : null;

      const renderNamedList = (key, items, kind) => (items || []).length ? h('section', { className: 'mvm-minute-section' },
        h('h3', { className: 'mvm-minute-heading' }, t(`minutes.${key}`)),
        h('ul', { className: 'mvm-list' }, items.map((item, index) => {
          const itemTitle = kind === 'decision' ? item.title : item.text;
          const meta = [item.owner, item.due].filter(Boolean).join(' · ');
          return h('li', { className: 'mvm-list-item', key: index },
            h('div', { className: 'mvm-list-title' }, itemTitle || ''),
            item.detail ? h('div', { className: 'mvm-list-detail' }, item.detail) : null,
            meta ? h('div', { className: 'mvm-list-meta' }, meta) : null);
        }))) : null;

      const liveStatusText = (status, transcriptionPaused = false) => {
        if (transcriptionPaused) return t('live.status.paused');
        if (status === 'active') return t('live.status.active');
        if (status === 'running') return t('live.status.running');
        if (status === 'starting') return t('live.status.starting');
        if (status === 'stopped') return t('live.status.stopped');
        if (status === 'failed') return t('live.status.failed');
        if (status === 'error') return t('live.status.error');
        return status || t('live.status.idle');
      };

      const LIVE_SOURCE_OPTIONS = [
        ['auto', 'live.source.auto'], ['zh-en', 'live.source.zhEn'],
        ['zh', 'live.source.zh'], ['en', 'live.source.en'],
      ];

      const LIVE_TARGET_OPTIONS = [
        ['zh', 'live.language.zh'], ['zh-Hant', 'live.language.zhHant'], ['yue', 'live.language.yue'],
        ['en', 'live.language.en'], ['ja', 'live.language.ja'], ['ko', 'live.language.ko'],
        ['th', 'live.language.th'], ['id', 'live.language.id'],
      ];

      const liveLanguageField = (labelKey, value, onChange, options) => h('label', { className: 'mvm-live-language' },
        h('span', { className: 'mvm-live-language-label' }, t(labelKey)),
        h('select', {
          className: 'mvm-input mvm-live-select', value, onChange,
          disabled: liveIsActive || liveBusy !== '',
        },
          (options || []).map(([optionValue, optionKey]) => h('option', { value: optionValue, key: optionValue }, t(optionKey)))));

      const renderLiveTranscriptEntry = (event, index, timeLabel) => {
        const sourceLabel = event.source === 'mic' ? t('live.source.mic')
          : event.source === 'system' ? t('live.source.system')
            : event.source || t('live.source.unknown');
        const detail = formatLiveDetail(event.detail);
        const provisional = event.pass === 'provisional';
        const corrected = Boolean(event.corrected);
        return h('article', {
          className: `mvm-live-event mvm-live-bilingual${provisional ? ' is-provisional' : ''}${corrected ? ' is-corrected' : ''}`,
          key: `bilingual-${event.chunkId ?? event.seq ?? index}`,
        },
          h('div', { className: 'mvm-live-event-meta' },
            h('span', null, sourceLabel),
            h('time', null, timeLabel ? timeLabel(event.timestamp) : formatLiveTimestamp(event.timestamp)),
            provisional ? h('span', { className: 'mvm-pass-badge is-provisional' },
              h('span', { className: 'mvm-pass-dot' }), t('live.pass.provisional')) : null,
            corrected ? h('span', { className: 'mvm-pass-badge is-corrected' }, t('live.pass.corrected')) : null),
          h('div', { className: 'mvm-live-text' }, event.originalText || '—'),
          h('div', { className: 'mvm-live-text mvm-live-translation' },
            event.translatedText || t('live.translationPending')),
          detail ? h('section', { className: 'mvm-live-detail' },
            h('span', { className: 'mvm-live-text-label' }, t('live.details')),
            h('pre', null, detail)) : null);
      };

      const renderLiveEvent = (event, index, mode = 'original', timeLabel) => {
        const detail = formatLiveDetail(event.detail);
        const sourceLabel = event.source === 'mic' ? t('live.source.mic')
          : event.source === 'system' ? t('live.source.system')
            : event.source || t('live.source.unknown');
        const text = mode === 'original' ? event.originalText : event.translatedText;
        return h('article', {
          className: `mvm-live-event ${event.type === 'error' ? 'is-error' : ''}`,
          key: `${mode}-${event.chunkId ?? event.seq ?? index}`,
        },
          h('div', { className: 'mvm-live-event-meta' },
            h('span', null, sourceLabel),
            h('time', null, timeLabel ? timeLabel(event.timestamp) : formatLiveTimestamp(event.timestamp))),
          mode === 'notes' ? h('div', { className: 'mvm-live-pair' },
            h('section', null,
              h('span', { className: 'mvm-live-text-label' }, t('live.original')),
              h('div', { className: 'mvm-live-text' }, event.originalText || '—')),
            h('section', null,
              h('span', { className: 'mvm-live-text-label' }, t('live.translation')),
              h('div', { className: 'mvm-live-text mvm-live-translation' }, event.translatedText || t('live.translationPending'))))
            : h('div', { className: `mvm-live-text ${mode === 'translation' ? 'mvm-live-translation' : ''}` },
              text || (mode === 'translation' ? t('live.translationPending') : '—')),
          detail ? h('section', { className: 'mvm-live-detail' },
            h('span', { className: 'mvm-live-text-label' }, t('live.details')),
            h('pre', null, detail)) : null);
      };

      const renderLive = () => {
        const metrics = liveSession?.metrics || {};
        const queue = metrics.queue ?? metrics.queueDepth ?? metrics.pending;
        const latency = metrics.latencyMs ?? metrics.latency ?? metrics.latencySeconds;
        const degraded = Boolean(liveSession && liveSession.degraded);
        const mergedEvents = mergeLiveEvents(liveEvents.filter((event) => (
          liveTrack === 'all' || event.source === liveTrack || event.type === 'marker'
        )), provisionalChunksRef.current);
        const errorEvents = mergedEvents.filter((event) => event.type === 'error');
        const uniqueErrors = [...new Map(errorEvents.map((event) => [event.detail || event.text || '', event])).values()];
        const readableEvents = mergedEvents.filter((event) => event.type !== 'error');
        const originalEvents = readableEvents.filter((event) => event.originalText);
        const streamEntries = readableEvents.filter((event) => (
          event.originalText || event.kind === 'note' || event.kind === 'flag'
        ));
        const numericTimes = streamEntries
          .map((event) => Number(event.timestamp))
          .filter((value) => Number.isFinite(value) && value > 0);
        const liveTimeBase = numericTimes.length ? Math.min(...numericTimes) : 0;
        const liveTimeLabel = (value) => {
          const numeric = Number(value);
          if (!Number.isFinite(numeric) || numeric <= 0) return value ? formatDate(value) : '';
          if (numeric >= 86400) {
            const rebase = liveTimeBase >= 86400000;
            return formatClock(Math.max(0, (numeric - (rebase ? liveTimeBase : 0)) / 1000));
          }
          return formatClock(numeric);
        };
        const audioTrack = liveTrack === 'all' ? 'mic' : liveTrack;
        const audioSrc = liveSession?.id
          ? `/api/ai-minutes/live-audio?id=${encodeURIComponent(liveSession.id)}&track=${audioTrack}`
          : '';
        const playbackLabel = liveTrack === 'all' ? t('live.source.mic')
          : liveTrack === 'mic' ? t('live.source.mic') : t('live.source.system');
        const errorText = uniqueErrors[0]?.detail || uniqueErrors[0]?.text || '';
        const endpointHost = errorText.match(/https?:\/\/([^/\s]+)/)?.[1]
          || errorText.match(/[（(]([^）)]+)[）)]/)?.[1]
          || '';
        const elapsed = Number(liveSession?.durationSeconds) || (liveSession?.startedAt
          ? Math.max(0, Math.round((Date.now() - new Date(liveSession.startedAt).getTime()) / 1000))
          : 0);
        const elapsedLabel = formatClock(elapsed);
        return h('main', { className: 'mvm-workspace mvm-live-workspace' },
          h('div', { className: 'mvm-live-container' },
            h('div', { className: 'mvm-live-header' },
              h('div', { className: 'mvm-live-intro' },
                h('button', {
                  type: 'button', className: 'mvm-back-button mvm-live-back', onClick: onBackToLibrary,
                },
                  h('span', { className: 'mvm-back-arrow', 'aria-hidden': 'true' },
                    h(Icon, { name: 'arrow-left', size: 15 })),
                  t('detail.back')),
                h('h2', { className: 'mvm-section-title' }, t('live.title')),
                h('div', { className: 'mvm-hint' }, t('live.subtitle'))),
              h('div', { className: 'mvm-live-topbar' },
              liveLanguageField('live.sourceLanguage', liveSourceLanguage, (event) => {
                const value = event.target.value;
                setLiveSourceLanguage(value);
                if (value === liveTargetLanguage) setLiveTargetLanguage(value === 'zh' ? 'en' : 'zh');
              }, LIVE_SOURCE_OPTIONS),
              liveLanguageField('live.targetLanguage', liveTargetLanguage, (event) => {
                const value = event.target.value;
                setLiveTargetLanguage(value);
                if (value === liveSourceLanguage) setLiveSourceLanguage(value === 'zh' ? 'en' : 'zh');
              }, LIVE_TARGET_OPTIONS),
              h('span', { className: 'mvm-live-divider' }),
              h('button', {
                type: 'button',
                className: `mvm-incognito-badge ${liveIncognito ? 'is-on' : ''}`,
                title: `${t('live.incognito')} · ${liveIncognito ? t('live.incognitoEnabled') : t('live.incognitoNotEnabled')}`,
                'aria-pressed': liveIncognito,
                onClick: onToggleIncognito,
              },
                h('span', { className: 'mvm-incognito-dot' }),
                t('live.incognito')))),
            uniqueErrors.length ? h('div', { className: 'mvm-alert mvm-alert-error mvm-live-alert', role: 'alert' },
              h('div', { className: 'mvm-live-alert-body' },
                h('strong', null, t('live.error')),
                h('span', null, uniqueErrors[0].detail || uniqueErrors[0].text || t('live.error')),
                endpointHost ? h('span', { className: 'mvm-hint' }, `${t('live.error.endpoint')}: ${endpointHost}`) : null),
              h('div', { className: 'mvm-live-alert-actions' },
                h(Button, { icon: 'refresh', onClick: onLiveRetry, disabled: liveBusy !== '' }, t('live.error.retry')),
                h('button', {
                  type: 'button', className: 'mvm-icon-button', 'aria-label': t('action.close'),
                  onClick: () => setLiveError(''),
                }, h(Icon, { name: 'close', size: 14 })))) : null,
            h('div', { className: 'mvm-live-session-actions' },
              h('div', { className: 'mvm-live-metrics', role: 'status' },
                h('span', { className: 'mvm-live-status-badge' },
                  h('span', { className: `mvm-live-recording-dots ${liveIsActive ? 'is-live' : ''}` },
                    h('span'), h('span'), h('span')),
                  h('span', null, `${t('live.status')}: ${liveStatusText(liveSession?.status, liveSession?.transcriptionPaused)}`),
                  h('span', { className: 'mvm-live-status-time' }, formatTime(elapsed))),
                h('details', { className: 'mvm-live-diagnostics' },
                  h('summary', { className: 'mvm-live-diagnostics-summary' }, t('live.diagnostics')),
                  h('div', { className: 'mvm-live-diagnostics-body' },
                    h('span', { className: 'mvm-live-metric' }, `${t('live.queue')}: ${formatLiveMetric(queue)}`),
                    h('span', { className: 'mvm-live-metric' }, `${t('live.latency')}: ${formatLiveMetric(latency)}`),
                    finalizeStatus?.lastFinalAt
                      ? h('span', { className: 'mvm-live-metric' }, `${t('live.lastFinalized')}: ${formatDate(finalizeStatus.lastFinalAt)}`)
                      : null,
                    finalizeStatus?.pending ? h('span', { className: 'mvm-live-metric is-degraded' }, t('live.finalizePending')) : null,
                    h('span', { className: 'mvm-live-metric mvm-live-hotwords' },
                      `${t('live.hotwords')}: ${liveSession?.hotwords || parseHotwords(settings?.hotwords) || t('live.hotwords.none')}`),
                    degraded ? h('span', { className: 'mvm-live-metric is-degraded' }, t('live.degraded')) : null))),
              h(LiveRibbon, { t, live: liveIsActive }),
              h('label', { className: 'mvm-live-track-filter' },
                h('span', null, t('live.track')),
                h('select', {
                  className: 'mvm-input mvm-live-select', value: liveTrack,
                  onChange: (event) => setLiveTrack(event.target.value),
                },
                  h('option', { value: 'all' }, t('live.track.all')),
                  h('option', { value: 'mic' }, t('live.track.mic')),
                  h('option', { value: 'system' }, t('live.track.system'))))),
            h('div', { className: 'mvm-studio-grid' },
              h('section', { className: 'mvm-studio-column mvm-transcript-column' },
                h('div', { className: 'mvm-studio-header' },
                  h('h2', { className: 'mvm-studio-title' }, t('live.transcription'))),
                streamEntries.length ? h('div', {
                  className: 'mvm-live-events', role: 'log', 'aria-live': 'polite', ref: liveEventsRef,
                },
                  streamEntries.map((event, index) => (
                    event.kind === 'note' || event.kind === 'flag'
                      ? h('div', {
                        className: `mvm-live-marker is-${event.kind}`, key: `marker-${event.seq ?? index}`,
                      },
                        h('span', { className: 'mvm-live-marker-kind' },
                          event.kind === 'flag' ? t('live.marker.flag') : t('live.marker.note')),
                        h('span', null, event.text || event.originalText || ''))
                      : renderLiveTranscriptEntry(event, index, liveTimeLabel)
                  )))
                  : h(EmptyState, { title: t('live.transcription') }, t('live.empty'))),
              h('section', { className: 'mvm-studio-column mvm-summary-column' },
                h('div', { className: 'mvm-studio-header mvm-studio-tabs', role: 'tablist' },
                  h('button', {
                    type: 'button', className: `mvm-studio-tab ${liveRightTab === 'summary' ? 'is-active' : ''}`,
                    role: 'tab', 'aria-selected': liveRightTab === 'summary', onClick: () => setLiveRightTab('summary'),
                  }, t('live.summary')),
                  h('button', {
                    type: 'button', className: `mvm-studio-tab ${liveRightTab === 'notes' ? 'is-active' : ''}`,
                    role: 'tab', 'aria-selected': liveRightTab === 'notes', onClick: () => setLiveRightTab('notes'),
                  }, t('live.notes')),
                  h('span', { className: 'mvm-playback-spacer' }),
                  h('select', {
                    className: 'mvm-input mvm-live-select', value: liveSummaryLanguage,
                    'aria-label': t('live.summaryLanguage'),
                    disabled: !liveIsActive,
                    onChange: (event) => { void onSummaryLanguage(event.target.value); },
                  }, LIVE_TARGET_OPTIONS.map(([value, key]) => h('option', { value, key }, t(key))))),
                liveRightTab === 'summary'
                  ? h('div', { className: 'mvm-live-events', role: 'log', 'aria-live': 'polite' },
                    h('div', { className: 'mvm-live-topic' },
                      h('span', { className: 'mvm-live-topic-chip' }, t('live.topic')),
                      liveSummaryBlocks(liveSummary).length
                        ? h('div', { className: 'mvm-live-topic-children' },
                          liveSummaryBlocks(liveSummary).map((block, index) => h('div', { className: 'mvm-live-topic-card', key: index },
                            block.title ? h('div', { className: 'mvm-live-topic-card-title' }, block.title) : null,
                            h('div', { className: 'mvm-live-text' }, block.text))))
                        : h('div', { className: 'mvm-live-skeletons' },
                          h('span', { className: 'mvm-live-skeleton' }),
                          h('span', { className: 'mvm-live-skeleton' }),
                          h('span', { className: 'mvm-live-skeleton' }))),
                    h('div', { className: 'mvm-live-summary-footer' },
                      liveSummaryBusy ? t('live.summaryGenerating') : t('live.minutesAuto')))
                  : mergedEvents.length ? h('div', { className: 'mvm-live-events' },
                    mergedEvents.map((event, index) => renderLiveEvent(event, index, 'notes', liveTimeLabel)))
                    : h(EmptyState, { title: t('live.notes') }, t('live.empty')))),
            h('div', { className: 'mvm-playback-bar mvm-live-control-bar' },
              h('span', { className: `mvm-live-recording-dots ${liveIsActive ? 'is-live' : ''}` },
                h('span'), h('span'), h('span')),
              h('span', { className: 'mvm-live-timer' }, elapsedLabel),
              h('button', {
                type: 'button', className: 'mvm-live-control-button',
                'aria-label': t('live.controls.note'), title: t('live.controls.note'),
                disabled: !liveIsActive || liveBusy !== '', onClick: () => onLiveMark('note'),
              }, h(Icon, { name: 'edit', size: 14 })),
              h('button', {
                type: 'button', className: 'mvm-live-control-button',
                'aria-label': t('live.controls.flag'), title: t('live.controls.flag'),
                disabled: !liveIsActive || liveBusy !== '', onClick: () => onLiveMark('flag'),
              }, h(Icon, { name: 'flag', size: 14 })),
              liveIsActive ? h(Button, {
                icon: liveSession?.transcriptionPaused ? 'play' : 'pause', onClick: onLivePause,
                disabled: liveBusy !== '',
              }, liveSession?.transcriptionPaused ? t('live.resumeTranscription') : t('live.pauseTranscription'))
                : h(Button, {
                  icon: 'mic', primary: true, onClick: onLiveStart,
                  disabled: liveBusy !== '' || liveSourceLanguage === liveTargetLanguage,
                }, liveBusy === 'start' ? t('live.starting') : t('live.start')),
              liveIsActive ? h(Button, {
                icon: 'refresh', onClick: onLiveFinalize, disabled: finalizeBusy || liveBusy !== '',
                title: t('live.finalizeHint'),
              }, finalizeBusy ? t('live.finalizing') : t('live.finalize')) : null,
              liveIsActive ? h(Button, {
                icon: 'close', danger: true, onClick: onLiveStop, disabled: liveBusy !== '',
              }, liveBusy === 'stop' ? t('live.stopping') : t('live.endMeeting')) : null,
              h('span', { className: 'mvm-playback-spacer' }),
              h(Button, {
                icon: livePlaying ? 'pause' : 'play', onClick: onLivePlayPause,
                disabled: !liveSession?.id,
              }, livePlaying ? t('live.pause') : t('live.play')),
              h(Button, {
                icon: 'window', onClick: onLiveOverlayOpen, disabled: !liveSession?.id,
                title: overlayOpen ? t('live.overlayShown') : t('live.overlayShow'),
              }, overlayOpen ? t('live.overlayShown') : t('live.overlayShow'))),
            h('audio', {
              ref: liveAudioRef, src: audioSrc, preload: 'none', className: 'mvm-live-audio',
              onPlay: () => setLivePlaying(true), onPause: () => setLivePlaying(false),
              onEnded: () => setLivePlaying(false),
            })));
      };


      const fallbackTemplates = () => [
        { id: 'intelligent-slicing', name: t('library.template.intelligentSlicing'), description: t('library.template.intelligentSlicingHint'), vip: false, builtin: true },
        { id: 'visual-summary', name: t('library.template.visualSummary'), description: t('library.template.visualSummaryHint'), vip: true, builtin: true },
        { id: 'classic', name: t('library.template.classic'), description: t('library.template.classicHint'), vip: false, builtin: true },
        { id: 'meeting-minutes', name: t('library.template.meetingMinutes'), description: t('library.template.meetingMinutesHint'), vip: false, builtin: true },
      ];

      const templateList = () => (templates.length ? templates : fallbackTemplates());

      const filteredMeetings = () => {
        const query = librarySearch.trim().toLowerCase();
        const list = meetings.filter((meeting) => {
          if (libraryFilter === 'favorite' && !meeting.favorite) return false;
          if (libraryFilter === 'shared' && !meeting.shared) return false;
          if (query) {
            const haystack = `${meeting.title || ''} ${meeting.excerpt || meeting.summary || ''}`.toLowerCase();
            if (!haystack.includes(query)) return false;
          }
          return true;
        });
        return list.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
      };

      const toggleLibrarySelection = (id, checked) => {
        setLibrarySelection((current) => (
          checked ? [...new Set([...current, id])] : current.filter((value) => value !== id)
        ));
      };

      const renderMeetingCard = (meeting) => h('article', {
        className: `mvm-meeting-card${meeting.inProgress ? ' is-live' : ''}`, key: meeting.id,
      },
        h('div', { className: 'mvm-meeting-card-head' },
          h('span', { className: 'mvm-meeting-thumb' }, String(meeting.title || 'M').slice(0, 2)),
          h('div', { className: 'mvm-meeting-card-titles' },
            h('button', {
              type: 'button', className: 'mvm-meeting-card-title',
              onClick: () => onOpenMeeting(meeting), disabled: isBusy,
            }, meeting.title || t('meeting.untitled')),
            h('div', { className: 'mvm-meeting-card-meta' },
              `${formatDate(meeting.createdAt)} · ${formatClock(meeting.duration)}`)),
          h('button', {
            type: 'button', className: `mvm-meeting-card-star${meeting.favorite ? ' is-favorite' : ''}`,
            title: t('action.favorite'), 'aria-label': t('action.favorite'),
            onClick: () => onToggleMeetingFavorite(meeting.id), disabled: isBusy,
          }, h(Icon, { name: 'star', size: 15, fill: meeting.favorite ? 'currentColor' : 'none' }))),
        meeting.inProgress
          ? h('span', { className: 'mvm-library-progress-pill is-inline' },
            h('span', { className: 'mvm-pulse-dot' }), t('library.inProgress'))
          : null,
        h('p', { className: 'mvm-meeting-card-excerpt' }, meeting.excerpt || meeting.summary || t('library.hint')),
        h('div', { className: 'mvm-meeting-card-foot' },
          h('span', { className: 'mvm-meeting-card-status' },
            meeting.hasMinutes ? t('library.status.ready') : t('library.status.pending')),
          h('span', { className: 'mvm-meeting-card-source' }, meeting.source || (meeting.realtime ? 'AI Minutes' : 'Import')),
          h('span', { className: 'mvm-playback-spacer' }),
          meeting.inProgress || meeting.liveStatus === 'recording'
            ? h('button', {
              type: 'button', className: 'mvm-library-live-link',
              onClick: () => onBackToLive(meeting),
            }, t('library.backToLive'))
            : null,
          h('button', {
            type: 'button', className: `mvm-icon-button ${meeting.favorite ? 'is-favorite' : ''}`,
            title: t('action.favorite'), 'aria-label': t('action.favorite'),
            onClick: () => onToggleMeetingFavorite(meeting.id), disabled: isBusy,
          }, h(Icon, { name: 'star', size: 15, fill: meeting.favorite ? 'currentColor' : 'none' })),
          h('button', {
            type: 'button', className: 'mvm-icon-button', title: t('action.delete'),
            'aria-label': t('action.delete'), onClick: () => onDelete(meeting.id), disabled: isBusy,
          }, h(Icon, { name: 'trash', size: 14 }))));

      const libraryStats = () => {
        const total = meetings.reduce((sum, meeting) => sum + (Number(meeting.duration) || 0), 0);
        const live = meetings.filter((meeting) => meeting.inProgress || ['recording', 'stopping'].includes(meeting.liveStatus)).length;
        const pending = meetings.filter((meeting) => !meeting.hasMinutes && !meeting.inProgress && !['recording', 'stopping'].includes(meeting.liveStatus)).length;
        return { count: meetings.length, total, live, pending };
      };

      const renderMeetingActions = () => h('div', { className: 'mvm-home-actions' },
        h(Button, {
          icon: 'mic', primary: true, title: t('action.interpretHint'),
          disabled: liveBusy !== '' || liveIsActive,
          onClick: () => { void onStartInterpretation(); },
        }, t('action.interpret')),
        h(Button, {
          icon: 'plus',
          onClick: () => { resetDraft(); setView('live'); },
        }, t('action.new')),
        h('button', {
          type: 'button', className: 'mvm-icon-button',
          title: t('library.importFile'), 'aria-label': t('library.importFile'),
          onClick: () => setShowImport(true),
        }, h(Icon, { name: 'file', size: 16 })),
        h('button', {
          type: 'button', className: 'mvm-icon-button',
          title: t('action.refresh'), 'aria-label': t('action.refresh'), disabled: libraryBusy,
          onClick: () => { void refreshMeetings(); void refreshHealth(); },
        }, h(Icon, { name: 'refresh', size: 16 })),
        renderVoicebookTrigger());

      const renderLibraryTable = () => {
        const filtered = filteredMeetings();
        const stats = libraryStats();
        return h('main', { className: 'mvm-workspace mvm-library-page' },
          h('div', { className: 'mvm-home' },
            h('div', { className: 'mvm-stats-row' },
              h('div', { className: 'mvm-stat-card' },
                h('span', { className: 'mvm-stat-value' }, String(stats.count)),
                h('span', { className: 'mvm-stat-label' }, t('home.stat.meetings'))),
              h('div', { className: 'mvm-stat-card' },
                h('span', { className: 'mvm-stat-value' }, formatClock(stats.total)),
                h('span', { className: 'mvm-stat-label' }, t('home.stat.duration'))),
              h('div', { className: 'mvm-stat-card' },
                h('span', { className: 'mvm-stat-value' }, String(stats.pending)),
                h('span', { className: 'mvm-stat-label' }, t('home.stat.pending'))),
              h('div', { className: `mvm-stat-card${stats.live ? ' is-live' : ''}` },
                h('span', { className: 'mvm-stat-value' }, String(stats.live)),
                h('span', { className: 'mvm-stat-label' }, t('home.stat.live')))),
            liveIsActive ? h('div', { className: 'mvm-live-banner', role: 'status' },
              h('span', { className: 'mvm-pulse-dot' }),
              h('span', { className: 'mvm-live-banner-text' }, t('library.liveBanner')),
              h(Button, {
                icon: 'play',
                onClick: () => {
                  const active = meetings.find((meeting) => meeting.inProgress);
                  if (active) void onBackToLive(active);
                  else setView('live');
                },
              }, t('library.backToLive'))) : null,
            h('div', { className: 'mvm-home-toolbar' },
              h('input', {
                className: 'mvm-input mvm-library-search', value: librarySearch,
                placeholder: t('library.search'), 'aria-label': t('library.search'),
                onChange: (event) => setLibrarySearch(event.target.value),
              }),
              h('div', { className: 'mvm-library-filters', role: 'tablist' },
                [
                  ['recent', 'library.filter.recent'], ['created', 'library.filter.created'],
                  ['shared', 'library.filter.shared'], ['favorite', 'library.filter.favorite'],
                ].map(([value, labelKey]) => h('button', {
                  type: 'button', role: 'tab', key: value,
                  className: `mvm-library-filter ${libraryFilter === value ? 'is-active' : ''}`,
                  'aria-selected': libraryFilter === value,
                  onClick: () => setLibraryFilter(value),
                }, t(labelKey)))),
              h('span', { className: 'mvm-playback-spacer' }),
              librarySelection.length ? h('span', { className: 'mvm-hint' }, t('library.selected').replace('{count}', String(librarySelection.length))) : null,
              h('div', { className: 'mvm-view-toggle' },
                h('button', {
                  type: 'button', className: `mvm-icon-button ${libraryView === 'grid' ? 'is-active' : ''}`,
                  'aria-label': t('library.view.cards'), 'aria-pressed': libraryView === 'grid',
                  onClick: () => setLibraryView('grid'),
                }, h(Icon, { name: 'grid', size: 14 })),
                h('button', {
                  type: 'button', className: `mvm-icon-button ${libraryView === 'list' ? 'is-active' : ''}`,
                  'aria-label': t('library.view.list'), 'aria-pressed': libraryView === 'list',
                  onClick: () => setLibraryView('list'),
                }, h(Icon, { name: 'list', size: 14 })))),
            filtered.length
              ? (libraryView === 'grid'
                ? h('div', { className: 'mvm-meeting-grid' }, filtered.map(renderMeetingCard))
                : h('div', { className: 'mvm-library-table', role: 'table' },
                  h('div', { className: 'mvm-library-row mvm-library-head', role: 'row' },
                    h('span', null, ''),
                    h('span', null, 'All'),
                    h('span', null, t('detail.createdAt')),
                    h('span', null, t('detail.duration')),
                    h('span', null, t('detail.creator')),
                    h('span', null, t('detail.source')),
                    h('span', null, t('detail.size')),
                    h('span', null, '')),
                  filtered.map((meeting) => h('div', { className: 'mvm-library-row', key: meeting.id },
                    h('span', { className: 'mvm-library-select-cell' }),
                    h('span', { className: 'mvm-library-title-cell' },
                      h('button', {
                        type: 'button', className: 'mvm-library-open', onClick: () => onOpenMeeting(meeting), disabled: isBusy,
                      },
                        h('span', { className: 'mvm-meeting-thumb' }, String(meeting.title || 'M').slice(0, 2)),
                        h('span', { className: 'mvm-library-title-copy' },
                          h('span', { className: 'mvm-library-title-row' },
                            h('strong', null, meeting.title || t('meeting.untitled')),
                            meeting.inProgress
                              ? h('span', { className: 'mvm-library-progress-pill is-inline' },
                                h('span', { className: 'mvm-pulse-dot' }), t('library.inProgress'))
                              : null),
                          h('small', null, meeting.excerpt || meeting.summary || '')))),
                    h('span', null, formatDate(meeting.createdAt)),
                    h('span', null, formatClock(meeting.duration)),
                    h('span', null, meeting.creator || 'You'),
                    h('span', null, meeting.source || (meeting.realtime ? 'AI Minutes' : 'Import')),
                    h('span', { className: 'mvm-library-size-cell' },
                      meeting.size ? formatBytes(meeting.size) : '—'),
                    h('span', { className: 'mvm-library-actions' },
                      h('button', {
                        type: 'button', className: 'mvm-icon-button', title: t('action.delete'),
                        'aria-label': t('action.delete'), onClick: () => onDelete(meeting.id), disabled: isBusy,
                      }, h(Icon, { name: 'trash', size: 14 })))))))
              : h('div', { className: 'mvm-home-empty' },
                h('div', { className: 'mvm-empty-title' }, libraryBusy ? t('state.loading') : t('library.empty')),
                h('p', { className: 'mvm-empty-text' }, t('library.hint'))),
            assistantOpen ? renderAssistantDrawer() : null));
      };

      const renderCompareDialog = () => {
        if (!compareResults) return null;
        const columns = (compareResults.results || []).map((item) => {
          const samples = (item.samples || []).map((sample, index) => h('div', { className: 'mvm-compare-sample', key: index },
            h('div', { className: 'mvm-compare-source' }, sample.source),
            h('div', { className: 'mvm-compare-target' }, sample.translation || (sample.error ? t('history.compareError') : '—'))));
          const flags = [];
          if (item.preambleHits) flags.push(h('span', { className: 'mvm-compare-flag', key: 'chatty' }, t('history.compareChatty')));
          if (item.emptyCount) flags.push(h('span', { className: 'mvm-compare-flag', key: 'empty' }, t('history.compareEmpty')));
          return h('div', { className: 'mvm-compare-column', key: item.model },
            h('div', { className: 'mvm-compare-head' },
              h('strong', null, item.model),
              h('span', { className: 'mvm-live-metric' }, `${item.avgMs} ms`),
              flags),
            h('div', { className: 'mvm-compare-samples' }, samples));
        });
        return h('div', { className: 'mvm-share-backdrop', role: 'presentation' },
          h('section', { className: 'mvm-share-dialog mvm-compare-dialog', role: 'dialog', 'aria-modal': 'true' },
            h('div', { className: 'mvm-share-head' },
              h('h3', { className: 'mvm-rail-title' }, t('history.compareTitle')),
              h('button', {
                type: 'button', className: 'mvm-icon-button', 'aria-label': t('action.close'),
                onClick: () => setCompareResults(null),
              }, h(Icon, { name: 'close' }))),
            h('div', { className: 'mvm-compare-body' }, columns)));
      };

      const renderDetailHeader = () => h('div', { className: 'mvm-detail-header' },
        h('div', { className: 'mvm-breadcrumb' },
          h('button', { type: 'button', className: 'mvm-back-button', onClick: onBackToLibrary },
            h('span', { className: 'mvm-back-arrow', 'aria-hidden': 'true' },
              h(Icon, { name: 'arrow-left', size: 15 })),
            t('detail.back')),
          editing ? h('input', {
            className: 'mvm-title-input', value: title, placeholder: t('meeting.titlePlaceholder'),
            'aria-label': t('meeting.title'), onChange: (event) => setTitle(event.target.value),
          }) : h('h2', null, title || t('meeting.untitled')),
          meetingRecording
            ? h('span', { className: 'mvm-library-progress-pill is-inline' },
              h('span', { className: 'mvm-pulse-dot' }), t('detail.recording'))
            : null,
          h('button', {
            type: 'button', className: `mvm-icon-button ${favorite ? 'is-favorite' : ''}`,
            title: t('action.favorite'), 'aria-label': t('action.favorite'),
            onClick: onToggleFavorite,
          }, h(Icon, { name: 'star', size: 15, fill: favorite ? 'currentColor' : 'none' }))),
        h('div', { className: 'mvm-detail-actions' },
          meetingRecording
            ? h(Button, {
              icon: 'close', danger: true, title: t('live.endMeeting'),
              disabled: liveBusy !== '',
              onClick: () => { void onEndMeeting(); },
            }, liveBusy === 'stop' ? t('live.stopping') : t('live.endMeeting'))
            : null,
          h(Button, { icon: 'edit', onClick: editing ? onSave : () => { setEditTranscript(transcript); setEditing(true); } }, editing ? t('detail.saveChanges') : t('action.edit')),
          h('div', { className: 'mvm-translation-menu' },
            h(Button, { icon: 'ask', onClick: () => setTranslationOpen((value) => !value) }, t('action.translation')),
            translationOpen ? h('div', { className: 'mvm-translation-options' },
              [
                ['original', 'Original (Not Translated)'],
                ['zh-Hans', '简体中文'],
                ['zh-Hant', '繁體中文'],
                ['yue', '粤语'],
                ['en', 'English'],
                ['ja', '日本語'],
                ['ko', '한국어'],
                ['th', 'ไทย'],
                ['id', 'Bahasa Indonesia'],
              ].map(([value, label]) => h('button', {
                type: 'button', key: value, className: translationLanguage === value ? 'is-active' : '',
                onClick: () => onTranslateLanguage(value), disabled: translationBusy,
              }, label)),
              h('label', { className: 'mvm-bilingual-toggle' },
                h('input', { type: 'checkbox', checked: bilingual, onChange: (event) => setBilingual(event.target.checked) }),
                'Bilingual Display')) : null),
          h(Button, { icon: 'save', onClick: () => { setShareTab('share'); setShareOpen(true); } }, t('action.share')),
          h(Button, { icon: 'ask', onClick: () => setSearchOpen((value) => !value) }, t('action.search'))),
        searchOpen ? h('input', {
          className: 'mvm-input mvm-detail-search', value: searchQuery,
          placeholder: t('detail.searchPlaceholder'), onChange: (event) => setSearchQuery(event.target.value),
        }) : null);

      const renderSpeakerChip = (speaker, letters, utteranceIndex = null) => {
        const key = speaker || '';
        const letter = key && letters ? letters.get(key) : '';
        const fallback = letter ? t('speaker.letter').replace('{letter}', letter) : (key || '—');
        const label = speakerLabels[key] || fallback;
        if (!key) return h('span', { className: 'mvm-speaker' }, label);
        if (!speakerListOpen && labelingSpeaker === key && labelingUtteranceIndex === utteranceIndex) {
          return h('span', { className: 'mvm-speaker-editor' },
            h('input', {
              className: 'mvm-input mvm-speaker-input', value: labelDraft,
              placeholder: t('voice.label'), autoFocus: true,
              onChange: (event) => setLabelDraft(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') void commitSpeakerLabel(key); },
            }),
            h(Button, { icon: 'save', primary: true, onClick: () => commitSpeakerLabel(key) }, t('voice.save')),
            h(Button, {
              icon: 'close', title: t('action.close'), 'aria-label': t('action.close'),
              onClick: () => { setLabelingSpeaker(''); setLabelingUtteranceIndex(null); setLabelDraft(''); },
            }, ''));
        }
        return h('button', {
          type: 'button',
          className: `mvm-speaker mvm-speaker-chip ${speakerLabels[key] ? 'is-named' : ''}`,
          title: t('voice.label'),
          onClick: () => {
            setSpeakerListOpen(false);
            setLabelingSpeaker(key);
            setLabelDraft(speakerLabels[key] || '');
          },
        }, label);
      };

      const renderUtteranceSpeaker = (speaker, letters, time, utteranceIndex) => {
        const key = speaker || '';
        const number = key && letters ? [...letters.keys()].indexOf(key) + 1 : 0;
        const fallback = number ? t('speaker.letter').replace('{letter}', String(number)) : (key || '—');
        const label = speakerLabels[key] || fallback;
        return h('div', { className: 'mvm-utterance-head' },
          h('span', { className: 'mvm-utterance-badge', 'aria-hidden': 'true' }, number || '—'),
          labelingSpeaker === key && !speakerListOpen
            ? renderSpeakerChip(key, letters, utteranceIndex)
            : h('button', {
              type: 'button', className: 'mvm-utterance-speaker', title: t('voice.label'),
              onClick: () => {
                setSpeakerListOpen(false);
                setLabelingSpeaker(key);
                setLabelingUtteranceIndex(utteranceIndex);
                setLabelDraft(speakerLabels[key] || '');
              },
            },
              h('span', { className: 'mvm-utterance-speaker-name' }, label),
              h('span', { className: 'mvm-utterance-time' }, time)));
      };

      const renderTranscribeTab = () => {
        const translated = translationMap[translationLanguage];
        const translatedLines = translated?.lines || [];
        const displayTranscript = showOriginalText ? transcript : (transcriptSimplified || transcript);
        const originalLines = segments.length ? segments : displayTranscript.split('\n').map((text) => ({ text }));
        const starts = relativeStarts(originalLines);
        const letters = speakerLetterMap(originalLines);
        const textOf = (line) => (showOriginalText ? (line.text || '') : (line.textSimplified || line.text || ''));
        const timeOf = (index) => (starts[index] === null || starts[index] === undefined ? '—' : formatClock(starts[index]));
        const renderUtterance = (line, index, withTranslation) => h('article', { className: 'mvm-utterance', key: index },
          renderUtteranceSpeaker(line.speaker, letters, timeOf(index), index),
          h('div', { className: 'mvm-utterance-text' },
            !withTranslation || bilingual ? h('div', { className: 'mvm-utterance-original' }, textOf(line)) : null,
            withTranslation
              ? translatedLines[index]
                ? h('div', { className: 'mvm-utterance-translation' }, translatedLines[index])
                : translationBusy ? h('div', { className: 'mvm-utterance-translation mvm-translation-skeleton' })
                  : h('div', { className: 'mvm-utterance-translation' }, t('detail.translationMissing'))
              : null));
        const visibleLines = originalLines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => matchesSearch(line.text) || matchesSearch(line.textSimplified) || matchesSearch(line.speaker));
        return h('section', { className: 'mvm-detail-tab-content' },
          h('div', { className: 'mvm-transcript-toolbar' },
            h(Button, {
              icon: 'refresh',
              onClick: () => setShowOriginalText((value) => !value),
            }, showOriginalText ? t('detail.showSimplified') : t('detail.showOriginal'))),
          editing ? h('textarea', {
            className: 'mvm-textarea mvm-edit-transcript', value: editTranscript,
            onChange: (event) => setEditTranscript(event.target.value),
          }) : visibleLines.length ? h('div', { className: 'mvm-transcript' },
            visibleLines.map(({ line, index }) => renderUtterance(line, index, translationLanguage !== 'original')))
            : h('div', { className: 'mvm-plain-transcript' }, transcript || t('transcript.empty')),
          translationBusy ? h('div', { className: 'mvm-translating-banner', role: 'status', 'aria-live': 'polite' },
            h('span', { className: 'mvm-spinner' }),
            h('span', null, `${t('state.translating')} ${translationProgress.done}/${translationProgress.total}`),
            h('div', { className: 'mvm-translation-progress' },
              h('span', { style: { width: `${translationProgress.total ? (translationProgress.done / translationProgress.total) * 100 : 0}%` } }))) : null);
      };

      const renderSummaryTab = () => {
        const mins = minutes || liveSummary || null;
        const chapters = (mins?.chapters || []).filter((chapter) => matchesSearch(chapter.title) || matchesSearch(chapter.summary));
        const summaryText = translationLanguage === 'original'
          ? mins?.summary
          : translationMap[translationLanguage]?.summary || mins?.summary;
        return h('section', { className: 'mvm-detail-tab-content' },
          h('div', { className: 'mvm-summary-hero' },
            h('div', { className: 'mvm-hint' }, t('detail.summary')),
            h('h2', null, title || t('meeting.untitled')),
            h('div', { className: 'mvm-hint' }, formatDate(createdAt)),
            summaryText ? h('p', null, summaryText) : null,
            h('div', { className: 'mvm-summary-stats' },
              h('span', null, `${mins?.topics?.length || 0} ${t('detail.topics')}`),
              h('span', null, formatClock(duration)),
              h('span', { className: 'mvm-template-badge' }, `${t('detail.templateUsed')}: ${t('library.template.' + (minutes?.template || selectedTemplate))}`))),
          liveIsActive ? h('div', { className: 'mvm-hint' }, `${t('detail.liveSummaryGenerating')} ${t('detail.liveSummaryHint')}`) : null,
          mins ? h(React.Fragment, null,
            mins.background ? h('section', { className: 'mvm-minute-section' },
              h('h3', { className: 'mvm-minute-heading' }, t('detail.templateBackground')),
              h('p', { className: 'mvm-summary-paragraph' }, mins.background)) : null,
            Array.isArray(mins.highlights) && mins.highlights.length ? h('section', { className: 'mvm-minute-section' },
              h('h3', { className: 'mvm-minute-heading' }, t('detail.templateHighlights')),
              h('ul', { className: 'mvm-list' }, mins.highlights.map((item, index) => h('li', { className: 'mvm-list-item', key: index },
                h('div', { className: 'mvm-list-title' }, item.title || ''),
                h('div', { className: 'mvm-list-detail' }, item.detail || ''))))) : null,
            Array.isArray(mins.conclusions) && mins.conclusions.length ? h('section', { className: 'mvm-minute-section' },
              h('h3', { className: 'mvm-minute-heading' }, t('detail.templateConclusions')),
              h('ul', { className: 'mvm-list' }, mins.conclusions.map((item, index) => h('li', { className: 'mvm-list-item', key: index },
                h('div', { className: 'mvm-list-detail' }, typeof item === 'string' ? item : item.title || item.text || ''))))) : null,
            Array.isArray(mins.actions) && mins.actions.length ? h('section', { className: 'mvm-minute-section' },
              h('h3', { className: 'mvm-minute-heading' }, t('detail.templateActions')),
              h('ul', { className: 'mvm-list' }, mins.actions.map((item, index) => h('li', { className: 'mvm-list-item', key: index },
                h('div', { className: 'mvm-list-title' }, item.text || ''),
                h('div', { className: 'mvm-list-meta' }, [item.owner, item.due].filter(Boolean).join(' · ')))))) : null,
            Array.isArray(mins.openItems) && mins.openItems.length ? h('section', { className: 'mvm-minute-section' },
              h('h3', { className: 'mvm-minute-heading' }, t('detail.templateOpenItems')),
              h('ul', { className: 'mvm-list' }, mins.openItems.map((item, index) => h('li', { className: 'mvm-list-item', key: index },
                h('div', { className: 'mvm-list-detail' }, typeof item === 'string' ? item : item.text || ''))))) : null,
            mins.conclusion ? h('section', { className: 'mvm-minute-section' },
              h('h3', { className: 'mvm-minute-heading' }, t('detail.templateConclusion')),
              h('p', { className: 'mvm-summary-paragraph' }, mins.conclusion)) : null,
            chapters.length ? h('section', { className: 'mvm-outline' },
              h('h3', null, t('detail.outline')),
              chapters.map((chapter, index) => h('button', {
                type: 'button', key: index, className: 'mvm-outline-item',
                onClick: () => { setSelectedChapter(index); setDetailTab('chapters'); },
              },
                h('strong', null, chapter.title || ''),
                h('span', null, `${formatClock(chapter.start)} – ${formatClock(chapter.end)}`)))) : null,
            renderTopics(), renderNamedList('decisions', mins.decisions, 'decision'),
            renderNamedList('todos', mins.todos, 'todo'),
            renderNamedList('disputes', mins.disputes, 'text'),
            renderNamedList('risks', mins.risks, 'text'))
            : h(EmptyState, { title: t('minutes.title') }, t('minutes.empty')));
      };

      const renderViewpointTab = () => {
        const mins = minutes || liveSummary || null;
        const groups = (mins?.viewpoints?.length ? mins.viewpoints : (mins?.topics || []).map((topic) => ({
          theme: topic.title,
          cards: [{ stance: 'Summary', detail: topic.summary || '', risk: (topic.decisions || []).join('; ') }],
        }))).filter((group) => matchesSearch(group.theme) || (group.cards || []).some((card) => matchesSearch(card.detail)));
        const renderMindmapCard = (card) => h(React.Fragment, null,
          card.stance ? h('strong', { className: 'mvm-mindmap-stance' }, card.stance) : null,
          card.detail ? h('p', { className: 'mvm-mindmap-detail' }, card.detail) : null,
          card.risk ? h('small', { className: 'mvm-mindmap-risk' }, card.risk) : null);
        return h('section', { className: 'mvm-detail-tab-content mvm-viewpoint-tree mvm-mindmap' },
          groups.length ? groups.map((group, index) => {
            const cards = group.cards || [];
            return h('article', { className: `mvm-mindmap-group tone-${index % 5}`, key: index },
              h('h3', { className: 'mvm-mindmap-theme' }, group.theme || ''),
              cards.length === 2
                ? h('div', { className: 'mvm-mindmap-comparison' },
                  cards.map((card, cardIndex) => h('div', { className: 'mvm-mindmap-compare-item', key: cardIndex },
                    renderMindmapCard(card))))
                : h('div', { className: 'mvm-mindmap-children' },
                  cards.map((card, cardIndex) => h('div', { className: 'mvm-mindmap-branch', key: cardIndex },
                    renderMindmapCard(card)))));
          })
            : h(EmptyState, { title: t('detail.viewpoints') }, t('minutes.empty')));
      };

      const renderChapterTab = () => {
        const mins = minutes || liveSummary || null;
        const chapters = mins?.chapters || [];
        const chapter = chapters[selectedChapter] || chapters[0];
        return h('section', { className: 'mvm-detail-tab-content' },
          h('div', { className: 'mvm-chapter-toolbar' },
            h(Button, { icon: 'settings', onClick: () => setChapterDetails((value) => !value) }, chapterDetails ? t('detail.hideDetails') : t('detail.showDetails'))),
          h('div', { className: 'mvm-chapter-list' },
            chapters.length ? chapters.map((item, index) => h('button', {
              type: 'button', key: index,
              className: `mvm-chapter-row ${index === selectedChapter ? 'is-active' : ''}`,
              onClick: () => setSelectedChapter(index),
            },
              h('span', { className: 'mvm-time' }, formatClock(item.start)),
              h('strong', null, item.title || ''),
              h('span', null, formatClock(item.end))))
              : h(EmptyState, { title: t('detail.chapter') }, t('minutes.empty'))),
          chapterDetails && chapter ? h('article', { className: 'mvm-chapter-detail' },
            h('div', { className: 'mvm-hint' }, `${formatClock(chapter.start)} – ${formatClock(chapter.end)}`),
            h('h3', null, chapter.title || ''),
            h('p', null, chapter.summary || '')) : null);
      };

      const renderShareDialog = () => shareOpen ? h('div', { className: 'mvm-share-backdrop', role: 'presentation' },
        h('section', { className: 'mvm-share-dialog', role: 'dialog', 'aria-modal': 'true' },
          h('div', { className: 'mvm-share-head' },
            h('div', { className: 'mvm-view-switch', role: 'tablist' },
              h('button', { type: 'button', className: `mvm-view-tab ${shareTab === 'share' ? 'is-active' : ''}`, onClick: () => setShareTab('share') }, t('action.share')),
              h('button', { type: 'button', className: `mvm-view-tab ${shareTab === 'export' ? 'is-active' : ''}`, onClick: () => setShareTab('export') }, `${t('detail.export')}/${t('detail.download')}`)),
            h('button', { type: 'button', className: 'mvm-icon-button', 'aria-label': t('action.close'), onClick: () => setShareOpen(false) }, h(Icon, { name: 'close' }))),
          shareTab === 'share' ? h('div', { className: 'mvm-share-content' },
            h('p', { className: 'mvm-hint' }, t('detail.copyLink')),
            h('div', { className: 'mvm-share-actions' },
              typeof props.onSendToChat === 'function' ? h(Button, {
                icon: 'ask', 'data-action': 'send-to-chat',
                onClick: () => props.onSendToChat({ id: meetingId, title, transcript }),
              }, t('detail.sendToChat')) : null,
              h(Button, { icon: 'save', primary: true, 'data-action': 'copy-link', onClick: copyLink }, t('detail.copyLink'))))
            : h('div', { className: 'mvm-share-content' },
              h('label', { className: 'mvm-field' },
                h('span', { className: 'mvm-label' }, t('detail.originalFile')),
                h('span', null, t('minutes.summary'))),
              h('label', { className: 'mvm-field' },
                h('span', { className: 'mvm-label' }, t('detail.format')),
                h('select', { className: 'mvm-input', value: exportFormat, 'aria-label': t('detail.format'), onChange: (event) => setExportFormat(event.target.value) },
                  h('option', { value: 'Markdown' }, 'Markdown'),
                  h('option', { value: 'JSON' }, 'JSON'),
                  h('option', { value: 'WAV' }, 'WAV'))),
              h('div', { className: 'mvm-hint' }, t('detail.audioFiles')),
              h('div', { className: 'mvm-share-actions' },
                h(Button, { icon: 'save', primary: true, onClick: onExport }, t('detail.export')))))) : null;

      const contextSuggestions = () => {
        const items = [];
        if (minutes?.decisions?.length) items.push(t('history.suggestDecisionsNow'));
        if (minutes?.todos?.length) items.push(t('history.suggestTodosNow'));
        if (minutes?.risks?.length) items.push(t('history.suggestRisksNow'));
        items.push(t('history.suggestSummaryNow'));
        items.push(t('history.suggestCrossHistory'));
        return items.slice(0, 4);
      };

      const renderRailHeader = () => h('div', { className: 'mvm-rail-header' },
        h('h3', { className: 'mvm-rail-title' }, t('history.chatTitle')),
        h('div', { className: 'mvm-rail-tools' },
          h(Button, {
            icon: 'refresh', title: t('history.newChat'), 'aria-label': t('history.newChat'),
            disabled: historyBusy, onClick: () => { setHistoryMessages([]); setHistorySources([]); },
          }),
          h('select', {
            className: 'mvm-rail-scope', value: historyScope,
            'aria-label': t('history.scopeAll'),
            onChange: (event) => setHistoryScope(event.target.value),
          },
            h('option', { value: 'all' }, t('history.scopeAll')),
            h('option', { value: 'current' }, t('history.scopeCurrent')))));

      const renderRailTiles = () => h('div', { className: 'mvm-rail-tiles' },
        h('button', {
          type: 'button', className: 'mvm-rail-tile', onClick: () => setDetailTab('viewpoints'),
        },
          h('span', { className: 'mvm-rail-tile-icon' }, h(Icon, { name: 'folder', size: 15 })),
          h('span', { className: 'mvm-rail-tile-body' },
            h('strong', null, t('history.tileMindMap')),
            h('small', null, t('history.tileMindMapHint')))),
        h('button', {
          type: 'button', className: 'mvm-rail-tile', onClick: () => setDetailTab('summary'),
        },
          h('span', { className: 'mvm-rail-tile-icon' }, h(Icon, { name: 'ask', size: 15 })),
          h('span', { className: 'mvm-rail-tile-body' },
            h('strong', null, t('history.tileKeyInsights')),
            h('small', null, t('history.tileKeyInsightsHint')))));

      const renderRecentMeetings = () => {
        const recent = meetings.slice(0, recentExpanded ? meetings.length : 4);
        return h('section', { className: 'mvm-rail-card' },
          h('div', { className: 'mvm-rail-card-head' },
            h('h3', { className: 'mvm-rail-subtitle' }, t('history.recent')),
            meetings.length > 4 ? h('button', {
              type: 'button', className: 'mvm-rail-link',
              onClick: () => setRecentExpanded((value) => !value),
            }, recentExpanded ? t('history.collapse') : t('history.expandAll')) : null),
          h('div', { className: 'mvm-recent-list' },
            recent.length ? recent.map((meeting) => h('button', {
              type: 'button', key: meeting.id,
              className: `mvm-recent-item ${meeting.id === meetingId ? 'is-active' : ''}`,
              onClick: () => onOpenMeeting(meeting),
            },
              h('div', { className: 'mvm-recent-item-head' },
                h('span', { className: 'mvm-recent-item-title' }, meeting.title || t('meeting.untitled')),
                h('span', { className: 'mvm-recent-item-time' }, formatDate(meeting.createdAt))),
              h('div', { className: 'mvm-recent-item-excerpt' }, meeting.excerpt || meeting.summary || t('library.empty'))))
              : h(EmptyState, { title: t('library.empty') }, t('library.hint'))));
      };

      const playVoiceSample = async (profile, audioRef = voiceSampleRef) => {
        const sample = profile?.sample;
        if (!sample?.meetingId) {
          setVoiceSampleError({ id: profile?.id || '', message: t('voice.sampleUnavailable') });
          return;
        }
        try {
          let url = '';
          if (String(sample.meetingId).startsWith('realtime-')) {
            url = `/api/ai-minutes/live-audio?id=${encodeURIComponent(sample.meetingId)}&track=${encodeURIComponent(sample.track || 'mic')}`;
          } else {
            const result = await callHost('get', { id: sample.meetingId });
            const audioId = result?.meeting?.audioId;
            if (!audioId) {
              setVoiceSampleError({ id: profile?.id || '', message: t('voice.sampleUnavailable') });
              return;
            }
            url = `/api/ai-minutes/meeting-audio?id=${encodeURIComponent(audioId)}`;
          }
          const element = audioRef.current;
          if (!element) return;
          element.pause();
          element.src = url;
          const start = Math.max(0, Number(sample.start) || 0);
          const end = Math.max(start + 1, Number(sample.end) || start + 3);
          // The media can only seek once it knows its length, so the excerpt
          // starts when the metadata arrives rather than at the recording head.
          const onReady = () => {
            element.removeEventListener('loadedmetadata', onReady);
            try { element.currentTime = start; } catch { /* the source may be shorter */ }
          };
          element.addEventListener('loadedmetadata', onReady);
          element.ontimeupdate = () => {
            if (element.currentTime >= end) {
              element.pause();
              element.removeAttribute('src');
              element.load();
            }
          };
          await element.play();
          setVoiceSampleError({ id: '', message: '' });
        } catch (cause) {
          setVoiceSampleError({ id: profile?.id || '', message: cause instanceof Error ? cause.message : String(cause) });
        }
      };

      /** Play the first excerpt spoken by one person in the current meeting. */
      const playSpeakerSample = async (speaker) => {
        const id = `speaker:${meetingId}:${speaker}`;
        const segment = segments.find((item) => item.speaker === speaker);
        if (!meetingId || !segment) {
          setVoiceSampleError({ id, message: t('voice.sampleUnavailable') });
          return;
        }
        const live = Boolean(segment.source);
        const start = Number(live ? segment.audioStart : segment.start);
        const end = Number(live ? segment.audioEnd : segment.end);
        if (!Number.isFinite(start) || start < 0) {
          setVoiceSampleError({ id, message: t('voice.sampleUnavailable') });
          return;
        }
        await playVoiceSample({
          id,
          sample: {
            meetingId,
            track: segment.source === 'system' ? 'system' : 'mic',
            start,
            end: Number.isFinite(end) && end > start ? end : start + 3,
          },
        }, speakerSampleRef);
      };

      const renderVoiceRow = (profile, unnamed = false) => h('div', {
        className: `mvm-voice-item ${unnamed ? 'is-unnamed' : ''}`, key: profile.id,
      },
        renamingProfile === profile.id
          ? h('form', {
            className: 'mvm-voice-rename mvm-voicebook-rename',
            onSubmit: (event) => { event.preventDefault(); void commitVoiceRename(profile.id); },
          },
            h('input', {
              className: 'mvm-input', value: labelDraft, autoFocus: true, placeholder: t('voice.label'),
              'aria-label': t('voice.label'), onChange: (event) => setLabelDraft(event.target.value),
            }),
            h(Button, {
              icon: 'save', primary: true, type: 'submit', title: t('voice.save'), 'aria-label': t('voice.save'),
            }),
            h(Button, {
              icon: 'close', type: 'button', title: t('action.close'), 'aria-label': t('action.close'),
              onClick: () => { setRenamingProfile(''); setLabelDraft(''); },
            }))
          : h('div', { className: 'mvm-voice-row mvm-voicebook-row' },
            h('button', {
              type: 'button', className: 'mvm-voice-play mvm-voicebook-play', title: t('voice.playSample'),
              'aria-label': t('voice.playSample'), onClick: () => void playVoiceSample(profile),
            }, h(Icon, { name: 'play', size: 11 })),
            h('button', {
              type: 'button', className: 'mvm-voice-button mvm-voice-name-button', title: t('voice.rename'),
              onClick: () => { setRenamingProfile(profile.id); setLabelDraft(profile.name || ''); },
            },
              h('span', { className: 'mvm-voice-name-block' },
                h('span', { className: 'mvm-voice-name' }, profile.name || t('voice.unnamed')),
                h('span', { className: 'mvm-voice-meta' },
                  profile.sample ? t('voice.sampleReady') : t('voice.sampleMissing'))),
              h(Icon, { name: 'edit', size: 13, className: 'mvm-voice-edit-icon' }))),
          voiceSampleError.id === profile.id && voiceSampleError.message
            ? h('div', { className: 'mvm-voice-error', role: 'alert' }, voiceSampleError.message)
            : null);

      const renderVoicebookPanel = () => {
        const query = voiceSearch.trim().toLowerCase();
        const matches = (profile) => !query || String(profile.name || t('voice.unnamed')).toLowerCase().includes(query);
        const named = voiceProfiles.filter((profile) => profile.name && matches(profile));
        const unnamed = voiceProfiles.filter((profile) => !profile.name && matches(profile));
        const visibleNamed = voiceFilter === 'unnamed' ? [] : named;
        const visibleUnnamed = voiceFilter === 'named' ? [] : unnamed;
        const unnamedExpanded = voiceFilter === 'unnamed' || Boolean(query) || unnamedOpen;
        const filters = [
          ['all', 'voice.filterAll'], ['named', 'voice.filterNamed'], ['unnamed', 'voice.filterUnnamed'],
        ];
        return h('section', { className: 'mvm-voicebook-panel', role: 'dialog', 'aria-label': t('voice.title') },
          h('div', { className: 'mvm-voicebook-panel-head' },
            h('span', { className: 'mvm-voicebook-panel-title' },
              h(Icon, { name: 'users', size: 14 }), h('span', null, t('voice.title'))),
            h('span', { className: 'mvm-voicebook-count' }, String(voiceProfiles.length)),
            h('button', {
              type: 'button', className: 'mvm-icon-button', title: t('action.close'), 'aria-label': t('action.close'),
              onClick: () => setVoicebookOpen(false),
            }, h(Icon, { name: 'close', size: 13 }))),
          voiceProfiles.length ? h('div', { className: 'mvm-voicebook-tools' },
            h('input', {
              type: 'search', className: 'mvm-input mvm-voicebook-search-input', value: voiceSearch,
              placeholder: t('voice.search'), 'aria-label': t('voice.search'),
              onChange: (event) => setVoiceSearch(event.target.value),
            }),
            h('div', { className: 'mvm-voicebook-filters', role: 'group', 'aria-label': t('voice.title') },
              filters.map(([value, label]) => h('button', {
                type: 'button', key: value,
                className: `mvm-voicebook-filter ${voiceFilter === value ? 'is-active' : ''}`,
                'aria-pressed': voiceFilter === value, onClick: () => setVoiceFilter(value),
              }, t(label))))) : null,
          voiceProfiles.length ? h('div', { className: 'mvm-voice-list mvm-voicebook-list' },
            visibleNamed.map((profile) => renderVoiceRow(profile)),
            visibleUnnamed.length ? h(React.Fragment, null,
              h('button', {
                type: 'button', className: 'mvm-voice-group-head mvm-voicebook-group',
                'aria-expanded': unnamedExpanded, onClick: () => setUnnamedOpen((value) => !value),
              },
                h('span', null, t('voice.unnamedGroup').replace('{count}', String(visibleUnnamed.length))),
                h(Icon, { name: 'caret', size: 12, className: unnamedExpanded ? 'is-open' : '' })),
              unnamedExpanded ? visibleUnnamed.map((profile) => renderVoiceRow(profile, true)) : null) : null,
            !visibleNamed.length && !visibleUnnamed.length
              ? h('div', { className: 'mvm-voicebook-empty' }, t('voice.noMatch')) : null) : null,
          voiceProfiles.length ? null : h('div', { className: 'mvm-voicebook-empty-state' },
            h(Icon, { name: 'users', size: 20 }),
            h('strong', null, t('voice.emptyTitle')),
            h('span', null, t('voice.hint'))),
          h('div', { className: 'mvm-voicebook-note' },
            h(Icon, { name: 'save', size: 12 }), h('span', null, t('voice.persistentHint'))),
          h('audio', { ref: voiceSampleRef, preload: 'none', className: 'mvm-live-audio' }));
      };

      /** The header entry that opens the voice book panel. */
      const renderVoicebookTrigger = () => h('div', { className: 'mvm-voicebook-trigger-wrap', ref: voicebookTriggerRef },
        h('button', {
          type: 'button', className: 'mvm-voicebook-trigger',
          'aria-label': t('voice.title'), 'aria-expanded': voicebookOpen, 'aria-haspopup': 'dialog',
          title: t('voice.title'), onClick: () => setVoicebookOpen((value) => !value),
        },
          h(Icon, { name: 'users', size: 15 }),
          h('span', { className: 'mvm-voicebook-trigger-count' }, String(voiceProfiles.length))),
        voicebookOpen ? renderVoicebookPanel() : null);

      const renderRailSuggestions = () => {
        const items = contextSuggestions();
        return h('div', { className: 'mvm-rail-suggestion-block' },
          h('div', { className: 'mvm-rail-label' }, t('history.suggestLabel')),
          items.map((item, index) => h('button', {
            type: 'button', key: item,
            className: `mvm-rail-suggestion ${index === 0 ? 'is-primary' : ''}`,
            disabled: historyBusy,
            onClick: () => onHistoryAsk(item),
          },
            h('span', { className: 'mvm-rail-suggestion-text' }, item),
            h('span', { className: 'mvm-rail-suggestion-arrow' },
              h(Icon, { name: 'arrow-right', size: 14 })))));
      };

      const renderRailMessages = () => h('div', { className: 'mvm-chat-messages', role: 'log', 'aria-live': 'polite' },
        historyMessages.length ? historyMessages.map((message, index) => h('div', {
          className: `mvm-chat-message is-${message.role}`, key: index,
        },
          h('div', { className: `mvm-chat-bubble ${message.failed ? 'is-failed' : ''}` }, message.text)))
          : h('div', { className: 'mvm-chat-empty' }, t('history.chatHint')));

      const renderRailComposer = () => h('div', { className: 'mvm-rail-composer' },
        h('form', {
          className: 'mvm-chat-input',
          onSubmit: (event) => { event.preventDefault(); void onHistoryAsk(); },
        },
          h('input', {
            className: 'mvm-input', value: historyQuestion,
            placeholder: t('history.chatPlaceholder'),
            onChange: (event) => setHistoryQuestion(event.target.value),
          }),
          h(Button, {
            icon: 'ask', primary: true, type: 'submit',
            disabled: historyBusy || !historyQuestion.trim(),
          }, historyBusy ? t('state.thinking') : t('history.send'))));

      const renderTemplatePicker = () => h('label', { className: 'mvm-template-picker' },
        h('span', { className: 'mvm-label' }, t('detail.template')),
        h('select', {
          className: 'mvm-input mvm-template-select', value: selectedTemplate,
          'aria-label': t('detail.template'),
          onChange: (event) => setSelectedTemplate(event.target.value),
        },
          templateList().map((template) => h('option', { value: template.id, key: template.id },
            template.name || template.id))));

      const renderAssistantDrawer = () => assistantOpen ? h(React.Fragment, null,
        h('div', {
          className: 'mvm-drawer-backdrop', role: 'presentation',
          onClick: (event) => { if (event.target === event.currentTarget) setAssistantOpen(false); },
        }),
        h('aside', {
          className: 'mvm-assistant-drawer', role: 'dialog', 'aria-modal': 'true',
          'aria-label': t('assistant.title'),
        },
          h('div', { className: 'mvm-rail-header' },
            h('span', {
              className: 'mvm-assistant-logo', role: 'img', 'aria-label': t('assistant.title'),
            }, h(Icon, { name: 'ask', size: 16 })),
            h('div', { className: 'mvm-rail-tools' },
              h(Button, {
                icon: 'refresh', title: t('history.newChat'), 'aria-label': t('history.newChat'),
                disabled: historyBusy, onClick: () => { setHistoryMessages([]); setHistorySources([]); },
              }),
              h('select', {
                className: 'mvm-rail-scope', value: historyScope,
                'aria-label': t('history.scopeAll'),
                onChange: (event) => setHistoryScope(event.target.value),
              },
                h('option', { value: 'all' }, t('history.scopeAll')),
                h('option', { value: 'current' }, t('history.scopeCurrent'))),
              h(Button, {
                icon: 'close', title: t('assistant.close'), 'aria-label': t('assistant.close'),
                onClick: () => setAssistantOpen(false),
              }))),
          h('div', { className: 'mvm-rail-scroll' },
            renderRailSuggestions(),
            renderRailMessages(),
            historySources.length ? h('div', { className: 'mvm-chat-sources' },
              historySources.map((source) => h('button', {
                type: 'button', key: source.id, className: 'mvm-chat-source',
                onClick: () => onOpen(source.id),
              }, source.title || t('meeting.untitled')))) : null),
          renderRailComposer())) : null;

      const renderDetail = () => h('main', { className: 'mvm-workspace mvm-detail-page' },
        h('div', { className: 'mvm-detail-reader' },
          renderDetailHeader(),
          renderAudioPlayer(),
          renderImportCard(),
          h('div', { className: 'mvm-detail-tabs', role: 'tablist' },
            [
              ['transcribe', 'detail.transcribe'],
              ['summary', 'detail.summary'],
              ['viewpoints', 'detail.viewpoints'],
              ['chapters', 'detail.chapter'],
            ].map(([value, label]) => h('button', {
              type: 'button', key: value, role: 'tab',
              className: `mvm-detail-tab ${detailTab === value ? 'is-active' : ''}`,
              'aria-selected': detailTab === value,
              onClick: () => setDetailTab(value),
            }, t(label))),
            detailTab === 'summary' ? h('span', { className: 'mvm-detail-tabs-spacer' }) : null,
            detailTab === 'summary' ? h('div', { className: 'mvm-summary-actions' },
              renderTemplatePicker(),
              h(Button, {
                icon: 'save', primary: true, onClick: onSummarize,
                disabled: isBusy !== '' || !transcript,
              }, minutes ? t('detail.regenerateMinutes') : t('detail.generateMinutes'))) : null),
          detailTab === 'transcribe' ? renderTranscribeTab()
            : detailTab === 'summary' ? renderSummaryTab()
              : detailTab === 'viewpoints' ? renderViewpointTab()
                : renderChapterTab()),
        assistantOpen ? renderAssistantDrawer() : null,
        renderShareDialog());

      const translationFallbackEnabled = settings?.translationFallbackEnabled !== false;
      const fallbackProvider = settings?.translationFallbackProvider || DEFAULT_TRANSLATION_FALLBACK_PROVIDER;
      const fallbackModel = settings?.translationFallbackModel || DEFAULT_TRANSLATION_FALLBACK_MODEL;
      const fallbackBaseUrl = settings?.translationFallbackBaseUrl || DEFAULT_TRANSLATION_FALLBACK_BASE_URL;

      return h('div', { className: 'mvm-page' },
        h('header', { className: 'mvm-header' },
          h('div', { className: 'mvm-heading' },
            h('h1', { className: 'mvm-title' }, t('app.title')),
            h('div', { className: 'mvm-subtitle' }, t('app.subtitle'))),
          h('div', { className: 'mvm-header-actions' },
            h('div', { className: 'mvm-view-switch', role: 'tablist', 'aria-label': t('view.switch') },
              h('button', {
                type: 'button', className: `mvm-view-tab ${view === 'minutes' ? 'is-active' : ''}`,
                role: 'tab', 'aria-selected': view === 'minutes', onClick: () => setView('minutes'),
              }, t('view.minutes')),
              h('button', {
                type: 'button', className: `mvm-view-tab ${view === 'live' ? 'is-active' : ''}`,
                role: 'tab', 'aria-selected': view === 'live', onClick: () => setView('live'),
              }, t('view.live'))),
            h('div', { className: 'mvm-health' },
              healthBadge('asr', t('status.asr')),
              healthBadge('llm', t('status.llm'))),
            view === 'minutes' ? renderMeetingActions() : null,
            h('button', {
              type: 'button', className: 'mvm-icon-button',
              title: t('assistant.open'), 'aria-label': t('assistant.open'),
              onClick: () => setAssistantOpen((value) => !value),
              'aria-expanded': assistantOpen,
            }, h(Icon, { name: 'ask', size: 16 })),
            h('button', {
              type: 'button', className: 'mvm-icon-button',
              title: t('action.settings'), 'aria-label': t('action.settings'),
              onClick: () => setSettingsOpen((value) => !value),
            }, h(Icon, { name: 'settings', size: 16 })))),

        settingsOpen ? h('div', {
          className: 'mvm-settings-backdrop', role: 'presentation',
          onClick: (event) => { if (event.target === event.currentTarget) setSettingsOpen(false); },
        },
          h('section', {
            className: 'mvm-settings mvm-settings-modal', role: 'dialog',
            'aria-modal': 'true', 'aria-label': t('settings.title'), tabIndex: -1,
            onClick: (event) => event.stopPropagation(),
          },
          h('div', { className: 'mvm-settings-head' },
            h('h2', { className: 'mvm-section-title' }, t('settings.title')),
            h('button', { type: 'button', className: 'mvm-icon-button', 'aria-label': t('action.close'), onClick: () => setSettingsOpen(false) }, h(Icon, { name: 'close' }))),
          h('div', { className: 'mvm-settings-layout' },
            h('nav', { className: 'mvm-settings-nav', role: 'tablist', 'aria-label': t('settings.title') },
              [
                ['asr', 'settings.section.asr'],
                ['llm', 'settings.section.llm'],
                ['translation', 'settings.section.translation'],
                ['overlay', 'settings.section.overlay'],
              ].map(([value, labelKey]) => h('button', {
                type: 'button', key: value, role: 'tab',
                className: `mvm-settings-tab ${settingsTab === value ? 'is-active' : ''}`,
                'aria-selected': settingsTab === value,
                onClick: () => setSettingsTab(value),
              }, t(labelKey)))),
            h('div', { className: 'mvm-settings-content' },
            settingsTab === 'asr' ? h('div', { className: 'mvm-settings-grid' },
            settingSelect('asrProvider', 'settings.asrProvider', [
              ['local', 'settings.provider.local'],
              ['siliconflow', 'settings.provider.siliconflow'],
            ]),
            settings?.asrProvider === 'siliconflow'
              ? settingField('siliconflowBaseUrl', 'settings.siliconflowBaseUrl')
              : settingField('asrBaseUrl', 'settings.asr'),
            settings?.asrProvider === 'siliconflow'
              ? settingField('siliconflowModel', 'settings.siliconflowModel')
              : settingField('asrModel', 'settings.asrModel'),
            settings?.asrProvider === 'siliconflow'
              ? settingField('siliconflowApiKey', 'settings.siliconflowApiKey', { type: 'password', placeholderKey: 'settings.apiKeyPlaceholder' })
              : null,
            settings?.asrProvider !== 'siliconflow'
              ? settingSelect('asrBackend', 'settings.asrBackend', [
                ['whispercpp', 'settings.backend.whispercpp'],
                ['sensevoice', 'settings.backend.sensevoice'],
                ['funasr', 'settings.backend.funasr'],
              ], 'whispercpp')
              : null,
            settings?.asrProvider !== 'siliconflow'
              ? h('div', { className: 'mvm-hint mvm-field-wide' }, t(`settings.backendHint.${settings?.asrBackend || 'whispercpp'}`))
              : null,
            settings?.asrProvider !== 'siliconflow'
              ? settingSelect('liveChunkSeconds', 'settings.liveChunkSeconds', [
                ['3', 'settings.chunk.3'],
                ['5', 'settings.chunk.5'],
                ['10', 'settings.chunk.10'],
              ], '3')
              : null,
            settings?.asrProvider !== 'siliconflow' ? h('div', { className: 'mvm-asr-admin' },
              h('div', { className: 'mvm-settings-section-title' }, t('settings.asr.serviceTitle')),
              h('div', { className: 'mvm-asr-status-line' },
                h('span', { className: `mvm-health-item ${asrStatus?.online ? 'is-online' : 'is-offline'}` },
                  h('span', { className: 'mvm-health-dot' }),
                  asrStatus ? `${asrStatus.health?.backend || 'ASR'} · ${asrStatus.catalog?.activeId || t('settings.asr.noModel')}` : t('status.unknown')),
                h(Button, { icon: 'refresh', onClick: refreshAsrStatus, disabled: asrBusy !== '' }, t('action.refresh')),
                h(Button, { icon: 'play', onClick: () => onAsrAction('asr-start'), disabled: asrBusy !== '' }, t('settings.asr.start')),
                h(Button, { icon: 'close', onClick: () => onAsrAction('asr-stop'), disabled: asrBusy !== '' }, t('settings.asr.stop')),
                h(Button, { icon: 'refresh', onClick: () => onAsrAction('asr-restart'), disabled: asrBusy !== '' }, t('settings.asr.restart'))),
              asrStatus?.catalog?.entries?.length ? h('div', { className: 'mvm-model-picker' },
                h('div', { className: 'mvm-model-list-head' },
                  h('span', { className: 'mvm-label' }, t('settings.asr.modelList')),
                  h('span', { className: 'mvm-hint' }, `${t('settings.asr.activeModel')}: ${asrStatus.catalog.activeId || '—'}`)),
                h('button', {
                  type: 'button', className: 'mvm-model-trigger', 'aria-expanded': asrModelOpen,
                  'aria-haspopup': 'listbox',
                  onClick: () => setAsrModelOpen((value) => !value),
                },
                  h('span', { className: 'mvm-model-trigger-text' }, asrModelEntry
                    ? `${asrModelEntry.label || asrModelEntry.id} · ${asrModelEntry.actualSize ? formatBytes(asrModelEntry.actualSize) : asrModelEntry.sizeLabel} · ${asrModelEntry.active ? t('settings.asr.inUse') : asrModelEntry.downloaded ? t('settings.asr.downloaded') : t('settings.asr.notDownloaded')}`
                    : t('settings.asr.defaultModel')),
                  h('span', { className: 'mvm-model-caret' },
                    h(Icon, { name: 'caret', size: 14 }))),
                asrModelOpen ? h('div', { className: 'mvm-model-menu', role: 'listbox' },
                  asrStatus.catalog.entries.map((entry) => h('div', {
                    className: `mvm-model-option ${entry.active ? 'is-active' : ''}`, key: entry.id, role: 'option',
                    'aria-selected': entry.active,
                  },
                    h('button', {
                      type: 'button', className: 'mvm-model-option-main',
                      onClick: () => onAsrModelChoice(entry.id),
                    },
                      h('span', { className: 'mvm-model-option-name' }, entry.label || entry.id),
                      h('span', { className: 'mvm-model-option-size' }, entry.actualSize ? formatBytes(entry.actualSize) : entry.sizeLabel),
                      h('span', {
                        className: `mvm-model-badge ${entry.active ? 'is-active' : entry.downloaded ? 'is-ready' : 'is-missing'}`,
                      }, entry.active ? t('settings.asr.inUse') : entry.downloaded ? t('settings.asr.downloaded') : t('settings.asr.notDownloaded'))),
                    h('span', { className: 'mvm-model-option-actions' },
                      !entry.downloaded
                        ? h(Button, {
                          icon: 'save', title: t('settings.asr.downloadModel'),
                          onClick: () => onAsrAction('asr-download-model', { id: entry.id }), disabled: asrBusy !== '',
                        }, t('settings.asr.downloadModel'))
                        : entry.active || entry.selectable === false ? null : h(Button, {
                          icon: 'play', title: t('settings.asr.useModel'),
                          onClick: () => onAsrModelSelect(entry.id), disabled: asrBusy !== '',
                        }, t('settings.asr.useModel')),
                      entry.downloaded && !entry.active ? h(Button, {
                        icon: 'trash', danger: true, title: t('action.delete'),
                        onClick: () => onAsrAction('asr-delete-model', { id: entry.id }), disabled: asrBusy !== '',
                      }, t('action.delete')) : null)))) : null) : null,
              h('label', { className: 'mvm-bilingual-toggle' },
                h('input', { type: 'checkbox', checked: Boolean(settings?.asrAutoStart), onChange: (event) => onAsrAutoStartToggle(event.target.checked) }),
                t('settings.asr.autoStart')),
              asrStatus ? h('div', { className: 'mvm-path-row' },
                h('span', { className: 'mvm-hint' }, `${t('settings.asr.modelDir')}: ${asrStatus.modelDir}`),
                h(Button, {
                  icon: 'folder', title: t('settings.asr.openModelDir'),
                  onClick: () => onOpenPath(asrStatus.modelDir), disabled: asrBusy !== '',
                }, t('settings.asr.openModelDir'))) : null,
              asrStatus ? h('div', { className: 'mvm-path-row' },
                h('span', { className: 'mvm-hint' }, `${t('settings.asr.launcher')}: ${asrStatus.launcher}`),
                h(Button, {
                  icon: 'folder', title: t('settings.asr.openLauncher'),
                  onClick: () => onOpenPath(asrStatus.launcher), disabled: asrBusy !== '',
                }, t('settings.asr.openLauncher'))) : null) : null,

            settings?.asrProvider === 'siliconflow'
              ? h('div', { className: 'mvm-hint mvm-field-wide' }, t('settings.cloudNotice'))
              : null) : null,

            settingsTab === 'llm' ? h('div', { className: 'mvm-settings-grid' },
            settingSelect('llmProvider', 'settings.llmProvider', [
              ['minimax', 'settings.provider.minimax'],
              ['lmstudio', 'settings.provider.lmstudio'],
              ['siliconflow', 'settings.provider.siliconflow'],
            ], 'lmstudio'),
            settingField('llmBaseUrl', 'settings.llm'),
            settingField('llmModel', 'settings.model'),
            settingField('llmTemperature', 'settings.temperature', { type: 'number', min: 0, step: 0.05, number: true }),
            settingField('llmMaxTokens', 'settings.maxTokens', { type: 'number', min: 0, number: true }),
            settingSelect('llmReasoningEffort', 'settings.reasoningEffort', [
              ['', 'settings.reasoning.default'],
              ['none', 'settings.reasoning.none'],
              ['low', 'settings.reasoning.low'],
              ['medium', 'settings.reasoning.medium'],
              ['high', 'settings.reasoning.high'],
            ], ''),
            settings?.llmProvider !== 'lmstudio'
              ? settingField('apiKey', 'settings.llmApiKey', { type: 'password', placeholderKey: 'settings.apiKeyPlaceholder' })
              : null,
            h('div', { className: 'mvm-settings-section-title' }, t('settings.llmFallbackSection')),
            settingToggle('llmFallbackEnabled', 'settings.llmFallback', {
              defaultValue: false, hintKey: 'settings.llmFallbackHint',
            }),
            settings?.llmFallbackEnabled ? h(React.Fragment, null,
              settingSelect('llmFallbackProvider', 'settings.llmFallbackProvider', [
                ['lmstudio', 'settings.provider.lmstudio'],
                ['minimax', 'settings.provider.minimax'],
              ], 'lmstudio'),
              settingField('llmFallbackModel', 'settings.llmFallbackModel'),
              settingField('llmFallbackBaseUrl', 'settings.llmFallbackBaseUrl'),
              settingField('llmFallbackPath', 'settings.llmFallbackPath')) : null) : null,

            settingsTab === 'translation' ? h('div', { className: 'mvm-settings-grid' },
            settingSelect('translationProvider', 'settings.translationProvider', [
              ['minimax', 'settings.provider.minimaxDefault'],
              ['lmstudio', 'settings.provider.lmstudio'],
              ['siliconflow', 'settings.provider.siliconflow'],
            ], 'lmstudio'),
            settingField('translationBaseUrl', 'settings.translationBaseUrl'),
            settingField('translationModel', 'settings.translationModel'),
            h('div', { className: 'mvm-settings-row' },
              h(Button, { icon: 'refresh', onClick: onLoadModels, disabled: isBusy || !settings }, t('settings.loadModels')),
              h(Button, { icon: 'ask', onClick: onCompareModels, disabled: compareBusy || !settings }, compareBusy ? t('state.thinking') : t('settings.compareModels')),
              availableModels.length ? h('select', {
                className: 'mvm-input', value: settings?.translationModel || '',
                'aria-label': t('settings.availableModels'),
                onChange: (event) => updateSetting('translationModel', event.target.value),
              },
                h('option', { value: '' }, t('settings.availableModels')),
                availableModels.map((model) => h('option', { value: model, key: model }, model))) : null,
              availableModels.length && settings?.translationModel && !availableModels.includes(settings.translationModel)
                ? h('span', { className: 'mvm-hint' }, t('settings.modelNotListed'))
                : null),
            settingField('translationTemperature', 'settings.temperature', { type: 'number', min: 0, step: 0.05, number: true }),
            settingField('translationMaxTokens', 'settings.maxTokens', { type: 'number', min: 0, number: true }),
            settingArea('translationGlossary', 'settings.glossary', { wide: true, rows: 3, placeholderKey: 'settings.glossaryPlaceholder' }),
            h('div', { className: 'mvm-hint mvm-field-wide' }, t('settings.glossaryHint')),
            settingSelect('translationPromptMode', 'settings.promptMode', [
              ['auto', 'settings.promptModeAuto'],
              ['generic', 'settings.promptModeGeneric'],
              ['hymt', 'settings.promptModeHyMt'],
            ], 'auto'),
            settingSelect('translationReasoningEffort', 'settings.reasoningEffort', [
              ['', 'settings.reasoning.default'],
              ['none', 'settings.reasoning.none'],
              ['low', 'settings.reasoning.low'],
              ['medium', 'settings.reasoning.medium'],
              ['high', 'settings.reasoning.high'],
            ], 'none'),
            h('div', { className: 'mvm-settings-section-title' }, t('settings.translationFallbackSection')),
            settingToggle('translationFallbackEnabled', 'settings.translationFallback', {
              defaultValue: true, hintKey: 'settings.translationFallbackHint',
            }),
            translationFallbackEnabled ? h(React.Fragment, null,
              settingSelect('translationFallbackProvider', 'settings.translationFallbackProvider', [
                ['minimax', 'settings.provider.minimax'],
                ['lmstudio', 'settings.provider.lmstudio'],
              ], 'minimax'),
              h('label', { className: 'mvm-field' },
                h('span', { className: 'mvm-label' }, t('settings.translationFallbackModel')),
                h('input', {
                  className: 'mvm-input', value: fallbackModel,
                  'aria-label': t('settings.translationFallbackModel'),
                  onChange: (event) => updateSetting('translationFallbackModel', event.target.value),
                })),
              h('label', { className: 'mvm-field' },
                h('span', { className: 'mvm-label' }, t('settings.translationFallbackBaseUrl')),
                h('input', {
                  className: 'mvm-input', value: fallbackBaseUrl,
                  'aria-label': t('settings.translationFallbackBaseUrl'),
                  onChange: (event) => updateSetting('translationFallbackBaseUrl', event.target.value),
                }))) : null,
            settings?.translationProvider !== 'lmstudio'
              ? settingField('translationApiKey', 'settings.translationApiKey', { type: 'password', placeholderKey: 'settings.apiKeyPlaceholder' })
              : null) : null,

            settingsTab === 'overlay' ? h('div', { className: 'mvm-settings-grid' },
            settingField('overlayBackground', 'settings.overlayBackground', { type: 'color' }),
            settingField('overlayText', 'settings.overlayText', { type: 'color' }),
            settingField('overlayOpacity', 'settings.overlayOpacity', { type: 'number', min: 0.2, max: 1, step: 0.05, number: true }),
            settingToggle('overlayCompact', 'settings.overlayCompact', { defaultValue: true }),
            h('div', { className: 'mvm-hint mvm-field-wide' }, t('settings.overlayHint'))) : null)),
          // The page level alerts sit behind the modal backdrop, so the modal
          // carries its own copy; otherwise a failed action looks like nothing happened.
          error ? h('div', { className: 'mvm-alert mvm-alert-error mvm-settings-alert', role: 'alert' },
            h('span', null, error),
            h('button', { type: 'button', className: 'mvm-icon-button', 'aria-label': t('action.close'), onClick: () => setError('') }, h(Icon, { name: 'close', size: 14 }))) : null,
          notice ? h('div', { className: 'mvm-alert mvm-alert-notice mvm-settings-alert', role: 'status' }, h('span', null, notice)) : null,
          h('div', { className: 'mvm-settings-actions' },
            h(Button, { icon: 'save', primary: true, onClick: () => onSettingsSave(), disabled: isBusy || !settings }, busy === 'settings' ? t('state.saving') : t('settings.save'))))) : null,

        error ? h('div', { className: 'mvm-alert mvm-alert-error', role: 'alert' },
          h('span', null, error),
          h('button', { type: 'button', className: 'mvm-icon-button', 'aria-label': t('action.close'), onClick: () => setError('') }, h(Icon, { name: 'close', size: 14 }))) : null,
        notice ? h('div', { className: 'mvm-alert mvm-alert-notice', role: 'status' }, h('span', null, notice)) : null,

        view === 'live' ? renderLive() : showImport ? renderDetail() : renderLibraryTable()
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        const register = (build, label) => ctx.effect(() => {
          try { return build(); } catch (error) {
            console.warn(`[ai-voice-minutes] ${label} failed: ${String(error)}`);
            return () => {};
          }
        }, label);

        register(() => ctx.locale.register(NS, DICT), 'locale');
        register(() => installStyles(), 'styles');
        register(() => watchHostTheme(), 'overlay theme');
        register(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 23, label: () => t('nav.label'), locale: NS,
        }, PanelIcon)), 'sidebar');
        register(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
        }, (props) => h(MinutesPage, { t, ...props }))), 'main');
        register(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities', id: 'ai-voice-minutes-quick-live', locale: NS, order: 6,
        }, (props) => h(QuickLiveButton, { t, ...props }))), 'conversation header');
        register(() => ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
          name: 'sidebar.right.tab.document.actions', id: 'ai-voice-minutes-quick-live', locale: NS, order: -19,
        }, (props) => h(QuickLiveButton, { t, ...props }))), 'document header');
      },
    };
  },
});
