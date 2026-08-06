"use strict";

/* =========================================================================
 * 项目工作台模块（复刻 project-workbench-v014 基础版）
 * - 独立数据键 trace:workbench:v1，与留痕主数据 trace:v1 互不影响
 * - 所有渲染走 innerHTML + 全局 WB 事件入口，遵循“输入即存”
 * ========================================================================= */
(function () {
  const WB_KEY = "trace:workbench:v1";
  const DAY_MS = 86400000;

  const wb$ = (s) => document.querySelector(s);
  const wb$$ = (s) => Array.from(document.querySelectorAll(s));

  function wbEsc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function wbUid(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function addDaysStr(s, n) {
    const d = new Date(s + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function inRange(iso, range) {
    if (!iso) return false;
    const d = String(iso).slice(0, 10);
    return d >= range.start && d <= range.end;
  }
  function fmtHM(iso) {
    if (!iso) return "--:--";
    return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  function fmtMDHM(iso) {
    if (!iso) return "未明确";
    return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function toast(text, warn) {
    if (typeof toast === "function") { window.toast(text, warn); return; }
    alert(text);
  }

  /* ================= 数据模型（与目标站点一致） ================= */
  const DEFAULT_PROJECT = {
    id: "project-personal",
    name: "个人待办",
    type: "系统默认",
    status: "进行中",
    stage: "日常收集",
    description: "用于承接个人事项、通知、培训和项目不明确的任务。",
    startDate: "",
    endDate: "",
    phases: [],
    progress: 0,
    materialCount: 0,
    isDefault: true,
    createdAt: "2026-07-01T09:00:00.000Z",
    localFolderName: "",
    records: []
  };

  const DEFAULT_STATE = {
    defaultAi: "DeepSeek",
    aiConfigured: false,
    onboarding: { status: "not_started", step: 1 },
    projects: [DEFAULT_PROJECT],
    tasks: [],
    inbox: [],
    reports: [],
    dismissedTips: {},
    todoOrder: []
  };

  const VIEW_META = {
    home: ["项目工作台", "先看今天要处理什么，再看项目哪里需要关注。"],
    intake: ["任务录入", "把 AI 整理结果粘贴进来，或直接手写一句话 / 几行待办。"],
    tasks: ["任务清单", "筛选、整理和批量处理任务，复杂信息放到任务详情里。"],
    projects: ["项目管理", "项目是任务、进展和排期的归属容器。"],
    reports: ["日报 / 周报", "根据任务、进展、附件和近期待办生成可复制汇报。"],
    settings: ["设置", "管理 AI 助手、数据、基础说明和支持作者。"]
  };

  const GUIDE_TIPS = {
    home: "这里汇总今日待办、今日汇报草稿和任务动态。完成任务后，汇报草稿会自动更新。",
    intake: "将右侧 AI 拆解好的任务内容粘贴到这里，也可以手动输入要跟进的事项。",
    tasks: "这里集中查看所有任务，可以修改状态、补充截止时间和批量处理。",
    projects: "这里用于管理项目、项目阶段和项目排期。任务录入后不强制建项目，可后续归类。",
    reports: "这里根据完成、待开始和进行中的任务，整理可复制的汇报内容。",
    settings: "这里用于查看基础配置、本地数据说明和支持作者。当前数据主要保存在当前浏览器中。"
  };

  const AI_URLS = {
    DeepSeek: "https://chat.deepseek.com",
    ChatGPT: "https://chatgpt.com",
    Kimi: "https://kimi.moonshot.cn",
    豆包: "https://www.doubao.com",
    通义千问: "https://tongyi.aliyun.com/qianwen/"
  };

  const INITIAL_INSTRUCTION = `【V5 初始指令开始】

我正在使用一个「项目工作台」管理工作事项。

从现在开始，请你作为我的「工作信息整理助理」，专门帮我处理我发来的微信消息、微信截图、群聊截图、邮件截图、会议纪要、领导指令、客户反馈、文件消息、通知公告、项目工作台截图、项目背景信息、人物关系信息和零散工作内容。

你的目标不是简单总结，而是帮我把原始信息整理成可以导入项目工作台的任务、进展或记录。

当前日期是：{{CURRENT_DATE}}。

系统默认项目是：「个人待办」。
「待归类」不是项目名，只是一种临时归类状态。

请记住：后续我会持续在这个对话里发送截图或文字，你都按下面规则处理。

【一、核心原则】

1. 你要优先帮我发现"后续需要处理的事情"，而不是只做内容总结。

2. 只要内容里可能包含以下任意一种情况，都要先整理出来：
- 需要我处理
- 需要我确认
- 需要我回复
- 需要我跟进
- 需要我查看
- 需要我下载
- 需要我转发
- 需要我保存
- 需要我参加
- 需要我提醒
- 需要我复查
- 需要我提交
- 需要我沟通
- 需要我记录

3. 不要因为内容不像正式项目任务就忽略。

4. 纯闲聊、表情、无后续价值、无记录价值的信息，才可以判断为无需处理。

5. 不要轻易输出"无任务"。

6. 不要编造项目名、负责人、截止时间、人物关系。

7. 不要把「待归类」当成项目名。

8. 不要推断人物身份。除非我提供过人物关系，或原文明确说明身份，否则任何人名、昵称、英文缩写、微信名都只能作为「相关人 / 提出人」记录，不得写成客户、领导、供应商、顾问或负责人。

9. 如果信息不明确，请保守处理：
- 项目不明确：所属项目写「个人待办」，归类状态写「待归类」
- 负责人不明确：写「未明确」
- 截止时间不明确：写「未明确」
- 人物关系不明确：备注里写【人物关系待确认】

【二、先判断内容类型】

每次我发送内容后，你先判断它属于哪一类，但不要输出完整分析过程，直接按对应格式输出结果。

1. 项目列表 / 项目管理页

如果我发送的是项目管理页截图、项目列表截图、项目清单，或明确说"这是我的项目列表"，你只需要识别并记住项目名称。

这类内容不要整理成任务。

输出格式：

已更新项目列表：
1. 项目名称
2. 项目名称
3. 项目名称

2. 项目背景 / 人物关系 / 项目说明

如果我发送的是项目背景、项目说明、人员关系、通讯录、项目角色说明，或明确说"这是项目背景""这是人物关系""这是这个项目的情况"，你只需要识别并记住这些信息。

这类内容不要整理成任务。

输出格式：

已更新项目背景：

项目名称：
项目阶段：
我的角色：

关键人物：
1. 姓名/称呼｜角色｜备注
2. 姓名/称呼｜角色｜备注
3. 姓名/称呼｜角色｜备注

后续整理任务时，请结合这些背景判断：
- 哪些事项来自客户、领导、顾问、供应商、同事或外部联系人
- 哪些人只是消息发送人
- 哪些人才可能是真正负责人
- 哪些事项应该归属到对应项目
- 哪些内容优先级更高

注意：
不要因为某个人发了消息，就默认他是负责人。
如果只是某个人、某个微信昵称或联系人提出要求，但身份不明确，请不要推断成客户、领导、顾问或供应商。
不确定身份时，请在备注里保留「相关人：xxx」或「提出人：xxx」，并加【人物关系待确认】。
例如 KT、Tom、王工或某微信昵称，只能写「相关人：KT」或「提出人：KT」。
不要写「客户提出」「领导要求」「供应商反馈」「顾问意见」，除非我已经提供过人物关系或原文明确说明身份。

不要在输出里使用示例人物名称、示例项目名称或虚构客户信息，必须根据我实际提供的信息判断。

3. 任务清单页

如果我发送的是任务清单截图，请识别当前已有任务、所属项目、状态、截止时间，作为后续判断重复任务和任务进展的参考。

这类内容不要重复生成已有任务。

输出格式：

已更新任务清单参考：
1. 任务名称｜所属项目｜状态｜截止时间
2. 任务名称｜所属项目｜状态｜截止时间
3. 任务名称｜所属项目｜状态｜截止时间

4. 任务详情页

如果我发送的是任务详情截图，请把它理解为当前正在处理的任务上下文。

后续我如果说"这是进展 / 补充进展 / 更新这条任务 / 这是这条任务的跟进截图"，请优先关联到这个任务。

不要把任务详情截图本身重复整理成新任务。

输出格式：

已更新当前任务上下文：

任务名称：
所属项目：
当前状态：
截止时间：
备注：

5. 首页 / 工作台总览

如果我发送的是首页或工作台总览截图，请把它作为当前工作状态参考。

不要直接生成任务，除非我明确说"整理这张图里的任务"。

6. 微信 / 邮件 / 会议 / 文件 / 普通文字

如果我直接发送微信截图、聊天记录、邮件截图、会议内容、文件消息或普通文字，请默认按「新任务整理」处理。

7. 任务进展

只有当我明确说以下意思时，你才按「任务进展」处理：

- 这是某条任务的后续进展
- 更新这条任务
- 补充进展
- 追加进展记录
- 这是这个任务的跟进截图
- 这是这条任务的后续沟通

如果我没有明确说这是进展，请默认按「新任务整理」处理。

【三、项目归类规则】

1. 你刚开始不一定知道我有哪些项目。

2. 如果我后续发送项目列表截图或项目清单，请你记住这些项目，作为后续任务归类依据。

3. 整理任务时，优先从你已知的项目列表里选择所属项目。

4. 如果内容明显属于某个已知项目，请填写对应项目名。

5. 如果是个人提醒、培训、通知、零散待办，请填写「个人待办」。

6. 如果暂时判断不出属于哪个项目，也填写「个人待办」，归类状态写「待归类」。

7. 不要把「待归类」写成项目名。

8. 不要自己编造新的项目名称。

9. 如果你认为某些事项可能需要新建项目，请不要直接写成所属项目，而是在备注里写：
【建议新建项目：XXX】

【四、负责人判断规则】

1. 不要把消息发送人、文件发送人、聊天对象、群里出现的人名默认当负责人。

2. 只有明确出现以下表达，才填写具体负责人：
- 某人负责
- 某人跟进
- 某人处理
- 由某人来做
- 某人安排
- 某人确认
- 某人提交
- 某人回复

3. 如果对方明确对我说：
你处理一下、你跟进、你确认、你联系、你安排、你发一下、你看一下、你回复一下

负责人可以写「我」。

4. 如果我回复了：
我来处理、我跟进、我去说、我来安排、收到我处理、我来确认、我来回复

负责人可以写「我」。

5. 如果某个人只是提出要求，不要写成负责人。
只有已经明确知道对方身份时，才可以写【客户提出】、【领导关注】、【顾问意见】或【供应商反馈】。
如果身份不明确，只写「相关人：xxx」或「提出人：xxx」，不要默认判断为客户、领导、顾问或供应商。

6. 如果人物关系不清楚，负责人写「未明确」，备注里加【人物关系待确认】。

【五、新任务输出格式】

如果是新任务，请不要输出 Markdown 表格，不要使用代码块，不要写解释。

请只输出「任务卡片纯文本格式」，方便我在侧边 AI 窗口阅读和复制，也方便项目工作台解析。

每条任务固定使用下面格式：

【任务1】
任务名称：
所属项目：
归类状态：
负责人：
截止时间：
优先级：
来源：
备注：

【任务2】
任务名称：
所属项目：
归类状态：
负责人：
截止时间：
优先级：
来源：
备注：

如果只有 1 条任务，就只输出【任务1】。

不要增加字段。
不要减少字段。
不要改变字段名称。
不要把多个字段写在同一行。
每个字段都必须有内容；无法判断就写「未明确」。

字段要求：

1. 任务名称

用"我要做什么"的方式写，尽量用动词开头，例如：

跟进、确认、提醒、下载、查看、整理、复查、提交、联系、沟通、补充、发送、更新、记录。

不要写成长背景描述。
不要只复制聊天原话。
尽量控制在 12-28 个字。
一条任务只表达一个主要动作。
如果截图里有多个独立事项，请拆成多条任务。

2. 所属项目

优先从你已知的项目列表里选择。

如果无法判断项目，填写「个人待办」。

不要把「待归类」写成项目名。

3. 归类状态

只能填写：
已归类 / 待归类

如果能明确归到某个项目，写「已归类」。
如果归到「个人待办」但实际项目不明确，写「待归类」。
如果本身就是个人提醒、培训、通知、零散待办，所属项目写「个人待办」，归类状态写「已归类」。

4. 负责人

按【负责人判断规则】处理。

不明确时写「未明确」。

5. 截止时间

如果有明确时间，请提取出来。

如果是：
今天、明天、后天、下周一、本周五、会前、月底前

这类相对时间，请结合当前日期尽量换算成日期，并保留原话。

例如：
明天（{{TOMORROW_DATE}}）

如果无法换算日期，就保留原话。
如果无法判断，写「未明确」。

6. 优先级

符合以下情况写「高」：
紧急、马上、今天、明天、逾期、领导要求、客户卡点、会前必须完成、客户/领导明确追问。

普通跟进、近期处理，写「中」。

仅记录、低影响、暂不急，写「低」。

7. 来源

来源字段必须客观，不要因为某个人发了消息，就把来源写成客户反馈或领导指令。

如果是微信截图但无法判断是群聊还是私聊，写「微信截图」。

明确是微信群，写「微信群」。

明确是一对一微信聊天，写「微信私聊」。

邮件截图写「邮件截图」。

会议内容写「会议纪要」。

只有明确知道是领导安排，才写「领导指令」。

只有明确知道是客户反馈，才写「客户反馈」。

文件消息写「文件消息」。

通知公告写「通知公告」。

项目工作台截图写「工作台截图」。

不确定身份时，来源优先写：微信截图 / 微信私聊 / 微信群 / 文件消息 / 邮件截图 / 会议纪要 / 通知公告 / 工作台截图。
不要在不确定时默认写「群聊」，也不要默认写客户反馈或领导指令。

8. 备注

保留关键背景，不要太长。

如果项目不明确，备注开头加【待归类】。

如果有文件名、会议名、客户名、材料名、截图重点、提出人，请保留。

如果信息需要我再确认，备注里加【进行中】。

如果你认为需要新建项目，备注里加【建议新建项目：XXX】。

如果人物关系不明确，备注里加【人物关系待确认】，并用「相关人：xxx」或「提出人：xxx」保留原始称呼。

不确定身份时，备注不要出现【客户提出】、【领导要求】、【供应商反馈】、【顾问意见】。

不要编造没有出现的信息。

【六、任务进展输出格式】

只有当我明确说这是某条任务的后续、更新或进展时，才按下面格式输出。

不要拆成一堆新任务，除非沟通里真的出现了新的独立待办。

输出格式：

进展记录：
日期｜来源

关联任务：
写能判断出的任务名称；无法判断写「未明确」

进展摘要：
1.
2.
3.

当前状态：
进行中 / 已完成 / 不更新状态

是否需要更新任务字段：
负责人 / 截止时间 / 优先级 / 状态 / 备注 / 无

是否产生新任务：
是 / 否

要求：

1. 进展摘要最多 3 条。
2. 每条尽量不超过 30 个字。
3. 适合直接保存到任务进展记录里。
4. 不要写太多分析。
5. 不要复述太多聊天原文。
6. 如果产生了新的独立待办，请在"是否产生新任务"里写"是"，并在下面额外输出新任务卡片。
7. 如果只是确认收到、已沟通、已回复，也可以作为进展记录，不要强行生成新任务。

【七、无需处理输出格式】

只有在内容确实属于纯闲聊、表情、无后续价值、无记录价值时，才输出：

无需处理：这段内容没有可执行事项或需要记录的信息。

不要轻易使用"无需处理"。

【八、输出总要求】

1. 默认只输出结果，不要写大段解释。

2. 新任务只输出任务卡片纯文本格式，不要输出 Markdown 表格。

3. 进展记录只输出进展格式。

4. 项目列表截图只输出"已更新项目列表"。

5. 项目背景 / 人物关系只输出"已更新项目背景"。

6. 任务清单截图只输出"已更新任务清单参考"。

7. 任务详情截图只输出"已更新当前任务上下文"。

8. 不要使用代码块包裹结果。

9. 不要编造负责人、截止时间、项目名、人物关系。

10. 不要把「待归类」当成项目名。

11. 不要在输出里使用任何示例人物、示例项目或虚构客户信息。

12. 后面我会持续发送原始内容，你都按以上规则处理。

【V5 初始指令结束】`;

  /* ================= 状态归一化 / 存取 ================= */
  function normalizeProject(p) {
    return Object.assign({
      type: "项目",
      status: "进行中",
      stage: "日常收集",
      description: "",
      startDate: "",
      endDate: "",
      phases: [],
      progress: 0,
      materialCount: 0,
      localFolderName: "",
      records: []
    }, p, {
      id: p.id || wbUid("project"),
      endDate: p.endDate || p.dueDate || "",
      createdAt: p.createdAt || new Date().toISOString(),
      isDefault: p.name === "个人待办" || !!p.isDefault,
      records: (p.records || []).map(normalizeProjectRecord)
    });
  }

  function normalizeProjectRecord(r) {
    return {
      id: r.id || wbUid("project-record"),
      content: r.content || "",
      attachments: (r.attachments || []).map(normalizeAttachment),
      createdAt: r.createdAt || new Date().toISOString()
    };
  }

  function normalizeProgress(r) {
    return {
      id: r.id || wbUid("progress"),
      content: r.content || "",
      source: r.source || "手动记录",
      statusChange: r.statusChange,
      attachments: (r.attachments || []).map(normalizeAttachment),
      createdAt: r.createdAt || new Date().toISOString()
    };
  }

  function normalizeAttachment(a) {
    return Object.assign({
      id: a.id || wbUid("attachment"),
      name: a.name || "附件",
      type: a.type || "application/octet-stream",
      size: a.size || 0,
      status: a.status || (a.url ? "已记录" : "未归档，请重新授权文件夹"),
      folderName: a.folderName,
      uploadedAt: a.uploadedAt || a.createdAt || new Date().toISOString()
    }, a);
  }

  function normalizeInbox(n) {
    return {
      id: n.id || wbUid("inbox"),
      title: n.title || "记事本",
      preview: n.preview || "",
      time: n.time || "刚刚",
      attachments: (n.attachments || []).map(normalizeAttachment),
      createdAt: n.createdAt || new Date().toISOString()
    };
  }

  function normalizeReport(r) {
    return Object.assign({ type: "daily", createdAt: new Date().toISOString() }, r);
  }

  function normalizeTask(t, projects) {
    const proj = projects.find((p) => p.id === t.projectId || p.name === t.projectName);
    const projectName = (proj && proj.name) || t.projectName || "个人待办";
    const projectId = (proj && proj.id) || (projectName === "个人待办" ? "project-personal" : t.projectId);
    return Object.assign({}, t, {
      projectId,
      projectName,
      classificationStatus: t.classificationStatus || (projectName === "个人待办" ? "待归类" : "已归类"),
      owner: t.owner || "未明确",
      dueText: t.dueText || "未明确",
      status: ["待开始", "已完成", "已逾期"].includes(t.status) ? t.status : "待开始",
      priority: ["高", "低"].includes(t.priority) ? t.priority : "中",
      source: t.source || "手动录入",
      progressRecords: (t.progressRecords || []).map(normalizeProgress),
      attachments: (t.attachments || []).map(normalizeAttachment),
      completedAt: t.completedAt || t.doneAt,
      createdAt: t.createdAt || new Date().toISOString()
    });
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return JSON.parse(JSON.stringify(DEFAULT_STATE));
    const projects = raw.projects && raw.projects.length
      ? raw.projects.map(normalizeProject)
      : [DEFAULT_PROJECT];
    if (!projects.some((p) => p.id === "project-personal" || p.name === "个人待办")) {
      projects.unshift(JSON.parse(JSON.stringify(DEFAULT_PROJECT)));
    }
    return {
      defaultAi: raw.defaultAi || "DeepSeek",
      aiConfigured: !!raw.aiConfigured,
      onboarding: {
        status: ["in_progress", "skipped", "completed"].includes(raw.onboarding && raw.onboarding.status)
          ? raw.onboarding.status : "not_started",
        step: (raw.onboarding && (raw.onboarding.step === 2 || raw.onboarding.step === 3)) ? raw.onboarding.step : 1
      },
      projects,
      tasks: (raw.tasks || []).map((t) => normalizeTask(t, projects)),
      inbox: (raw.inbox || []).map(normalizeInbox),
      reports: (raw.reports || []).map(normalizeReport),
      dismissedTips: raw.dismissedTips || {},
      todoOrder: raw.todoOrder || []
    };
  }

  function save() {
    try {
      localStorage.setItem(WB_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      toast("保存失败，数据未落盘，请检查浏览器存储空间", true);
      return false;
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(WB_KEY);
      if (!raw) {
        state = normalize(null);
        return;
      }
      const parsed = JSON.parse(raw);
      state = normalize(parsed);
      /* 兼容早期版本：任务归属默认项目 */
      state.tasks.forEach((t) => {
        if (!state.projects.some((p) => p.id === t.projectId)) {
          t.projectId = "project-personal";
          t.projectName = "个人待办";
        }
      });
    } catch (err) {
      try {
        const raw = localStorage.getItem(WB_KEY);
        if (raw) localStorage.setItem(WB_KEY + ".corrupt-" + Date.now(), raw);
      } catch (e2) {}
      toast("工作台数据读取失败，已隔离损坏数据并使用空白状态", true);
      state = normalize(null);
    }
  }

  /* ================= 核心规则函数（忠实复刻） ================= */
  function effectiveStatus(t) {
    if (t.status === "已完成") return "已完成";
    if (t.status === "已逾期") return "已逾期";
    const m = String(t.dueText || "").match(/\d{4}-\d{2}-\d{2}/);
    if (m && m[0] < todayStr()) return "已逾期";
    return t.status || "待开始";
  }

  function isTodayDue(t) {
    return /今天|今日/.test(t.dueText || "") || String(t.dueText || "").includes(todayStr());
  }

  function homeGroups(tasks, todoOrder) {
    const open = tasks.filter((t) => t.status !== "已完成");
    const orderMap = new Map(todoOrder.map((id, i) => [id, i]));
    const sortFn = (a, b) => (orderMap.get(a.id) ?? 9999) - (orderMap.get(b.id) ?? 9999);
    const sorted = (arr) => [...arr].sort(sortFn);
    return {
      overdue: sorted(open.filter((t) => effectiveStatus(t) === "已逾期")),
      today: sorted(open.filter((t) => effectiveStatus(t) !== "已逾期" && !/明天|本周|周五|近/.test(t.dueText || ""))),
      soon: sorted(open.filter((t) => /明天|本周|周五|近/.test(t.dueText || "") && effectiveStatus(t) !== "已逾期")),
      confirm: []
    };
  }

  function projectStats(project, tasks) {
    const list = tasks.filter((t) => t.projectId === project.id || t.projectName === project.name);
    const done = list.filter((t) => t.status === "已完成").length;
    return {
      open: list.filter((t) => t.status !== "已完成").length,
      overdue: list.filter((t) => effectiveStatus(t) === "已逾期").length,
      todayProgress: list.filter((t) =>
        t.progressRecords.some((r) => inRange(r.createdAt, { start: todayStr(), end: todayStr() })) ||
        inRange(t.completedAt, { start: todayStr(), end: todayStr() })
      ).length,
      unclassified: list.filter((t) => t.classificationStatus === "待归类").length,
      progress: list.length ? Math.round((done / list.length) * 100) : 0
    };
  }

  function todayFeed(tasks) {
    const out = [];
    const t = todayStr();
    tasks.forEach((task) => {
      const doneAt = task.completedAt || task.statusUpdatedAt;
      if (task.status === "已完成" && inRange(doneAt, { start: t, end: t })) {
        out.push({ id: task.id + "-done", time: fmtHM(doneAt), title: task.title, text: "任务已完成", at: doneAt });
      }
      task.progressRecords.forEach((r) => {
        if (inRange(r.createdAt, { start: t, end: t })) {
          out.push({ id: r.id, time: fmtHM(r.createdAt), title: task.title, text: r.content, at: r.createdAt });
        }
      });
      task.attachments.forEach((a) => {
        if (inRange(a.uploadedAt, { start: t, end: t })) {
          out.push({ id: a.id, time: fmtHM(a.uploadedAt), title: task.title, text: "上传附件：" + a.name, at: a.uploadedAt });
        }
      });
    });
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 5);
  }

  function rangeLabel(r) {
    return { today: "今天", yesterday: "昨天", thisWeek: "本周", lastWeek: "上周", custom: "自定义" }[r] || r;
  }

  function rangeCalc(r, start, end) {
    const j = todayStr();
    const dow = new Date(j + "T00:00:00").getDay() || 7; /* 周一=1 */
    if (r === "today") return { start: j, end: j };
    if (r === "yesterday") return { start: addDaysStr(j, -1), end: addDaysStr(j, -1) };
    if (r === "thisWeek") return { start: addDaysStr(j, 1 - dow), end: addDaysStr(j, 7 - dow) };
    if (r === "lastWeek") return { start: addDaysStr(j, 1 - dow - 7), end: addDaysStr(j, 7 - dow - 7) };
    return { start: start || j, end: end || start || j };
  }

  function buildReport(tasks, projectId, range) {
    const n = range || { start: todayStr(), end: todayStr() };
    const s = projectId === "all" ? tasks : tasks.filter((t) => t.projectId === projectId);
    const a = s.filter((t) =>
      inRange(t.completedAt || t.statusUpdatedAt || t.createdAt, n) ||
      t.progressRecords.some((r) => inRange(r.createdAt, n)) ||
      t.attachments.some((x) => inRange(x.uploadedAt, n))
    );
    const grouped = Array.from(new Map(a.map((t) => [t.projectName, a.filter((x) => x.projectName === t.projectName)])).entries())
      .map(([name, group], i) => {
        const lines = group.flatMap((t) => {
          const out = [];
          if (t.status === "已完成" && inRange(t.completedAt || t.statusUpdatedAt, n)) out.push("完成" + t.title);
          t.progressRecords.filter((r) => inRange(r.createdAt, n)).forEach((r) => out.push("推进" + t.title + "：" + r.content));
          t.attachments.filter((x) => inRange(x.uploadedAt, n)).forEach((x) => out.push("补充" + t.title + "相关资料：" + x.name));
          if (!out.length && inRange(t.createdAt, n)) out.push("新增待办：" + t.title);
          return out;
        });
        return (i + 1) + ". " + name + "\n" + lines.slice(0, 6).map((x) => "- " + x).join("\n");
      });
    const follow = s.filter((t) => t.status !== "已完成" && effectiveStatus(t) !== "已逾期").slice(0, 6);
    const risk = s.filter((t) => effectiveStatus(t) === "已逾期");
    const parts = [
      "工作完成情况",
      grouped.length ? grouped.join("\n\n") : "当前范围内暂无已记录的完成、进展或附件。",
      follow.length ? "\n待跟进事项\n" + follow.map((t) => "- " + t.title).join("\n") : "",
      risk.length ? "\n风险 / 已逾期：\n" + risk.map((t) => "- " + t.title + "需要优先处理。").join("\n") : ""
    ].filter(Boolean);
    return s.length ? parts.join("\n") : "当前范围内暂无可汇总的工作内容。";
  }

  /* ================= 任务卡片解析（复刻目标站解析逻辑） ================= */
  function fieldOf(card, field) {
    const m = card.match(new RegExp(field + "：([^\\n]*)"));
    return m && m[1] ? m[1].trim() : "";
  }

  function guessDue(line) {
    if (/今天|今日/.test(line)) return "今天";
    if (/明天/.test(line)) return "明天（" + addDaysStr(todayStr(), 1) + "）";
    if (/周五|星期五/.test(line)) return "本周五";
    if (/下午/.test(line)) return "今天下午";
    return "未明确";
  }

  function makePreview(title, projectName, dueText, projects, extra) {
    const proj = projects.find((p) => p.name === projectName) ||
      projects.find((p) => p.name === "个人待办") || projects[0];
    const isDefault = (proj && proj.name) === "个人待办";
    const cls = extra.classificationStatus || (isDefault && projectName !== "个人待办" ? "待归类" : "已归类");
    return {
      selected: true,
      title,
      projectId: proj ? proj.id : "project-personal",
      projectName: proj ? proj.name : "个人待办",
      classificationStatus: cls,
      owner: extra.owner || "未明确",
      dueText: dueText || "未明确",
      status: "待开始",
      priority: ["高", "低"].includes(extra.priority) ? extra.priority : "中",
      source: extra.source || "手动录入",
      note: extra.note || ""
    };
  }

  function parseIntakeText(text, projects) {
    const n = String(text || "").trim();
    if (!n) return [];
    const cards = n.split(/(?=【任务\d+】)/).filter((c) => c.includes("任务名称："));
    if (cards.length) {
      return cards.map((c) => makePreview(
        fieldOf(c, "任务名称") || "未命名任务",
        fieldOf(c, "所属项目"),
        fieldOf(c, "截止时间"),
        projects,
        {
          classificationStatus: fieldOf(c, "归类状态"),
          owner: fieldOf(c, "负责人"),
          priority: fieldOf(c, "优先级"),
          source: fieldOf(c, "来源") || "AI整理",
          note: fieldOf(c, "备注")
        }
      ));
    }
    return n.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) =>
      makePreview(line, "个人待办", guessDue(line), projects, { source: "手动录入", note: line })
    );
  }

  /* ================= 通用操作 ================= */
  function copyText(text, msg) {
    const done = (ok) => {
      toast(ok ? (msg || "已复制") : "复制失败，请手动选择复制", !ok);
      return ok;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => done(true)).catch(() => {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          return done(true);
        } catch (e) { return done(false); }
      });
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return Promise.resolve(done(true));
    } catch (e) { return Promise.resolve(done(false)); }
  }

  function completeTask(id) {
    const now = new Date().toISOString();
    state.tasks = state.tasks.map((t) => t.id === id
      ? Object.assign({}, t, { status: "已完成", completedAt: now, statusUpdatedAt: now })
      : t);
    save();
    renderWorkbench();
    toast("任务已完成");
  }

  function updateTask(id, patch) {
    const now = new Date().toISOString();
    state.tasks = state.tasks.map((t) => {
      if (t.id !== id) return t;
      const next = Object.assign({}, t, patch);
      next.statusUpdatedAt = patch.status ? now : t.statusUpdatedAt;
      if (next.status === "已完成" && !next.completedAt) next.completedAt = now;
      if ((next.status === "进行中" || next.status === "待开始") && next.completedAt) next.completedAt = undefined;
      return next;
    });
    save();
    renderWorkbench();
  }

  function deleteTasks(ids) {
    if (!ids || !ids.length) return;
    if (!window.confirm("确认删除 " + ids.length + " 条任务？")) return;
    state.tasks = state.tasks.filter((t) => !ids.includes(t.id));
    selectedRows = [];
    save();
    renderWorkbench();
    toast("已删除任务");
  }

  function addProgress(taskId, content, statusChange, attachments) {
    if (!content.trim() && (!attachments || !attachments.length)) {
      toast("请先填写进展内容或添加附件", true);
      return;
    }
    const now = new Date().toISOString();
    state.tasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const change = statusChange && statusChange !== t.status
        ? (t.status || "待开始") + " → " + statusChange : undefined;
      const next = Object.assign({}, t, {
        status: statusChange || t.status,
        statusUpdatedAt: statusChange ? now : t.statusUpdatedAt
      });
      if (next.status === "已完成" && !next.completedAt) next.completedAt = now;
      if ((next.status === "进行中" || next.status === "待开始") && next.completedAt) next.completedAt = undefined;
      next.progressRecords = [{
        id: wbUid("progress"),
        content,
        source: "手动记录",
        statusChange: change,
        attachments: attachments || [],
        createdAt: now
      }].concat(next.progressRecords);
      return next;
    });
    save();
    renderWorkbench();
    toast("进展已保存");
  }

  function processFiles(files) {
    return Promise.all(Array.from(files).map((file) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        id: wbUid("attachment"),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        status: "已记录",
        folderName: "",
        url: String(reader.result || ""),
        uploadedAt: new Date().toISOString()
      });
      reader.onerror = () => resolve({
        id: wbUid("attachment"),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        status: "读取失败",
        uploadedAt: new Date().toISOString()
      });
      reader.readAsDataURL(file);
    })));
  }

  async function addAttachments(taskId, files) {
    if (!files || !files.length) return;
    const task = state.tasks.find((t) => t.id === taskId);
    const proj = task && state.projects.find((p) => p.id === task.projectId);
    const list = await processFiles(files);
    if (proj && proj.localFolderName) {
      list.forEach((a) => { a.status = "未归档，请重新授权文件夹"; a.folderName = proj.localFolderName; });
    }
    state.tasks = state.tasks.map((t) => t.id === taskId
      ? Object.assign({}, t, { attachments: list.concat(t.attachments) }) : t);
    save();
    renderWorkbench();
    toast(proj && proj.localFolderName ? "已保留附件记录（浏览器本地版不写入磁盘）" : "附件已记录");
  }

  function addProject(name, desc) {
    if (!name.trim()) { toast("请填写项目名称", true); return; }
    state.projects = [{
      id: wbUid("project"),
      name: name.trim(),
      type: "项目",
      status: "进行中",
      stage: "进行中",
      description: desc.trim(),
      startDate: "",
      endDate: "",
      phases: [],
      progress: 0,
      materialCount: 0,
      createdAt: new Date().toISOString()
    }].concat(state.projects);
    save();
    closeModals();
    wbView = "projects";
    renderWorkbench();
    toast("项目已创建");
  }

  function updateProject(id, patch) {
    state.projects = state.projects.map((p) => p.id === id ? Object.assign({}, p, patch) : p);
    save();
    renderWorkbench();
  }

  function addProjectRecord(projectId, content, attachments) {
    if (!content.trim() && (!attachments || !attachments.length)) {
      toast("请先填写项目记录或添加附件", true);
      return;
    }
    const now = new Date().toISOString();
    state.projects = state.projects.map((p) => p.id === projectId ? Object.assign({}, p, {
      records: [{
        id: wbUid("project-record"),
        content: content.trim() || "附件记录",
        attachments: attachments || [],
        createdAt: now
      }].concat(p.records || [])
    }) : p);
    save();
    renderWorkbench();
    toast("项目记录已保存");
  }

  function addProjectPhase(projectId) {
    state.projects = state.projects.map((p) => p.id === projectId ? Object.assign({}, p, {
      phases: (p.phases || []).concat([{ id: wbUid("phase"), name: "", startDate: "", endDate: "" }])
    }) : p);
    save();
    renderWorkbench();
  }

  function updateProjectPhase(projectId, phaseId, patch) {
    state.projects = state.projects.map((p) => p.id === projectId ? Object.assign({}, p, {
      phases: (p.phases || []).map((ph) => ph.id === phaseId ? Object.assign({}, ph, patch) : ph)
    }) : p);
    save();
    renderWorkbench();
  }

  function removeProjectPhase(projectId, phaseId) {
    state.projects = state.projects.map((p) => p.id === projectId ? Object.assign({}, p, {
      phases: (p.phases || []).filter((ph) => ph.id !== phaseId)
    }) : p);
    save();
    renderWorkbench();
  }

  async function selectProjectFolder(projectId) {
    if (window.traceDesktop) {
      try {
        const root = await window.traceDesktop.chooseLibraryRoot();
        if (!root) return;
        const name = String(root).split(/[\\/]/).pop() || root;
        updateProject(projectId, { localFolderName: name, localFolderSetAt: new Date().toISOString() });
        toast("本地资料文件夹已选择：" + name);
      } catch (e) {
        toast("未完成文件夹授权", true);
      }
      return;
    }
    if (!("showDirectoryPicker" in window)) {
      toast("当前浏览器不支持直接写入本地文件夹，可先保留附件记录，建议使用 Chrome / Edge 本地模式体验。", true);
      return;
    }
    try {
      const handle = await window.showDirectoryPicker();
      directoryHandles[projectId] = handle;
      updateProject(projectId, { localFolderName: handle.name, localFolderSetAt: new Date().toISOString() });
      toast("本地资料文件夹已选择。本次会话内新增附件会优先归档到该文件夹。");
    } catch (e) {
      toast("未完成文件夹授权，附件会先保留记录。", true);
    }
  }

  function saveDefaultAi(ai, msg) {
    state.defaultAi = ai || state.defaultAi || "DeepSeek";
    state.aiConfigured = true;
    aiSelected = state.defaultAi;
    save();
    renderWorkbench();
    toast(msg || "默认 AI 已保存");
  }

  function exportData() {
    window.alert("数据导出不一定完整包含本地附件文件；附件仍以项目绑定的本地资料文件夹为准，请另行保管重要原文件。");
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "project-workbench-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        state = normalize(parsed);
        save();
        renderWorkbench();
        toast("数据已导入");
      } catch (err) {
        toast("导入失败，请选择正确的备份文件", true);
      }
    };
    reader.readAsText(file);
  }

  function clearBusinessData() {
    if (!window.confirm("确认清空全部业务数据？此操作无法恢复。")) return;
    if (!window.confirm("再次确认：项目、任务、进展、附件、记事本、反馈都会清空，但基础版设置会保留。")) return;
    state = normalize({
      defaultAi: state.defaultAi,
      aiConfigured: state.aiConfigured,
      onboarding: state.onboarding,
      projects: [Object.assign({}, DEFAULT_PROJECT, { createdAt: new Date().toISOString() })],
      tasks: [],
      inbox: [],
      reports: [],
      dismissedTips: {},
      todoOrder: []
    });
    save();
    renderWorkbench();
    toast("业务数据已清空");
  }

  function restartOnboarding() {
    state.onboarding = { status: "not_started", step: 1 };
    save();
    renderWorkbench();
    openAiModal(true);
  }

  function dismissGuide(view) {
    state.dismissedTips = Object.assign({}, state.dismissedTips, { [view]: true });
    save();
    renderGuide(view);
  }

  /* ================= 渲染 ================= */
  let state = null; /* 工作台独立内存状态，与留痕主应用全局 state 完全隔离 */
  let wbView = "home";
  let intakeText = "";
  let previewTasks = [];
  let selectedTaskId = null;
  let selectedProjectId = null;
  let filters = { tab: "全部", search: "", project: "all", status: "all" };
  let selectedRows = [];
  let reportTab = "daily";
  let reportRange = "today";
  let rangeStart = "";
  let rangeEnd = "";
  let reportProject = "all";
  let projectTab = "list";
  let aiSelected = "DeepSeek";
  let showInstruction = false;
  let notepadText = "";
  const directoryHandles = {};

  function setWbView(v) {
    wbView = v;
    renderWorkbench();
  }

  function renderGuide(view) {
    const guide = wb$("#wb-guide");
    if (!guide) return;
    if (state.dismissedTips[view]) {
      guide.classList.add("hidden");
      return;
    }
    guide.classList.remove("hidden");
    wb$("#wb-guide-text").textContent = GUIDE_TIPS[view] || "";
  }

  function renderWorkbench() {
    const el = wb$("#view-workbench");
    if (!el) return;
    aiSelected = state.defaultAi || "DeepSeek";
    const meta = VIEW_META[wbView] || VIEW_META.home;
    wb$("#wb-page-title").textContent = meta[0];
    wb$("#wb-page-sub").textContent = meta[1];
    wb$$(".wb-nav-item").forEach((b) => b.classList.toggle("active", b.dataset.wb === wbView));
    wb$$(".wb-view").forEach((v) => v.classList.toggle("active", v.id === "wb-" + wbView));
    renderGuide(wbView);
    if (wbView === "home") renderHome();
    if (wbView === "intake") renderIntake();
    if (wbView === "tasks") renderTasks();
    if (wbView === "projects") renderProjects();
    if (wbView === "reports") renderReports();
    if (wbView === "settings") renderSettings();
  }

  function projectName(id) {
    const p = state.projects.find((x) => x.id === id);
    return p ? p.name : "个人待办";
  }

  function statusBadge(status) {
    const cls = { "已完成": "done", "已逾期": "overdue", "进行中": "doing", "待开始": "todo" }[status] || "todo";
    return `<span class="wb-badge wb-badge-${cls}">${wbEsc(status)}</span>`;
  }

  function taskRowHtml(t, opts) {
    opts = opts || {};
    const st = effectiveStatus(t);
    return `<div class="wb-task-row ${opts.compact ? "compact" : ""}">
      <button class="wb-task-check ${t.status === "已完成" ? "done" : ""}" type="button" onclick="WB.completeTask('${t.id}')" title="标记完成">${t.status === "已完成" ? "✓" : ""}</button>
      <div class="wb-task-main">
        <div class="wb-task-title" onclick="WB.openTask('${t.id}')">${wbEsc(t.title)}</div>
        <div class="wb-task-meta">${wbEsc(projectName(t.projectId))}${t.classificationStatus === "待归类" ? ' <span class="wb-tag wb-tag-warn">待归类</span>' : ""}${t.dueText && t.dueText !== "未明确" ? " · 截止 " + wbEsc(t.dueText) : ""}${t.priority === "高" ? ' <span class="wb-tag wb-tag-red">高</span>' : ""}</div>
      </div>
      <div class="wb-task-side">${statusBadge(st)}</div>
    </div>`;
  }

  function renderHome() {
    const box = wb$("#wb-home");
    if (!box) return;
    const groups = homeGroups(state.tasks, state.todoOrder);
    const feed = todayFeed(state.tasks);
    const stats = {
      todoTotal: groups.overdue.length + groups.today.length + groups.soon.length,
      overdue: groups.overdue.length,
      today: groups.today.length,
      soon: groups.soon.length,
      feedTotal: feed.length,
      completed: state.tasks.filter((t) => t.status === "已完成" && inRange(t.completedAt || t.statusUpdatedAt, { start: todayStr(), end: todayStr() })).length,
      attachments: state.tasks.reduce((n, t) => n + t.attachments.filter((a) => inRange(a.uploadedAt, { start: todayStr(), end: todayStr() })).length, 0)
    };
    const attention = groups.overdue.concat(groups.soon).slice(0, 2);
    const draft = buildReport(state.tasks, "all", { start: todayStr(), end: todayStr() });
    const showOnboarding = state.onboarding.status !== "completed" && state.tasks.length === 0;

    let html = "";
    if (showOnboarding) {
      html += `<div class="wb-panel wb-start-card">
        <span class="wb-pill wb-pill-blue">开始使用项目工作台</span>
        <h2>先把一条微信消息、聊天记录或领导指令整理成任务。</h2>
        <p class="wb-subtle">建议先完成一次 AI 初始配置，再把拆解结果复制回工作台生成任务。</p>
        <div class="wb-start-flow">
          <div><b>第一步</b><span>打开 AI 助手，复制工作台初始指令。</span></div>
          <div><b>第二步</b><span>把微信截图、聊天记录或领导指令发给 AI 拆解。</span></div>
          <div><b>第三步</b><span>将 AI 拆解结果复制回工作台，生成任务。</span></div>
        </div>
        <div class="wb-actions-row">
          <button class="primary-btn" type="button" onclick="WB.openAi()">打开 AI 助手</button>
          <button class="ghost-btn" type="button" onclick="WB.gotoIntake()">直接录入任务</button>
        </div>
      </div>`;
    }

    html += `<div class="wb-stats">
      <button class="wb-stat" type="button" onclick="WB.scrollTo('wb-today-todo')">
        <div><h3>今日待办</h3><div class="wb-stat-num">${stats.todoTotal}</div><div class="wb-stat-desc">已逾期 ${stats.overdue}｜今天 ${stats.today}｜快到期 ${stats.soon}</div></div>
        <div class="wb-stat-icon blue">☰</div>
      </button>
      <button class="wb-stat wb-attention" type="button" onclick="WB.openAttention()">
        <div><h3>需关注事项</h3>
          ${attention.length
            ? attention.map((t) => `<span class="wb-attention-item">${wbEsc(t.title)}</span>`).join("")
            : '<div class="wb-stat-desc">暂无需要特别关注的事项</div>'}
          ${attention.length > 2 ? `<div class="wb-stat-desc">还有 ${attention.length - 2} 条</div>` : ""}
        </div>
        <div class="wb-stat-icon red">!</div>
      </button>
      <button class="wb-stat" type="button" onclick="WB.scrollTo('wb-today-progress')">
        <div><h3>今日进展</h3><div class="wb-stat-num">${stats.feedTotal}</div><div class="wb-stat-desc">完成 ${stats.completed}｜进展 ${feed.length}｜截图 ${stats.attachments}</div></div>
        <div class="wb-stat-icon green">✓</div>
      </button>
    </div>`;

    html += `<div class="wb-grid-main">
      <div class="wb-panel" id="wb-today-todo">
        <div class="wb-panel-head"><h2>今日待办</h2></div>
        ${groups.overdue.length ? `<h4 class="wb-group-title wb-overdue">已逾期</h4>` + groups.overdue.map((t) => taskRowHtml(t, { compact: true })).join("") : ""}
        ${groups.today.length ? `<h4 class="wb-group-title">今天</h4>` + groups.today.map((t) => taskRowHtml(t, { compact: true })).join("") : ""}
        ${groups.soon.length ? `<h4 class="wb-group-title">快到期</h4>` + groups.soon.map((t) => taskRowHtml(t, { compact: true })).join("") : ""}
        ${!groups.overdue.length && !groups.today.length && !groups.soon.length ? '<p class="wb-empty">今天没有待办，先去录入一条吧。</p>' : ""}
      </div>

      <div class="wb-panel" id="wb-today-progress">
        <div class="wb-panel-head"><h2>今日进展</h2></div>
        ${feed.length ? feed.map((f) => `<div class="wb-feed-item"><span class="wb-feed-time">${wbEsc(f.time)}</span><b>${wbEsc(f.title)}</b><span>${wbEsc(f.text)}</span></div>`).join("") : '<p class="wb-empty">今天还没有进展记录。</p>'}
      </div>

      <div class="wb-panel">
        <div class="wb-panel-head"><h2>汇报草稿</h2><span class="wb-subtle">完成任务后自动更新</span></div>
        <pre class="wb-draft">${wbEsc(draft)}</pre>
        <div class="wb-actions-row"><button class="ghost-btn btn-sm" type="button" onclick="WB.copyReport()">复制日报</button></div>
      </div>

      <div class="wb-panel">
        <div class="wb-panel-head"><h2>记事本待整理</h2><span class="wb-count">${state.inbox.length}</span></div>
        ${state.inbox.length ? state.inbox.map((n) => `<div class="wb-inbox-item"><b>${wbEsc(n.title)}</b><span>${wbEsc(n.preview)}</span><em>${wbEsc(n.time)}</em></div>`).join("") : '<p class="wb-empty">暂无待整理内容，可先用顶部「记事本」随手记录。</p>'}
      </div>
    </div>`;

    box.innerHTML = html;
  }

  function renderIntake() {
    const box = wb$("#wb-intake");
    if (!box) return;
    let html = `<div class="wb-panel">
      <h2>任务录入</h2>
      <p class="wb-subtle">可以粘贴 AI 返回的任务卡片纯文本，也可以直接手写一句话或几行待办。先把事情收进来，后面再轻编辑。</p>
      <div class="wb-notice">推荐用法：先把微信截图、聊天记录、会议纪要或领导指令发给右侧 AI，让 AI 拆解成任务信息，再复制回这里生成任务预览。</div>
      <label for="wb-intake-text">任务内容</label>
      <textarea id="wb-intake-text" class="wb-input wb-intake-textarea" rows="6" placeholder="请将右侧 AI 拆解好的任务内容粘贴到这里。&#10;也可以手动输入要跟进的事项。">${wbEsc(intakeText)}</textarea>
      <div class="wb-actions-row"><button class="primary-btn" type="button" onclick="WB.generatePreview()">生成任务预览</button></div>
      ${previewTasks.length ? `<div class="wb-preview-list">
        <div class="wb-panel-head"><h2>任务预览</h2><button class="primary-btn btn-sm" type="button" onclick="WB.importPreview()">确认导入选中任务</button></div>
        <p class="wb-subtle">导入前只轻编辑任务名称、所属项目、截止时间。其他信息保存到任务详情里。</p>
        ${previewTasks.map((p, i) => `<div class="wb-preview-card">
          <input type="checkbox" ${p.selected ? "checked" : ""} onchange="WB.togglePreview(${i})">
          <div class="wb-preview-fields">
            <label>任务内容</label>
            <input class="wb-input" value="${wbEsc(p.title)}" onchange="WB.editPreview(${i},'title',this.value)">
            <p class="wb-preview-note">${wbEsc(p.note || "暂无备注")}</p>
          </div>
          <div class="wb-preview-fields">
            <label>所属项目</label>
            <select class="wb-input" onchange="WB.editPreviewProject(${i},this.value)">${state.projects.map((pr) => `<option value="${pr.id}" ${pr.id === p.projectId ? "selected" : ""}>${wbEsc(pr.name)}</option>`).join("")}</select>
          </div>
          <div class="wb-preview-fields">
            <label>截止时间</label>
            <input class="wb-input" value="${wbEsc(p.dueText)}" onchange="WB.editPreview(${i},'dueText',this.value)">
            <div class="wb-chip-row">${["今天", "明天", "本周五", "下周一"].map((d) => `<button class="wb-chip" type="button" onclick="WB.editPreview(${i},'dueText','${d}')">${d}</button>`).join("")}</div>
          </div>
        </div>`).join("")}
      </div>` : ""}
    </div>`;
    box.innerHTML = html;
    const ta = wb$("#wb-intake-text");
    if (ta) {
      ta.addEventListener("input", () => { intakeText = ta.value; });
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }

  function renderTasks() {
    const box = wb$("#wb-tasks");
    if (!box) return;
    const tabs = ["全部", "今天", "近 7 天", "已逾期", "未分项目", "待开始", "已完成"];
    const list = state.tasks.filter((t) => {
      if (filters.project !== "all" && t.projectId !== filters.project) return false;
      const st = effectiveStatus(t);
      if (filters.status !== "all" && st !== filters.status) return false;
      if (filters.search && !t.title.includes(filters.search)) return false;
      if (filters.tab === "今天" && !isTodayDue(t)) return false;
      if (filters.tab === "近 7 天" && t.status === "已完成") return false;
      if (filters.tab === "已逾期" && st !== "已逾期") return false;
      if (filters.tab === "未分项目" && t.classificationStatus !== "待归类") return false;
      if (filters.tab === "待开始" && st !== "待开始") return false;
      if (filters.tab === "已完成" && st !== "已完成") return false;
      return true;
    });
    const defaultProjectId = state.projects[0] ? state.projects[0].id : "project-personal";

    let html = `<div class="wb-panel">
      <div class="wb-panel-head"><h2>任务清单</h2><p class="wb-subtle">当前基础版主要支持手动录入、AI 拆解后导入和本地任务整理。</p></div>
      <div class="wb-filters">
        ${tabs.map((t) => `<button class="wb-filter ${filters.tab === t ? "active" : ""}" type="button" onclick="WB.setFilter('tab','${t}')">${t}</button>`).join("")}
        <input class="wb-input wb-search" id="wb-search-input" placeholder="搜索任务" value="${wbEsc(filters.search)}" oninput="WB.setFilter('search',this.value)">
        <select class="wb-input" onchange="WB.setFilter('project',this.value)"><option value="all">全部项目</option>${state.projects.map((p) => `<option value="${p.id}" ${filters.project === p.id ? "selected" : ""}>${wbEsc(p.name)}</option>`).join("")}</select>
        <select class="wb-input" onchange="WB.setFilter('status',this.value)"><option value="all">全部状态</option>${["待开始", "进行中", "已完成"].map((s) => `<option value="${s}" ${filters.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      </div>
      ${selectedRows.length ? `<div class="wb-batch-bar">
        <span>已选择 ${selectedRows.length} 项</span>
        <select class="wb-input" id="wb-batch-project"><option value="${defaultProjectId}">${wbEsc(projectName(defaultProjectId))}</option>${state.projects.map((p) => `<option value="${p.id}">${wbEsc(p.name)}</option>`).join("")}</select>
        <button class="primary-btn btn-sm" type="button" onclick="WB.batchComplete()">完成所选</button>
        <button class="ghost-btn btn-sm" type="button" onclick="WB.batchMove()">移动到项目</button>
        <button class="ghost-btn btn-sm wb-danger" type="button" onclick="WB.batchDelete()">删除所选</button>
      </div>` : ""}
      ${list.length ? `<div class="wb-table">
        <div class="wb-table-head"><span></span><span>任务</span><span>项目</span><span>状态</span><span>截止</span><span>优先级</span><span>来源</span><span>操作</span></div>
        ${list.map((t) => `<div class="wb-table-row">
          <input type="checkbox" ${selectedRows.includes(t.id) ? "checked" : ""} onchange="WB.toggleRow('${t.id}')">
          <span class="wb-task-title" onclick="WB.openTask('${t.id}')">${wbEsc(t.title)}</span>
          <span>${wbEsc(projectName(t.projectId))}${t.classificationStatus === "待归类" ? ' <span class="wb-tag wb-tag-warn">待归类</span>' : ""}</span>
          <span>${statusBadge(effectiveStatus(t))}</span>
          <span class="wb-muted">${wbEsc(t.dueText || "未明确")}</span>
          <span>${wbEsc(t.priority)}</span>
          <span class="wb-muted">${wbEsc(t.source)}</span>
          <span class="wb-row-actions"><button class="ghost-btn btn-sm" type="button" onclick="WB.openTask('${t.id}')">打开</button>${t.status !== "已完成" ? `<button class="ghost-btn btn-sm" type="button" onclick="WB.completeTask('${t.id}')">完成</button>` : ""}</span>
        </div>`).join("")}
      </div>` : '<p class="wb-empty">还没有任务，先去录入一条吧。</p>'}
    </div>`;
    box.innerHTML = html;
    /* 搜索输入重渲染后恢复焦点 */
    if (window.__wbSearchFocused) {
      const input = wb$("#wb-search-input");
      if (input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    }
  }

  function renderProjects() {
    const box = wb$("#wb-projects");
    if (!box) return;
    let html = `<div class="wb-panel">
      <div class="wb-panel-head"><h2>项目管理</h2><button class="primary-btn btn-sm" type="button" onclick="WB.openNewProject()">+ 新建项目</button></div>
      <p class="wb-subtle">项目是任务、进展和资料的工作档案夹。</p>
      <div class="wb-switch-tabs">
        <button class="wb-switch-tab ${projectTab === "list" ? "active" : ""}" type="button" onclick="WB.setProjectTab('list')">项目列表</button>
        <button class="wb-switch-tab ${projectTab === "gantt" ? "active" : ""}" type="button" onclick="WB.setProjectTab('gantt')">排期甘特</button>
      </div>
      ${projectTab === "list"
        ? `<div class="wb-project-list">${state.projects.map((p) => {
            const st = projectStats(p, state.tasks);
            return `<div class="wb-project-card" onclick="WB.openProject('${p.id}')">
              <div class="wb-project-title">${wbEsc(p.name)}${p.isDefault ? ' <span class="wb-pill wb-pill-orange">系统默认</span>' : ""}</div>
              <div class="wb-project-meta"><span>未完成 ${st.open}</span><span>逾期 ${st.overdue}</span><span>今日进展 ${st.todayProgress}</span><span>待归类 ${st.unclassified}</span></div>
              <div class="wb-progress"><span style="width:${Math.min(100, st.progress)}%"></span></div>
            </div>`;
          }).join("")}</div>`
        : renderGantt()}
    </div>`;
    box.innerHTML = html;
  }

  function renderGantt() {
    const valid = (s, e) => !!(s && e && /^\d{4}-\d{2}-\d{2}$/.test(s) && /^\d{4}-\d{2}-\d{2}$/.test(e) && e >= s);
    const rows = state.projects.map((p) => {
      const phases = (p.phases || []).filter((ph) => valid(ph.startDate, ph.endDate))
        .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
      return `<div class="wb-gantt-row"><div class="wb-gantt-label">${wbEsc(p.name)}</div>
        <div class="wb-gantt-track">${valid(p.startDate, p.endDate)
          ? `<span class="wb-project-bar" style="left:4%;width:82%">${p.startDate} - ${p.endDate}</span>` : ""}
          ${phases.map((ph, i) => `<span class="wb-phase-bar" style="left:${8 + 18 * i}%;width:16%">${wbEsc(ph.name || "阶段")}</span>`).join("")}
        </div></div>`;
    });
    return rows.length
      ? `<div class="wb-gantt">${rows.join("")}</div>`
      : '<p class="wb-empty">设置项目开始和结束时间后，会自动生成项目排期甘特。</p>';
  }

  function renderReports() {
    const box = wb$("#wb-reports");
    if (!box) return;
    const range = rangeCalc(reportRange, rangeStart, rangeEnd);
    const isWeekly = reportTab === "weekly";
    const body = buildReport(state.tasks, reportProject, range);
    const title = `${rangeLabel(reportRange)} ${isWeekly ? "周报" : "日报"}`;
    const full = title + "\n\n" + body;
    const ranges = ["today", "yesterday", "thisWeek", "lastWeek", "custom"];

    let html = `<div class="wb-panel">
      <div class="wb-switch-tabs">
        <button class="wb-switch-tab ${reportTab === "daily" ? "active" : ""}" type="button" onclick="WB.setReportTab('daily')">日报</button>
        <button class="wb-switch-tab ${reportTab === "weekly" ? "active" : ""}" type="button" onclick="WB.setReportTab('weekly')">周报</button>
        <button class="wb-switch-tab ${reportTab === "history" ? "active" : ""}" type="button" onclick="WB.setReportTab('history')">历史记录</button>
      </div>
      ${reportTab !== "history" ? `
      <div class="wb-filters">
        ${ranges.map((r) => `<button class="wb-filter ${reportRange === r ? "active" : ""}" type="button" onclick="WB.setRange('${r}')">${rangeLabel(r)}</button>`).join("")}
        ${reportRange === "custom" ? `<input type="date" class="wb-input" value="${rangeStart}" onchange="WB.setCustom('start',this.value)"><span>至</span><input type="date" class="wb-input" value="${rangeEnd}" onchange="WB.setCustom('end',this.value)">` : ""}
        <select class="wb-input" onchange="WB.setReportProject(this.value)"><option value="all">全部项目</option>${state.projects.map((p) => `<option value="${p.id}" ${reportProject === p.id ? "selected" : ""}>${wbEsc(p.name)}</option>`).join("")}</select>
      </div>
      <div class="wb-report-body">
        <h3>${wbEsc(title)}</h3>
        <pre>${wbEsc(body)}</pre>
      </div>
      <div class="wb-actions-row">
        <button class="primary-btn" type="button" onclick="WB.copyGenerated()">复制${isWeekly ? "周报" : "日报"}</button>
        <button class="ghost-btn" type="button" onclick="WB.saveReport()">保存记录</button>
      </div>` : `
      <div class="wb-report-history">
        ${state.reports.length ? state.reports.map((r) => `<div class="wb-history-card">
          <b>${wbEsc(r.title)}</b><span class="wb-muted">${wbEsc(r.rangeStart || "")} ~ ${wbEsc(r.rangeEnd || "")}</span>
          <pre>${wbEsc(r.content)}</pre>
          <div class="wb-actions-row"><button class="ghost-btn btn-sm" type="button" onclick="WB.copyHistory('${r.id}')">复制</button></div>
        </div>`).join("") : '<p class="wb-empty">还没有保存过的日报 / 周报记录。</p>'}
      </div>`}
    </div>`;
    box.innerHTML = html;
    wb$("#wb-report-full") && (wb$("#wb-report-full").value = full);
    window.__wbReportFull = full;
  }

  function renderSettings() {
    const box = wb$("#wb-settings");
    if (!box) return;
    let html = `<div class="wb-settings-grid">
      <div class="wb-panel">
        <h2>AI助手设置</h2>
        <p class="wb-subtle">选择默认 AI，并管理初始指令。</p>
        <label for="wb-ai-select">默认 AI</label>
        <select class="wb-input" id="wb-ai-select">${Object.keys(AI_URLS).map((k) => `<option value="${k}" ${aiSelected === k ? "selected" : ""}>${k}</option>`).join("")}</select>
        <div class="wb-actions-row">
          <button class="primary-btn" type="button" onclick="WB.saveDefaultAi()">保存默认 AI</button>
          <button class="ghost-btn" type="button" onclick="WB.copyInstruction()">查看 / 复制初始指令</button>
          <button class="ghost-btn" type="button" onclick="WB.restartOnboarding()">重新查看新手引导</button>
        </div>
      </div>
      <div class="wb-panel">
        <h2>数据管理</h2>
        <p class="wb-subtle">清空业务数据不会清除基础设置。</p>
        <div class="wb-actions-row">
          <button class="primary-btn" type="button" onclick="WB.exportData()">导出数据</button>
          <button class="ghost-btn" type="button" onclick="WB.pickImport()">导入数据</button>
          <button class="ghost-btn wb-danger" type="button" onclick="WB.clearData()">清空全部数据</button>
        </div>
        <p class="wb-subtle">数据导出不一定完整包含本地附件文件；附件仍以项目绑定的本地资料文件夹为准，请另行保管重要原文件。</p>
      </div>
      <div class="wb-panel">
        <h2>本地资料文件夹</h2>
        <p class="wb-subtle">项目详情中可以为项目选择本地资料文件夹。任务进展、项目记录和项目资料中的附件会优先归档到对应文件夹；权限失效时需要重新授权。</p>
      </div>
      <div class="wb-panel">
        <h2>支持作者</h2>
        <p class="wb-subtle">这是我从自己的工作流程中整理出来的小工具。如果它刚好帮你省了一点时间，欢迎自愿支持一下作者。</p>
        <div class="wb-actions-row"><button class="ghost-btn" type="button" onclick="WB.openSupport()">请作者喝杯咖啡</button></div>
      </div>
      <div class="wb-panel">
        <h2>关于项目工作台</h2>
        <p class="wb-subtle">当前版本：项目工作台 · 基础版（留痕复刻）</p>
        <p class="wb-subtle">项目工作台是一款帮助个人整理项目、任务和工作进展的免费基础工具。当前数据保存在本机浏览器中，请勿存放特别重要或唯一留存的资料。</p>
      </div>
    </div>`;
    box.innerHTML = html;
    const sel = wb$("#wb-ai-select");
    if (sel) sel.addEventListener("change", () => { aiSelected = sel.value; });
  }

  function renderTaskModal() {
    const box = wb$("#wb-task-body");
    const t = state.tasks.find((x) => x.id === selectedTaskId);
    if (!t || !box) return;
    let html = `<h3>任务详情</h3>
      <label>任务内容</label>
      <input class="wb-input" value="${wbEsc(t.title)}" onchange="WB.updateTaskField('${t.id}','title',this.value)">
      <div class="wb-form-grid">
        <div><label>所属项目</label><select class="wb-input" onchange="WB.updateTaskProject('${t.id}',this.value)">${state.projects.map((p) => `<option value="${p.id}" ${p.id === t.projectId ? "selected" : ""}>${wbEsc(p.name)}</option>`).join("")}</select></div>
        <div><label>状态</label><select class="wb-input" onchange="WB.updateTaskField('${t.id}','status',this.value)">${["待开始", "进行中", "已完成"].map((s) => `<option value="${s}" ${t.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        <div><label>截止时间</label><input class="wb-input" value="${wbEsc(t.dueText || "")}" onchange="WB.updateTaskField('${t.id}','dueText',this.value)"></div>
        <div><label>优先级</label><select class="wb-input" onchange="WB.updateTaskField('${t.id}','priority',this.value)">${["高", "中", "低"].map((s) => `<option value="${s}" ${t.priority === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        <div><label>负责人</label><input class="wb-input" value="${wbEsc(t.owner || "")}" onchange="WB.updateTaskField('${t.id}','owner',this.value)"></div>
        <div><label>来源</label><input class="wb-input" value="${wbEsc(t.source || "")}" onchange="WB.updateTaskField('${t.id}','source',this.value)"></div>
      </div>
      <label>备注</label>
      <textarea class="wb-input" rows="3" onchange="WB.updateTaskField('${t.id}','note',this.value)">${wbEsc(t.note || "")}</textarea>
      <div class="wb-panel-flat">
        <h4>进展记录</h4>
        ${t.progressRecords && t.progressRecords.length ? t.progressRecords.map((r) => `<div class="wb-progress-item"><b>${wbEsc(fmtMDHM(r.createdAt))}</b>${r.statusChange ? `<span class="wb-tag">${wbEsc(r.statusChange)}</span>` : ""}<p>${wbEsc(r.content)}</p></div>`).join("") : '<p class="wb-empty">暂无进展记录。</p>'}
        <label>新增进展</label>
        <textarea class="wb-input" id="wb-progress-text" rows="2" placeholder="写下这条任务的进展"></textarea>
        <select class="wb-input" id="wb-progress-status"><option value="">不更新状态</option><option value="进行中">进行中</option><option value="已完成">已完成</option></select>
        <div class="wb-actions-row"><button class="ghost-btn btn-sm" type="button" onclick="WB.saveProgress('${t.id}')">保存进展</button></div>
      </div>
      <div class="wb-panel-flat">
        <h4>附件 / 截图留痕</h4>
        <div class="wb-dropzone" id="wb-task-dropzone" onclick="document.getElementById('wb-task-file').click()" ondragover="event.preventDefault()" ondrop="WB.dropTaskFiles(event,'${t.id}')">
          <b>+</b><strong>拖拽图片、截图或文件到这里</strong><span>点击可选择文件，也支持粘贴截图。浏览器本地版会保留附件记录。</span>
        </div>
        <input type="file" id="wb-task-file" class="hidden" multiple onchange="WB.addTaskFiles(event,'${t.id}')">
        ${t.attachments && t.attachments.length ? t.attachments.map((a) => `<div class="wb-attachment"><span>${wbEsc(a.name)}</span><em>${wbEsc(a.status)}</em>${a.url && a.type.startsWith("image/") ? `<img src="${a.url}" alt="${wbEsc(a.name)}">` : ""}</div>`).join("") : ""}
      </div>
      <div class="wb-actions-row"><button class="ghost-btn wb-danger" type="button" onclick="WB.deleteTask('${t.id}')">删除任务</button></div>`;
    box.innerHTML = html;
    wb$("#wb-task-modal").classList.remove("hidden");
  }

  function renderProjectModal() {
    const box = wb$("#wb-project-body");
    const p = state.projects.find((x) => x.id === selectedProjectId);
    if (!p || !box) return;
    let html = `<h3>${wbEsc(p.name)}${p.isDefault ? ' <span class="wb-pill wb-pill-orange">系统默认</span>' : ""}</h3>
      <p class="wb-subtle">${wbEsc(p.description || "暂无说明")}</p>
      <div class="wb-form-grid">
        <div><label>开始日期</label><input type="date" class="wb-input" value="${wbEsc(p.startDate)}" onchange="WB.updateProjectField('${p.id}','startDate',this.value)"></div>
        <div><label>结束日期</label><input type="date" class="wb-input" value="${wbEsc(p.endDate)}" onchange="WB.updateProjectField('${p.id}','endDate',this.value)"></div>
      </div>
      <div class="wb-actions-row"><button class="ghost-btn btn-sm" type="button" onclick="WB.selectFolder('${p.id}')">${p.localFolderName ? "已选：" + wbEsc(p.localFolderName) : "选择本地资料文件夹"}</button></div>
      <div class="wb-panel-flat">
        <h4>项目阶段</h4>
        ${(p.phases || []).length ? p.phases.map((ph, i) => `<div class="wb-phase-row">
          <input class="wb-input" placeholder="阶段名称" value="${wbEsc(ph.name)}" onchange="WB.updatePhase('${p.id}','${ph.id}','name',this.value)">
          <input type="date" class="wb-input" value="${wbEsc(ph.startDate)}" onchange="WB.updatePhase('${p.id}','${ph.id}','startDate',this.value)">
          <input type="date" class="wb-input" value="${wbEsc(ph.endDate)}" onchange="WB.updatePhase('${p.id}','${ph.id}','endDate',this.value)">
          <button class="ghost-btn btn-sm" type="button" onclick="WB.removePhase('${p.id}','${ph.id}')">删除</button>
        </div>`).join("") : '<p class="wb-empty">还没有阶段，可添加项目阶段排期。</p>'}
        <div class="wb-actions-row"><button class="ghost-btn btn-sm" type="button" onclick="WB.addPhase('${p.id}')">+ 添加阶段</button></div>
      </div>
      <div class="wb-panel-flat">
        <h4>项目记录</h4>
        ${(p.records || []).length ? p.records.map((r) => `<div class="wb-progress-item"><b>${wbEsc(fmtMDHM(r.createdAt))}</b><p>${wbEsc(r.content)}</p>${(r.attachments || []).map((a) => `<span class="wb-tag">${wbEsc(a.name)}</span>`).join("")}</div>`).join("") : '<p class="wb-empty">暂无项目记录。</p>'}
        <textarea class="wb-input" id="wb-project-record-text" rows="2" placeholder="记录项目进展、会议结论、重要信息"></textarea>
        <div class="wb-actions-row"><button class="ghost-btn btn-sm" type="button" onclick="WB.saveProjectRecord('${p.id}')">保存项目记录</button></div>
      </div>`;
    box.innerHTML = html;
    wb$("#wb-project-modal").classList.remove("hidden");
  }

  function renderAiModal(withChecklist) {
    const box = wb$("#wb-ai-body");
    if (!box) return;
    const onboarding = state.onboarding;
    const inProgress = onboarding.status === "in_progress";
    const instruction = INITIAL_INSTRUCTION
      .replace("{{CURRENT_DATE}}", todayStr())
      .replace("{{TOMORROW_DATE}}", addDaysStr(todayStr(), 1));
    let html = "";
    if (inProgress && withChecklist) {
      const steps = ["选择常用 AI", "发送工作台初始指令", "录入第一条任务"];
      html += `<section class="wb-checklist">
        <div class="wb-checklist-head"><h2>开始使用项目工作台</h2><b>${onboarding.step - 1} / 3</b></div>
        ${steps.map((s, i) => {
          const n = i + 1;
          const cls = n < onboarding.step ? "complete" : n === onboarding.step ? "current" : "";
          return `<div class="wb-checklist-item ${cls}"><span>${n < onboarding.step ? "已完成" : "第 " + n + " 步"}</span><b>${s}</b></div>`;
        }).join("")}
      </section>`;
    }
    html += `<div class="wb-panel-flat">
      <h4>常用 AI</h4>
      <div class="wb-ai-choice">${Object.keys(AI_URLS).map((k) => `<button class="wb-ai-option ${aiSelected === k ? "active" : ""}" type="button" onclick="WB.selectAi('${k}')">${k}${aiSelected === k ? " <span>当前</span>" : ""}</button>`).join("")}</div>
      <div class="wb-actions-row">
        <button class="primary-btn" type="button" onclick="WB.openAi()">打开 AI</button>
        <button class="ghost-btn" type="button" onclick="WB.copyInstruction(true)">复制工作台初始指令</button>
        <button class="ghost-btn" type="button" onclick="WB.gotoIntake()">去录入任务</button>
      </div>
      <p class="wb-subtle">已打开 AI 助手窗口，如未自动显示在右侧，可手动拖到屏幕右侧使用。</p>
      <details><summary>查看初始指令</summary><pre class="wb-instruction">${wbEsc(instruction)}</pre></details>
    </div>`;
    box.innerHTML = html;
    wb$("#wb-ai-modal").classList.remove("hidden");
  }

  function openAiModal(withChecklist) {
    if (withChecklist && state.onboarding.status === "not_started") {
      state.onboarding = { status: "in_progress", step: 1 };
      save();
    }
    renderAiModal(withChecklist);
  }

  function closeModals() {
    wb$$(".modal-mask").forEach((m) => m.classList.add("hidden"));
  }

  /* ================= 事件 ================= */
  function bind() {
    wb$$(".wb-nav-item").forEach((b) => b.addEventListener("click", () => setWbView(b.dataset.wb)));
    wb$("#wb-guide-close") && wb$("#wb-guide-close").addEventListener("click", () => dismissGuide(wbView));
    wb$("#wb-notepad-btn") && wb$("#wb-notepad-btn").addEventListener("click", () => {
      notepadText = "";
      wb$("#wb-notepad-input").value = "";
      wb$("#wb-notepad-modal").classList.remove("hidden");
      wb$("#wb-notepad-input").focus();
    });
    wb$("#wb-ai-btn") && wb$("#wb-ai-btn").addEventListener("click", () => openAiModal(true));
    wb$("#wb-intake-btn") && wb$("#wb-intake-btn").addEventListener("click", () => setWbView("intake"));
    wb$("#wb-notepad-input") && wb$("#wb-notepad-input").addEventListener("input", (e) => { notepadText = e.target.value; });
    wb$("#wb-notepad-save") && wb$("#wb-notepad-save").addEventListener("click", () => {
      const text = notepadText.trim();
      if (!text) { toast("请先填写记事本内容", true); return; }
      state.inbox = [{
        id: wbUid("inbox"),
        title: "记事本",
        preview: text,
        time: "刚刚",
        attachments: [],
        createdAt: new Date().toISOString()
      }].concat(state.inbox);
      save();
      notepadText = "";
      wb$("#wb-notepad-modal").classList.add("hidden");
      setWbView("home");
      toast("已保存到记事本待整理");
    });
    wb$("#wb-new-project-save") && wb$("#wb-new-project-save").addEventListener("click", () => {
      addProject(wb$("#wb-new-project-name").value, wb$("#wb-new-project-desc").value);
      wb$("#wb-new-project-name").value = "";
      wb$("#wb-new-project-desc").value = "";
    });
    wb$("#wb-import-file") && wb$("#wb-import-file").addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    });
    wb$$(".wb-modal-cancel").forEach((b) => b.addEventListener("click", closeModals));
  }

  /* ================= 对外 API（供渲染 HTML 内联事件调用） ================= */
  window.WB = {
    gotoIntake() { setWbView("intake"); closeModals(); },
    scrollTo(id) { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); },
    openTask(id) { selectedTaskId = id; renderTaskModal(); },
    deleteTask(id) { deleteTasks([id]); closeModals(); },
    openProject(id) { selectedProjectId = id; renderProjectModal(); },
    openNewProject() { wb$("#wb-new-project-modal").classList.remove("hidden"); },
    completeTask,
    updateTaskField(id, field, value) { updateTask(id, { [field]: value }); },
    updateTaskProject(id, projectId) {
      const p = state.projects.find((x) => x.id === projectId);
      if (!p) return;
      updateTask(id, { projectId: p.id, projectName: p.name, classificationStatus: "已归类" });
    },
    updateProjectField(id, field, value) { updateProject(id, { [field]: value }); },
    addPhase: addProjectPhase,
    updatePhase: updateProjectPhase,
    removePhase: removeProjectPhase,
    selectFolder: selectProjectFolder,
    saveProjectRecord(id) {
      const ta = wb$("#wb-project-record-text");
      addProjectRecord(id, ta ? ta.value : "", []);
      if (ta) ta.value = "";
    },
    saveProgress(taskId) {
      const ta = wb$("#wb-progress-text");
      const sel = wb$("#wb-progress-status");
      addProgress(taskId, ta ? ta.value : "", sel ? sel.value : "", []);
      if (ta) ta.value = "";
    },
    addTaskFiles(e, taskId) { if (e.target.files) addAttachments(taskId, e.target.files); },
    dropTaskFiles(e, taskId) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files) addAttachments(taskId, e.dataTransfer.files);
    },
    setFilter(kind, value) {
      if (kind === "search") {
        filters.search = value;
        window.__wbSearchFocused = document.activeElement && document.activeElement.id === "wb-search-input";
      }
      if (kind === "tab") { filters.tab = value; selectedRows = []; }
      if (kind === "project") { filters.project = value; selectedRows = []; }
      if (kind === "status") { filters.status = value; selectedRows = []; }
      renderTasks();
      window.__wbSearchFocused = false;
    },
    toggleRow(id) {
      selectedRows = selectedRows.includes(id) ? selectedRows.filter((x) => x !== id) : selectedRows.concat([id]);
      renderTasks();
    },
    batchComplete() { selectedRows.forEach((id) => completeTask(id)); selectedRows = []; },
    batchMove() {
      const sel = wb$("#wb-batch-project");
      const p = state.projects.find((x) => x.id === (sel ? sel.value : ""));
      if (p) {
        selectedRows.forEach((id) => updateTask(id, { projectId: p.id, projectName: p.name, classificationStatus: "已归类" }));
        selectedRows = [];
      }
    },
    batchDelete() { deleteTasks(selectedRows); },
    setProjectTab(t) { projectTab = t; renderProjects(); },
    setReportTab(t) { reportTab = t; renderReports(); },
    setRange(r) { reportRange = r; renderReports(); },
    setCustom(kind, v) { if (kind === "start") rangeStart = v; else rangeEnd = v; renderReports(); },
    setReportProject(id) { reportProject = id; renderReports(); },
    copyGenerated() {
      const full = window.__wbReportFull || "";
      copyText(full, "已复制，可粘贴到微信 / 飞书 / 邮件");
    },
    copyReport() {
      const draft = buildReport(state.tasks, "all", { start: todayStr(), end: todayStr() });
      copyText("今天 日报\n\n" + draft, "已复制日报草稿");
    },
    saveReport() {
      const full = window.__wbReportFull || "";
      if (!full.trim()) { toast("当前范围暂无可保存内容", true); return; }
      const range = rangeCalc(reportRange, rangeStart, rangeEnd);
      const isWeekly = reportTab === "weekly";
      state.reports = [{
        id: wbUid("report"),
        date: todayStr(),
        title: rangeLabel(reportRange) + " " + (isWeekly ? "周报" : "日报"),
        content: full,
        type: isWeekly ? "weekly" : "daily",
        projectId: reportProject === "all" ? undefined : reportProject,
        rangeStart: range.start,
        rangeEnd: range.end,
        createdAt: new Date().toISOString()
      }].concat(state.reports);
      save();
      renderReports();
      toast("已保存记录");
    },
    copyHistory(id) {
      const r = state.reports.find((x) => x.id === id);
      if (r) copyText(r.title + "\n\n" + r.content, "已复制");
    },
    selectAi(k) { aiSelected = k; state.defaultAi = k; state.aiConfigured = true; save(); if (state.onboarding.status === "in_progress" && state.onboarding.step === 1) { state.onboarding.step = 2; save(); } renderAiModal(true); },
    openAi() {
      const url = AI_URLS[aiSelected] || AI_URLS.DeepSeek;
      const left = Math.max(0, (window.screen.availWidth || 1440) - Math.min(600, Math.max(520, Math.floor((window.screen.availWidth || 1440) * 0.35))));
      const features = ["popup=yes", "width=" + Math.min(600, Math.max(520, Math.floor((window.screen.availWidth || 1440) * 0.35))),
        "height=" + (window.screen.availHeight || 900), "left=" + left, "top=0", "resizable=yes", "scrollbars=yes", "menubar=no", "toolbar=no", "location=yes", "status=no"].join(",");
      const win = window.open("about:blank", "workbench_ai_side_window", features);
      if (!win) { toast("浏览器拦截了 AI 窗口，请允许弹窗后重试", true); return; }
      win.location.href = url;
    },
    copyInstruction(advance) {
      const instruction = INITIAL_INSTRUCTION
        .replace("{{CURRENT_DATE}}", todayStr())
        .replace("{{TOMORROW_DATE}}", addDaysStr(todayStr(), 1));
      copyText(instruction, "工作台初始指令已复制").then((ok) => {
        if (ok && advance && state.onboarding.status === "in_progress" && state.onboarding.step === 2) {
          state.onboarding.step = 3;
          save();
          renderAiModal(true);
        }
      });
    },
    openSupport() { wb$("#wb-support-modal").classList.remove("hidden"); },
    saveDefaultAi() {
      const sel = wb$("#wb-ai-select");
      saveDefaultAi(sel ? sel.value : aiSelected);
    },
    restartOnboarding,
    exportData,
    pickImport() { wb$("#wb-import-file").click(); },
    clearData: clearBusinessData,
    generatePreview() {
      previewTasks = parseIntakeText(intakeText, state.projects);
      if (!previewTasks.length) { toast("没有识别到可导入任务", true); return; }
      renderIntake();
      toast("已生成 " + previewTasks.length + " 条任务预览");
    },
    togglePreview(i) { previewTasks[i].selected = !previewTasks[i].selected; renderIntake(); },
    editPreview(i, field, value) {
      if (field === "title") previewTasks[i].title = value;
      if (field === "dueText") previewTasks[i].dueText = value;
      save();
    },
    editPreviewProject(i, projectId) {
      const p = state.projects.find((x) => x.id === projectId);
      if (!p) return;
      previewTasks[i].projectId = p.id;
      previewTasks[i].projectName = p.name;
      previewTasks[i].classificationStatus = p.name === "个人待办" && previewTasks[i].classificationStatus === "待归类" ? "待归类" : "已归类";
      renderIntake();
    },
    importPreview() {
      const selected = previewTasks.filter((p) => p.selected);
      if (!selected.length) { toast("请至少选择一条任务", true); return; }
      const now = new Date().toISOString();
      const tasks = selected.map((p) => Object.assign({}, p, {
        id: wbUid("task"),
        status: "待开始",
        createdAt: now,
        progressRecords: [],
        attachments: []
      }));
      state.tasks = tasks.concat(state.tasks);
      const completing = state.onboarding.status === "in_progress" && state.onboarding.step === 3;
      if (completing) state.onboarding = { status: "completed", step: 3 };
      save();
      previewTasks = [];
      intakeText = "";
      wbView = "tasks";
      renderWorkbench();
      toast(completing ? "基础设置完成。以后可以随时打开 AI 助手，整理工作信息并录入任务。" : "任务已录入，后续可在任务清单或项目管理中归类到具体项目。");
    },
    openAttention() {
      const groups = homeGroups(state.tasks, state.todoOrder);
      const items = groups.overdue.concat(groups.soon);
      if (items.length) {
        selectedTaskId = items[0].id;
        renderTaskModal();
      } else {
        toast("暂无需要特别关注的事项");
      }
    }
  };

  /* ================= 启动 ================= */
  load();
  bind();
  window.renderWorkbench = function () {
    if (!state) load();
    renderWorkbench();
  };
})();
