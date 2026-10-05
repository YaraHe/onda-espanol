import type { FastifyReply, FastifyRequest } from "fastify";

type Verb = { form: string; infinitive: string; person: string; notes: string };
type Annotation = {
  stress: { word: string; syllable: string; display: string }[];
  liaison: { words: string; pronounced: string; note: string }[];
  pauses: { after: string; type: string }[];
  pitchPattern: string;
};

export type Explanation = {
  translation: string;
  tenseMood: string;
  verbs: Verb[];
  structure: string;
  annotation?: Annotation;
  memoryTip?: string;
  compare?: string;
};

const PROMPT = `你是面向西语初学者的讲解老师。只输出有效 JSON，不要 Markdown。
先判断输入是否为西班牙语句子：若明显不是，返回 {"isSpanish":false}。
若是，返回 isSpanish:true，并严格使用下列字段和类型：
{"isSpanish":true,"translation":"中文翻译","tenseMood":"现在时·陈述式","verbs":[{"form":"变位形式","infinitive":"原形","person":"人称","notes":"简短说明"}],"structure":"语序说明","annotation":{"stress":[{"word":"原词","syllable":"重读音节","display":"用大写标出重读音节的完整词"}],"liaison":[{"words":"相邻词","pronounced":"连读形式","note":"说明"}],"pauses":[{"after":"词","type":"短停"}],"pitchPattern":"升降调文字说明"},"memoryTip":"核心记忆点","compare":"中英对比"}。
无动词句使用 verbs:[]、tenseMood:"不适用"；无实际连读或停顿时使用空数组。tenseMood 描述动词的时态和语式，陈述式不是陈述句。
stress 只列多音节实词的真实重读音节，不把 la 等非重读冠词列入；display 保留原词拼写，仅把重读音节变成大写，例如 Hola→HOla、biblioteca→biblioTEca。
liaison 只标确有跨词音节连接的相邻词（如词尾元音接词首元音，或词尾辅音接词首元音），不要把普通的元音接辅音说成连读。
pauses 只标标点或清楚的意群边界；短句内部通常为空数组，不要把可选强调停顿写成必需停顿。pitchPattern 是教学性概述，不是实际测得的音高。
不要臆造连读、停顿或客观音高测量。中文讲解简短准确。`;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringItems<T>(value: unknown, keys: (keyof T)[]): T[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => {
    const entry = object(item);
    return entry && keys.every((key) => nonempty(entry[String(key)]));
  })) return null;
  return value as T[];
}

// Only use complete, high-confidence forms of common copular, existential and
// auxiliary verbs. Endings alone cannot distinguish verbs from nouns or adjectives
// (e.g. "son" and "era"), so avoid a suffix-based grammar guess.
const clearFiniteVerbForms = new Set([
  "soy", "eres", "es", "somos", "sois",
  "estoy", "estás", "está", "estamos", "estáis", "están",
  "hay",
]);
const finiteFormsWithClearSubjects = new Map<string, Set<string>>([
  ["son", new Set(["ellos", "ellas", "ustedes"])],
  ["sos", new Set(["vos"])],
  ["he", new Set(["yo"])],
  ["has", new Set(["tú"])],
  ["ha", new Set(["él", "ella", "usted"])],
  ["hemos", new Set(["nosotros", "nosotras"])],
  ["habéis", new Set(["vosotros", "vosotras"])],
  ["han", new Set(["ellos", "ellas", "ustedes"])],
]);

function hasClearFiniteVerb(sentence: string): boolean {
  const normalizedSentence = sentence.normalize("NFC");
  const words = [...normalizedSentence.matchAll(/\p{L}+/gu)];
  return words.some((match, index) => {
    const word = match[0].toLocaleLowerCase("es");
    if (clearFiniteVerbForms.has(word)) return true;
    const previous = words[index - 1];
    if (!previous || !/^\s*$/u.test(normalizedSentence.slice(previous.index + previous[0].length, match.index))) return false;
    const precedingWord = previous[0].toLocaleLowerCase("es");
    return finiteFormsWithClearSubjects.get(word)?.has(precedingWord) ?? false;
  });
}

function structureClearlyMentionsVerb(structure: string): boolean {
  // "无动词" / "动词省略" are descriptions of a verb-free structure, not
  // evidence that the response identified a verb in the sentence.
  return /(?:^|[\s+＋→、，,;；:：()])(?:系动词|助动词|谓语动词|动词|系词)(?=$|[\s+＋→、，,;；:：()])/u.test(structure);
}

function supportedLiaison(pair: string, sentence: string): boolean {
  const words = pair.match(/\p{L}+/gu);
  if (!words || words.length !== 2) return false;
  const sentenceWords = sentence.match(/\p{L}+/gu) ?? [];
  const adjacent = sentenceWords.some((word, index) =>
    word.toLocaleLowerCase("es") === words[0].toLocaleLowerCase("es")
      && sentenceWords[index + 1]?.toLocaleLowerCase("es") === words[1].toLocaleLowerCase("es"));
  const firstEndsWithSound = /[a-záéíóúüñ]$/iu.test(words[0]);
  const secondStartsWithVowel = /^(?:[aeiouáéíóúü]|h[aeiouáéíóúü])/iu.test(words[1]);
  return adjacent && firstEndsWithSound && secondStartsWithVowel;
}

function supportedPause(after: string, sentence: string): boolean {
  const afterWord = after.match(/\p{L}+/gu)?.at(-1)?.toLocaleLowerCase("es");
  if (!afterWord) return false;
  const matches = [...sentence.matchAll(/\p{L}+/gu)];
  return matches.some((match, index) =>
    match[0].toLocaleLowerCase("es") === afterWord
      && /[,;:—–]/u.test(sentence.slice(match.index + match[0].length, matches[index + 1]?.index)));
}

