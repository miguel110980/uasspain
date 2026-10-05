/** Independent resources keep their last successful value on a partial failure. */
export async function loadResources<T extends Record<string, () => Promise<any>>>(resources: T) {
  const entries = Object.entries(resources);
  const results = await Promise.allSettled(entries.map(([, load]) => load()));
  const values = {} as Partial<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>;
  const failed: string[] = [];
  results.forEach((result, index) => {
    const key = entries[index][0] as keyof T;
    if (result.status === 'fulfilled') values[key] = result.value;
    else failed.push(String(key));
  });
  return { values, failed };
}
