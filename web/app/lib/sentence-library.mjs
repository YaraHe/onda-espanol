function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** @param {Array<{id:string, sentence:string, translation:string|null, identity_key:string, created_at:string}>} sentences */
export function groupPersonalSentences(sentences) {
  const months = new Map();
  for (const sentence of sentences) {
    const dateKey = localDateKey(sentence.created_at);
    const monthKey = dateKey === "unknown" ? "unknown" : dateKey.slice(0, 7);
    if (!months.has(monthKey)) {
      const [year, month] = monthKey === "unknown" ? [null, null] : monthKey.split("-").map(Number);
      months.set(monthKey, {
        key: monthKey,
        label: month === null ? "日期未知" : `${year}年${month}月`,
        days: new Map(),
      });
    }
    const month = months.get(monthKey);
    if (!month.days.has(dateKey)) {
      const day = dateKey === "unknown" ? null : Number(dateKey.slice(8, 10));
      month.days.set(dateKey, {
        key: dateKey,
        label: day === null ? "收录日期未知" : `${Number(dateKey.slice(5, 7))}月${day}日`,
        sentences: [],
      });
    }
    month.days.get(dateKey).sentences.push(sentence);
  }

  return [...months.values()]
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((month) => ({
      key: month.key,
      label: month.label,
      days: [...month.days.values()].sort((a, b) => b.key.localeCompare(a.key)),
    }));
}

/** @param {string[]} keys @param {Set<string>} selected */
export function selectionState(keys, selected) {
  const count = keys.reduce((total, key) => total + Number(selected.has(key)), 0);
  if (count === 0) return "none";
  if (count === keys.length) return "all";
  return "mixed";
}

/** @param {"none"|"mixed"|"all"} state */
export function groupCheckboxAriaChecked(state) {
  if (state === "mixed") return "mixed";
  return state === "all";
}

export function filterPersonalSentences(sentences, query) {
  const needle = normalizeSearch(query);
  if (!needle) return sentences;
  return sentences.filter((item) => normalizeSearch(`${item.sentence} ${item.translation ?? ""}`).includes(needle));
}

export function toggleSentenceSelection(selected, key) {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

export function toggleGroupSelection(selected, keys) {
  const next = new Set(selected);
  const allSelected = keys.length > 0 && keys.every((key) => selected.has(key));
  for (const key of keys) { if (allSelected) next.delete(key); else next.add(key); }
  return next;
}

function normalizeSearch(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}
