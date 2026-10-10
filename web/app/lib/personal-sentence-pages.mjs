/**
 * @template T
 * @param {(offset: number, pageSize: number) => PromiseLike<{ data: T[] | null, error: unknown }>} fetchPage
 * @param {number} [pageSize]
 * @returns {Promise<T[]>}
 */
export async function collectPersonalSentencePages(fetchPage, pageSize = 100) {
  const result = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetchPage(offset, pageSize);
    if (error) throw new Error("个人句子加载失败，请重试");
    const page = data ?? [];
    result.push(...page);
    if (page.length < pageSize) return result;
  }
}
