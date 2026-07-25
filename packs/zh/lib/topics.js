/**
 * Topic tagging (Phase 11 §1): honest topics, by rule, not raw substring.
 *
 * The old draft matched topic keywords as substrings against a word's WHOLE definition list, so
 * 电话 ("...phone number") fell into "numbers" and every "this year" into "time". This tags by:
 *   1. a closed-class CORE list — function/structure words (pronouns, particles, copulas,
 *      measure words, conjunctions, coverbs, degree/negation adverbs) are topic-LESS by law;
 *   2. an explicit curated membership for the bands the learner lives in (the reviewable data,
 *      the part the maintainer reads);
 *   3. head-term keyword rules against a word's PRIMARY sense, guarded by a poison-substring
 *      trap list, for the long tail;
 *   4. a single strongest "home" topic per word (priority order), with the rest kept as
 *      secondary topics for Browse only.
 * Ordered topics (numbers, time, weekdays, months) carry an explicit sequence.
 *
 * Pure and deterministic: same deck + rules ⇒ byte-identical topics.json.
 */

/* ── Ordered topics: an inherent sequence Browse and units honour ── */
const NUMBER_ORDER = ['零', '一', '二', '两', '三', '四', '五', '六', '七', '八', '九', '十', '百', '千', '万', '半', '一半', '第'];
const TIME_ORDER = [
  '秒', '分', '分钟', '点', '刻', '时', '小时', '时候', '时间',
  '早', '早上', '早晨', '上午', '中午', '下午', '晚', '晚上', '白天', '夜',
  '昨天', '今天', '明天', '天', '日', '号', '周', '星期', '星期日', '星期天', '周末',
  '月', '年', '今年', '明年', '去年', '岁', '现在', '过去', '将来',
  '生日', '过年', '从小', '小时候', '一会儿', '有时候',
];

/**
 * The closed class: function and structure words. Topic-less by law — they are CORE (§2), the
 * connective tissue, and must never wear a topical costume.
 */
const CORE = new Set([
  // personal / demonstrative pronouns and plural marker
  '我', '你', '您', '他', '她', '它', '我们', '你们', '他们', '她们', '它们', '们', '大家', '自己', '别人',
  '这', '那', '这个', '那个', '这里', '那里', '这儿', '那儿', '这边', '那边', '这些', '那些', '这么', '那么', '这样', '那样', '每',
  // particles, aspect, structural
  '的', '了', '吗', '呢', '吧', '啊', '着', '过', '地', '得', '所', '被', '把', '连', '之', '来着',
  '一下', '一点儿', '一些', '有点儿', '有一点儿', '起来', '下去', '些',
  // copulas, auxiliaries, modals
  '是', '会', '能', '可以', '要', '应该', '得', '可能', '快要', '正在', '已经', '正', '在',
  // conjunctions / connectives
  '和', '跟', '与', '同', '或', '或者', '但', '但是', '可是', '不过', '因为', '所以', '虽然', '还是', '如果', '要是', '而', '而且', '并且', '然后', '就是', '因此', '于是', '并',
  // coverbs / prepositions
  '把', '被', '从', '往', '向', '离', '比', '让', '叫', '用', '给', '对', '为', '按', '据', '朝', '沿',
  // adverbs of degree / negation / frequency / manner
  '不', '没', '没有', '别', '很', '太', '都', '也', '还', '就', '才', '只', '再', '最', '真', '非常', '经常', '常常', '总是', '一起', '一直', '刚', '刚才', '马上', '忽然', '突然', '当然', '大概', '也许', '其实', '差不多', '几乎', '甚至', '越', '更', '挺', '特别', '尤其', '至少', '差点儿', '曾经',
  // basic modifiers with no topical home
  '多', '少', '大', '小', '长', '短', '高', '矮', '快', '慢', '新', '旧', '好', '坏', '对', '错', '真', '假', '同样', '一样', '一定', '主要', '重要',
  '漂亮', '好看', '好听', '不错', '近', '远', '不要',
  // localizers and their compounds — spatial structure, not a place
  '上', '下', '前', '后', '里', '外', '左', '右', '中', '内', '间', '旁', '边',
  '上面', '下面', '前面', '后面', '里面', '外面', '左边', '右边', '外边', '旁边',
  // generic pro-nouns, quantifiers, and light classifiers
  '东西', '事', '事情', '意思', '本', '件', '条', '位', '次', '张', '只', '双', '份', '有的', '有些', '一些', '别的', '其他', '所有',
  // interjections / greetings-fragments handled as core fillers
  '喂', '嗯', '哦', '哈', '哎',
]);

