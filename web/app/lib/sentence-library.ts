// PCIC is a teaching reference for these original examples, not their textual source.
// Review each item's function, grammar and topic in the A1–A2 inventories below.
export const pcicInventories = {
  function: "https://cvc.cervantes.es/ensenanza/biblioteca_ele/plan_curricular/niveles/05_funciones_inventario_a1-a2.htm",
  grammar: "https://cvc.cervantes.es/ensenanza/biblioteca_ele/plan_curricular/niveles/02_gramatica_inventario_a1-a2.htm",
  topic: "https://cvc.cervantes.es/ensenanza/biblioteca_ele/plan_curricular/niveles/09_nociones_especificas_inventario_a1-a2.htm",
} as const;

export type LibrarySentence = {
  id: string;
  sentence: string;
  translation: string;
  level: "A1" | "A2";
  difficulty: "A1" | "A2";
  scene: string;
  grammarPoint: string;
  source: string;
  pcic: { function: string; grammar: string; topic: string };
};

type OriginalSentence = Omit<LibrarySentence, "difficulty" | "source">;
const original = (item: OriginalSentence): LibrarySentence => ({
  ...item,
  difficulty: item.level,
  source: "项目原创（参照 PCIC）",
});

export const librarySentences: LibrarySentence[] = [
  original({ id: "intro-01", sentence: "Hola, soy Clara y vivo en Sevilla.", translation: "你好，我是克拉拉，住在塞维利亚。", level: "A1", scene: "问候与介绍", grammarPoint: "ser / estar", pcic: { function: "1.1 Identificar", grammar: "12.1 El núcleo（ser）", topic: "3.1 Datos personales" } }),
  original({ id: "intro-02", sentence: "Mi amiga Ana estudia español.", translation: "我的朋友安娜学习西班牙语。", level: "A1", scene: "问候与介绍", grammarPoint: "现在时", pcic: { function: "1.1 Identificar", grammar: "9.1.1 Presente", topic: "3.1 Datos personales" } }),
  original({ id: "intro-03", sentence: "¿Cómo se llama tu profesor?", translation: "你的老师叫什么名字？", level: "A1", scene: "问候与介绍", grammarPoint: "疑问句", pcic: { function: "1.2 Pedir información（persona）", grammar: "13.3 Interrogativas directas", topic: "3.1.1 Nombre" } }),
  original({ id: "intro-04", sentence: "Mi hermana es profesora de música.", translation: "我姐姐是音乐老师。", level: "A1", scene: "问候与介绍", grammarPoint: "ser / estar", pcic: { function: "1.3 Dar información（datos personales）", grammar: "12.1 El núcleo（ser）", topic: "3.1.9 Profesión" } }),

  original({ id: "daily-01", sentence: "Estudio español en casa por la tarde.", translation: "我下午在家学西班牙语。", level: "A1", scene: "日常与学习", grammarPoint: "现在时", pcic: { function: "1.3 Dar información", grammar: "9.1.1 Presente", topic: "6. Educación" } }),
  original({ id: "daily-02", sentence: "El cuaderno está en la mesa.", translation: "笔记本在桌上。", level: "A1", scene: "日常与学习", grammarPoint: "ser / estar", pcic: { function: "1.3 Dar información（lugar）", grammar: "12.1 El núcleo（estar）", topic: "6. Educación" } }),
  original({ id: "daily-03", sentence: "Hay tres libros en mi mochila.", translation: "我的背包里有三本书。", level: "A1", scene: "日常与学习", grammarPoint: "存在句 hay", pcic: { function: "1.3 Dar información（cosa）", grammar: "13.3 Impersonales con haber", topic: "6. Educación" } }),
  original({ id: "daily-04", sentence: "¿Dónde estudias español?", translation: "你在哪里学西班牙语？", level: "A1", scene: "日常与学习", grammarPoint: "疑问句", pcic: { function: "1.2 Pedir información（lugar）", grammar: "13.3 Interrogativas directas", topic: "6. Educación" } }),

  original({ id: "travel-01", sentence: "¿Dónde está la parada de autobús?", translation: "公交车站在哪里？", level: "A1", scene: "问路与出行", grammarPoint: "疑问句", pcic: { function: "1.2 Pedir información（lugar）", grammar: "13.3 Interrogativas directas", topic: "14.3 Sistema de transporte" } }),
  original({ id: "travel-02", sentence: "La estación está cerca del hotel.", translation: "车站在酒店附近。", level: "A1", scene: "问路与出行", grammarPoint: "ser / estar", pcic: { function: "1.3 Dar información（lugar）", grammar: "12.1 El núcleo（estar）", topic: "14.2 Alojamiento" } }),
  original({ id: "travel-03", sentence: "Voy al museo con mi padre.", translation: "我和父亲去博物馆。", level: "A1", scene: "问路与出行", grammarPoint: "现在时", pcic: { function: "1.3 Dar información", grammar: "9.1.1 Presente（ir）", topic: "14.1 Viajes" } }),
  original({ id: "travel-04", sentence: "Mañana voy al parque con mis amigos.", translation: "明天我和朋友们去公园。", level: "A2", scene: "问路与出行", grammarPoint: "现在时", pcic: { function: "1.3 Dar información", grammar: "9.1.1 Presente（valor de futuro）", topic: "8.1 Tiempo libre y entretenimiento" } }),

  original({ id: "food-01", sentence: "Un té con leche, por favor.", translation: "请给我一杯加奶的茶。", level: "A1", scene: "餐饮", grammarPoint: "名词短语", pcic: { function: "4.3 Pedir objetos", grammar: "3.2 El artículo indefinido", topic: "5.2 Bebida" } }),
  original({ id: "food-02", sentence: "Como fruta por la mañana.", translation: "我早上吃水果。", level: "A1", scene: "餐饮", grammarPoint: "现在时", pcic: { function: "1.3 Dar información", grammar: "9.1.1 Presente", topic: "5.1 Dieta y nutrición" } }),
  original({ id: "food-03", sentence: "¿Hay pan en la cocina?", translation: "厨房里有面包吗？", level: "A1", scene: "餐饮", grammarPoint: "存在句 hay", pcic: { function: "1.2 Pedir información（cosa）", grammar: "13.3 Impersonales con haber", topic: "5. Alimentación" } }),
  original({ id: "food-04", sentence: "Me gusta comer sopa en casa.", translation: "我喜欢在家喝汤。", level: "A1", scene: "餐饮", grammarPoint: "gustar", pcic: { function: "3.2 Expresar gustos e intereses", grammar: "12.1 El núcleo（gustar）", topic: "5.5 Platos" } }),

  original({ id: "shop-01", sentence: "Esta camisa es azul.", translation: "这件衬衫是蓝色的。", level: "A1", scene: "购物", grammarPoint: "ser / estar", pcic: { function: "1.3 Dar información（cosa）", grammar: "12.1 El núcleo（ser）", topic: "12.2 Ropa, calzado y complementos" } }),
  original({ id: "shop-02", sentence: "¿Cuánto cuesta este libro?", translation: "这本书多少钱？", level: "A2", scene: "购物", grammarPoint: "疑问句", pcic: { function: "1.2 Pedir información（cantidad）", grammar: "13.3 Interrogativas directas", topic: "12.4 Pagos" } }),
  original({ id: "shop-03", sentence: "La tienda está en esta calle.", translation: "商店在这条街上。", level: "A1", scene: "购物", grammarPoint: "ser / estar", pcic: { function: "1.3 Dar información（lugar）", grammar: "12.1 El núcleo（estar）", topic: "12.1 Lugares, personas y actividades" } }),
  original({ id: "shop-04", sentence: "Prefiero la camisa verde.", translation: "我更喜欢那件绿色衬衫。", level: "A2", scene: "购物", grammarPoint: "现在时", pcic: { function: "3.5 Expresar preferencias", grammar: "9.1.1 Presente（irregularidades frecuentes）", topic: "12.2 Ropa, calzado y complementos" } }),

  original({ id: "hobby-01", sentence: "Me gusta escuchar música en casa.", translation: "我喜欢在家听音乐。", level: "A1", scene: "兴趣", grammarPoint: "gustar", pcic: { function: "3.2 Expresar gustos e intereses", grammar: "12.1 El núcleo（gustar）", topic: "8.1 Tiempo libre y entretenimiento" } }),
  original({ id: "hobby-02", sentence: "Mi hermano lee libros de historia.", translation: "我哥哥读历史书。", level: "A1", scene: "兴趣", grammarPoint: "现在时", pcic: { function: "1.3 Dar información", grammar: "9.1.1 Presente", topic: "8.1 Tiempo libre y entretenimiento" } }),
  original({ id: "hobby-03", sentence: "¿Qué tipo de libros te gusta leer?", translation: "你喜欢读哪类书？", level: "A2", scene: "兴趣", grammarPoint: "gustar", pcic: { function: "3.1 Preguntar por gustos e intereses", grammar: "12.1 El núcleo（gustar）", topic: "8.1 Tiempo libre y entretenimiento" } }),
  original({ id: "hobby-04", sentence: "Siempre estudio español antes de escuchar música.", translation: "我总是在听音乐前学西班牙语。", level: "A2", scene: "兴趣", grammarPoint: "现在时", pcic: { function: "1.3 Dar información（tiempo, frecuencia）", grammar: "9.1.1 Presente（valor habitual）", topic: "8.1 Tiempo libre y entretenimiento" } }),
];

export type LibraryFilters = { difficulty: string; scene: string; grammarPoint: string };
export const initialLibraryFilters: LibraryFilters = { difficulty: "", scene: "", grammarPoint: "" };

export function filterLibrarySentences(sentences: LibrarySentence[], filters: LibraryFilters) {
  return sentences.filter((item) => (!filters.difficulty || item.difficulty === filters.difficulty)
    && (!filters.scene || item.scene === filters.scene)
    && (!filters.grammarPoint || item.grammarPoint === filters.grammarPoint));
}

export function pickRandomSentence(sentences: LibrarySentence[], random = Math.random) {
  return sentences.length ? sentences[Math.min(Math.floor(random() * sentences.length), sentences.length - 1)] : null;
}