function verifiedStress(item: Annotation["stress"][number], sentence: string): Annotation["stress"][number] | null {
  const word = item.word.trim();
  const syllable = item.syllable.trim();
  const sentenceWords = sentence.match(/\p{L}+/gu) ?? [];
  if (!sentenceWords.some((entry) => entry.toLocaleLowerCase("es") === word.toLocaleLowerCase("es"))) return null;
  const index = word.toLocaleLowerCase("es").indexOf(syllable.toLocaleLowerCase("es"));
  if (index < 0 || word.toLocaleLowerCase("es").indexOf(syllable.toLocaleLowerCase("es"), index + 1) >= 0) return null;
  return {
    word,
    syllable,
    display: `${word.slice(0, index)}${word.slice(index, index + syllable.length).toLocaleUpperCase("es")}${word.slice(index + syllable.length)}`,
  };
}

function annotationFrom(value: unknown, sentence: string): Annotation | undefined {
  const entry = object(value);
  if (!entry) return undefined;
  const stress = stringItems<Annotation["stress"][number]>(entry.stress, ["word", "syllable", "display"]);
  const liaison = stringItems<Annotation["liaison"][number]>(entry.liaison, ["words", "pronounced", "note"]);
  const pauses = stringItems<Annotation["pauses"][number]>(entry.pauses, ["after", "type"]);
  if (!stress || !liaison || !pauses || !nonempty(entry.pitchPattern)) return undefined;
  return {
    stress: stress.map((item) => verifiedStress(item, sentence)).filter((item): item is Annotation["stress"][number] => item !== null),
    liaison: liaison.filter((item) => supportedLiaison(item.words, sentence)),
    pauses: pauses.filter((item) => supportedPause(item.after, sentence)),
    pitchPattern: entry.pitchPattern,
  };
}

function explanationFrom(value: unknown, sentence: string): Explanation | null {
  const entry = object(value);
  if (!entry || !nonempty(entry.translation) || !nonempty(entry.structure) || !nonempty(entry.tenseMood)) return null;
  const verbs = stringItems<Verb>(entry.verbs, ["form", "infinitive", "person", "notes"]);
  if (!verbs) return null;
  const noVerbs = verbs.length === 0;
  const noTenseMood = entry.tenseMood.trim() === "不适用";
  if (noVerbs !== noTenseMood) return null;
  if (noVerbs && (hasClearFiniteVerb(sentence) || structureClearlyMentionsVerb(entry.structure))) return null;
  const annotation = annotationFrom(entry.annotation, sentence);
  return {
    translation: entry.translation,
    tenseMood: entry.tenseMood,
    verbs,
    structure: entry.structure,
    ...(annotation && { annotation }),
    ...(nonempty(entry.memoryTip) && { memoryTip: entry.memoryTip }),
    ...(nonempty(entry.compare) && { compare: entry.compare }),
  };
}

function error(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export function createExplainHandler({
  fetcher = fetch,
  apiKey = process.env.DEEPSEEK_API_KEY,
}: { fetcher?: typeof fetch; apiKey?: string } = {}) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const body = object(request.body);
    if (!body || typeof body.sentence !== "string") {
      return error(reply, 400, "INVALID_PARAM", "请输入西班牙语句子");
    }
    const sentence = body.sentence.trim();
    if (!sentence) return error(reply, 400, "EMPTY_SENTENCE", "请输入西班牙语句子");
    if (sentence.length > 200 || sentence.split(/\s+/u).length > 30) {
      return error(reply, 400, "INVALID_PARAM", "句子过长，请缩短至 30 词且不超过 200 字符");
    }
    const lang = body.lang ?? "es-ES";
    if (lang !== "es-ES" && lang !== "es-MX") {
      return error(reply, 400, "INVALID_PARAM", "请选择有效的西语方言");
    }
    if (!apiKey) return error(reply, 502, "UPSTREAM_ERROR", "讲解服务暂时不可用，请稍后重试");

    const signal = AbortSignal.timeout(15_000);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetcher("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "deepseek-flash",
            messages: [
              { role: "system", content: PROMPT },
              { role: "user", content: `方言：${lang}\n句子：${sentence}` },
            ],
            thinking: { type: "disabled" },
            response_format: { type: "json_object" },
            max_tokens: 1800,
            stream: false,
          }),
          signal,
        });
        if (!response.ok) return error(reply, 502, "UPSTREAM_ERROR", "讲解服务暂时不可用，请稍后重试");
        const upstream: unknown = await response.json();
        const content = object(upstream)?.choices;
        const firstChoice = Array.isArray(content) ? object(content[0]) : null;
        const raw = object(firstChoice?.message)?.content;
        let parsed: unknown;
        try { parsed = typeof raw === "string" ? JSON.parse(raw) : null; } catch { parsed = null; }
        const result = object(parsed);
        if (result?.isSpanish === false) {
          return error(reply, 422, "NOT_SPANISH", "看起来不是西班牙语，请确认");
        }
        const explanation = explanationFrom(result, sentence);
        if (explanation && firstChoice?.finish_reason !== "length") return reply.send(explanation);
      } catch {
        if (signal.aborted) return error(reply, 504, "UPSTREAM_ERROR", "讲解服务响应超时，请重试");
        return error(reply, 502, "UPSTREAM_ERROR", "讲解服务暂时不可用，请稍后重试");
      }
    }
    return error(reply, 502, "EMPTY_UPSTREAM", "讲解内容不完整，请稍后重试");
  };
}