/** Interrogatives form their own coherent set (kept as a topic, useful for Browse and a unit). */
const INTERROGATIVES = new Set([
  '谁', '什么', '哪', '哪个', '哪里', '哪儿', '哪些', '几', '多少', '怎么', '怎么样', '为什么', '几点', '多久', '多长', '请问',
]);

/**
 * Curated home topics for the bands the maintainer reviews. Each word listed here IS a member
 * of that topic — literal, not inferred. Ordered by priority: the first topic that claims a word
 * is its home; later topics that also match become secondary (Browse only).
 */
const CURATED = {
  numbers: NUMBER_ORDER,
  time: TIME_ORDER,
  colors: ['颜色', '白色', '黑色', '红色', '绿色', '蓝色', '黄色', '红', '白', '黑', '绿', '蓝', '黄', '灰', '粉'],
  questions: [...INTERROGATIVES],
  people: [
    '人', '男', '女', '男人', '女人', '孩子', '小孩儿', '男孩儿', '女孩儿', '小朋友',
    '爸爸', '妈妈', '哥哥', '姐姐', '弟弟', '妹妹', '儿子', '女儿', '家人', '奶奶', '爷爷', '丈夫', '妻子', '父母', '父亲', '母亲', '哥', '姐', '叔叔', '阿姨',
    '朋友', '男朋友', '女朋友', '老师', '学生', '同学', '医生', '先生', '女士', '小姐', '大人', '大家庭', '名字', '姓', '姓名', '名', '个子',
  ],
  clothes: ['衣服', '裤子', '穿', '帽子', '裙子', '鞋', '袜子', '衬衫', '大衣', '外套'],
  sports: ['篮球', '足球', '球', '游泳', '跑步', '运动', '踢', '打球', '比赛', '锻炼', '爬山'],
  home: ['椅子', '桌子', '床', '灯', '窗', '沙发', '冰箱', '空调', '电灯', '书桌'],
  animals: ['狗', '猫', '鸟', '鱼', '马', '牛', '羊', '猪', '鸡', '兔', '虫', '熊猫', '动物'],
  food: [
    '菜', '茶', '饭', '米饭', '面包', '面条儿', '鸡蛋', '牛奶', '奶茶', '红茶', '绿茶', '水果', '苹果', '咖啡', '肉', '包子', '饺子', '杯子',
    '早饭', '午饭', '晚饭', '吃', '喝', '好吃', '做饭', '水',
  ],
  body: ['身体', '手', '眼睛', '头', '脚', '腿', '嘴', '耳朵', '鼻子', '脸', '牙', '病', '药', '疼', '生病', '看病', '休息', '累', '舒服', '医院', '医生', '药店'],
  weather: ['天气', '雨', '下雨', '雪', '下雪', '晴', '阴', '热', '冷', '天', '风', '云', '花', '树', '山', '河'],
  tech: ['电脑', '电话', '手机', '电视', '电影', '网上', '上网', '打电话', '网络', '手表'],
  travel: ['车', '火车', '飞机', '出租车', '公交车', '公交', '地铁', '机票', '票', '门票', '旅游', '站', '车站', '机场', '路', '路上'],
  money: ['钱', '元', '块', '买', '卖', '贵', '便宜', '商店', '商场', '超市', '价格', '花', '付'],
  places: [
    '学校', '医院', '商店', '饭店', '饭馆', '书店', '电影院', '公司', '家', '房间', '教室', '酒店', '门', '门口', '楼', '洗手间',
    '中国', '外国', '国', '地方', '城市', '公园', '银行', '图书馆', '厕所',
  ],
  work: [
    '工作', '上班', '下班', '公司', '老师', '学生', '学校', '学习', '学', '上课', '下课', '上学', '开学', '课', '考试', '考', '教', '教室', '同学',
    '书', '笔', '本子', '书包', '字', '汉字', '汉语', '中文', '读', '写', '读书', '大学', '小学', '中学', '高中', '大学生', '小学生', '中学生', '题', '词', '画', '开会', '会议', '问题', '班', '作业', '成绩',
  ],
  feelings: ['高兴', '快乐', '忙', '喜欢', '爱', '希望', '觉得', '想', '爱好', '难过', '生气', '害怕', '担心', '感觉', '心情', '快', '慢', '有意思', '没意思', '好玩儿'],
  verbs: [
    '看', '听', '说', '说话', '做', '坐', '走', '走路', '跑', '来', '去', '开', '开车', '玩', '唱', '问', '找', '拿', '送', '洗', '笑', '哭', '帮', '帮忙',
    '住', '睡', '睡觉', '起床', '见', '看见', '听见', '打', '打车', '打开', '跳舞', '准备', '介绍', '记得', '认识', '知道', '懂', '忘', '告诉', '让', '给',
    '出', '进', '回', '到', '过', '飞', '游', '动', '站', '卖', '买', '等', '请', '谢谢', '你好', '再见', '对不起', '没关系', '没事', '不客气', '不好意思',
    '出门', '出去', '出来', '进去', '进来', '回来', '回去', '过来', '过去', '上来', '上去', '下来', '下去', '离开', '搬', '搬家', '完', '开始', '歌',
  ],
};

/** Priority order for resolving a word's home when several topics claim it. */
const PRIORITY = [
  'numbers', 'time', 'colors', 'questions', 'animals', 'body', 'weather', 'tech',
  'food', 'clothes', 'sports', 'home', 'travel', 'money', 'people', 'work', 'places', 'feelings', 'verbs',
];

export const LABELS = {
  numbers: 'Numbers',
  time: 'Days & time',
  colors: 'Colors',
  questions: 'Question words',
  animals: 'Animals',
  body: 'Body & health',
  weather: 'Weather & nature',
  tech: 'Tech & media',
  food: 'Food & drink',
  clothes: 'Clothes',
  sports: 'Sports',
  home: 'Home & furniture',
  travel: 'Getting around',
  money: 'Money & shopping',
  people: 'People & family',
  work: 'Work & school',
  places: 'Places',
  feelings: 'Feelings',
  verbs: 'Everyday verbs',
};

/**
 * Head-term keyword rules for the long tail (bands past the curated set). Matched against a
 * word's PRIMARY definition only, and only after the trap list has removed poison senses.
 */
const KEYWORDS = {
  animals: [/\b(animal|dog|cat|bird|fish|horse|cow|pig|sheep|chicken|duck|rabbit|tiger|insect|bug)\b/],
  body: [/\b(body|health|illness|disease|medicine|hospital|doctor|hurt|ache|pain|tired|arm|leg|hand|eye|ear|nose|mouth|tooth|face|hair|skin|blood|bone)\b/],
  weather: [/\b(weather|rain|snow|wind|cloud|sunny|cloudy|storm|flower|tree|mountain|river|sky|nature)\b/],
  food: [/\b(food|dish|vegetable|fruit|meat|rice|noodle|bread|egg|milk|tea|coffee|soup|to eat|to drink|meal|breakfast|lunch|dinner|delicious)\b/],
  colors: [/\bcolou?r\b|\b(red|blue|green|yellow|black|white|gray|grey|purple|orange|pink)\b/],
  money: [/\b(money|price|cost|buy|sell|shop|store|market|cheap|expensive|pay|cash|coin|currency|yuan)\b/],
  travel: [/\b(car|train|plane|airplane|bus|subway|taxi|ticket|station|airport|road|travel|trip|tour)\b/],
  places: [/\b(school|hospital|store|shop|restaurant|hotel|room|building|city|park|bank|library|country|place|office)\b/],
  work: [/\b(work|job|study|learn|class|lesson|exam|teacher|student|school|book|write|read|character|word)\b/],
  people: [/\b(father|mother|brother|sister|son|daughter|child|friend|family|husband|wife|man|woman|person|grandpa|grandma|teacher|doctor)\b/],
  tech: [/\b(computer|phone|telephone|television|internet|online|movie|video|screen|software|website)\b/],
  clothes: [/\b(clothes|clothing|shirt|trousers|pants|skirt|dress|hat|shoe|sock|coat|jacket|to wear)\b/],
  sports: [/\b(sports?|football|soccer|basketball|volleyball|badminton|tennis|swimming|to swim|gymnastics|athletics|to jog)\b/],
  home: [/\b(chair|table|desk|bed|lamp|sofa|couch|fridge|refrigerator|furniture|window)\b/],
  feelings: [/\b(happy|sad|angry|afraid|worried|feeling|emotion|love|like|hope|enjoy|glad|joyful|nervous)\b/],
  verbs: [/^to \w+/],
};

/** Poison substrings: senses that must NOT drive a match (the 电话/号/sometimes class). */
const TRAPS = [
  'phone number', 'number of', 'a number', 'number designation',
  'sometimes', 'some time',
  'this year', 'next year', 'last year', 'new year',
  'classifier', 'measure word', 'bound form', 'particle', 'prefix', 'suffix', 'surname',
];

/** Does any definition mark this as a function word (classifier, particle, pure grammar)? */
function isFunctionWord(word) {
  const defs = word.defs ?? [];
  if (!defs.length) return false;
  const grammatical = defs.filter((d) => /(classifier|measure word|\(particle\)|plural marker|ordinal number|used (after|before|at)|possessive particle)/i.test(d));
  // A pure function word: every sense is grammatical, or it is a bare classifier/particle.
  return grammatical.length > 0 && grammatical.length >= defs.length - 1 && !CURATED_HAS(word.simp);
}

let CURATED_INDEX = null;
function curatedIndex() {
  if (CURATED_INDEX) return CURATED_INDEX;
  CURATED_INDEX = new Map();
  for (const topic of PRIORITY) {
    for (const simp of CURATED[topic] ?? []) {
      if (!CURATED_INDEX.has(simp)) CURATED_INDEX.set(simp, []);
      CURATED_INDEX.get(simp).push(topic);
    }
  }
  return CURATED_INDEX;
}
const CURATED_HAS = (simp) => curatedIndex().has(simp);

/** The definition text used for keyword matching: the primary sense, traps stripped. */
function primarySense(word) {
  for (const def of word.defs ?? []) {
    const lower = def.toLowerCase();
    if (TRAPS.some((t) => lower.includes(t))) continue; // skip a poison sense entirely
    return lower;
  }
  return '';
}

/** Every topic a word matches by keyword rule (primary sense only). */
function keywordMatches(word) {
  const sense = primarySense(word);
  if (!sense) return [];
  const hits = [];
  for (const topic of PRIORITY) {
    const rules = KEYWORDS[topic];
    if (rules && rules.some((re) => re.test(sense))) hits.push(topic);
  }
  return hits;
}

/**
 * Tag the deck.
 * @param {object[]} words deck words (need `simp`, `band`, `defs`)
 * @returns {{ topics: Record<string,string[]>, home: Record<string,string>, core: string[],
 *   labels: object, orderedTopics: Record<string, string[]>, unmapped: object[] }}
 */
export function tagTopics(words) {
  const scope = words.filter((w) => (w.band ?? 99) >= 1 && (w.band ?? 99) <= 4);
  const byId = new Map(words.map((w) => [w.id, w]));
  const curated = curatedIndex();

  const home = {}; // wordId -> topic
  const secondaryOf = {}; // wordId -> [topic]
  const core = [];
  const unmapped = [];

  for (const word of scope) {
    if (CORE.has(word.simp)) { core.push(word.id); continue; }

    // Union of curated + keyword matches, in priority order, minus itself-as-core.
    const matches = [];
    for (const topic of PRIORITY) {
      const curatedHere = (curated.get(word.simp) ?? []).includes(topic);
      const keywordHere = !CURATED_HAS(word.simp) && keywordMatches(word).includes(topic);
      if (curatedHere || keywordHere) matches.push(topic);
    }

    if (matches.length === 0) {
      if (isFunctionWord(word)) core.push(word.id);
      else unmapped.push(word);
      continue;
    }
    home[word.id] = matches[0];
    if (matches.length > 1) secondaryOf[word.id] = matches.slice(1);
  }

  // Build topic → ids, home first then secondary; order members by the topic's sequence when it
  // has one, else band then frequency-proxy (deck order via introRank/id).
  const topics = {};
  for (const topic of PRIORITY) topics[topic] = [];
  for (const [id, topic] of Object.entries(home)) topics[topic].push(id);

  const orderedTopics = { numbers: NUMBER_ORDER, time: TIME_ORDER };
  const seqIndex = (topic) => {
    const seq = orderedTopics[topic];
    if (!seq) return null;
    const rank = new Map(seq.map((simp, i) => [simp, i]));
    return (id) => rank.get(byId.get(id)?.simp) ?? seq.length + (byId.get(id)?.band ?? 9);
  };
  for (const topic of PRIORITY) {
    const order = seqIndex(topic);
    topics[topic].sort((a, b) => {
      if (order) return order(a) - order(b);
      const wa = byId.get(a); const wb = byId.get(b);
      return (wa?.band ?? 9) - (wb?.band ?? 9) || (wa?.introRank ?? 1e9) - (wb?.introRank ?? 1e9);
    });
    if (topics[topic].length === 0) delete topics[topic];
  }

  // Secondary memberships are appended (Browse only), after the home members.
  for (const [id, list] of Object.entries(secondaryOf)) {
    for (const topic of list) if (topics[topic] && !topics[topic].includes(id)) topics[topic].push(id);
  }

  return { topics, home, secondaryOf, core, unmapped, labels: LABELS, orderedTopics };
}
