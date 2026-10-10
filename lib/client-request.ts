type Handlers<T> = {
  onData: (data: T) => void;
  onError: (error: Error) => void;
  onSettled?: () => void;
};

/** Subscribe to one request; cleanup aborts it and ignores late responses. */
export function subscribeJson<T>(
  url: string,
  options: Omit<RequestInit, 'signal'>,
  handlers: Handlers<T>,
): () => void {
  const controller = new AbortController();
  async function run() {
    try {
      const response = await fetch(url, {...options, signal: controller.signal});
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'تعذر تحميل البيانات');
      if (!controller.signal.aborted) handlers.onData(data as T);
    } catch (error) {
      if (!controller.signal.aborted) {
        handlers.onError(error instanceof Error ? error : new Error('تعذر الاتصال'));
      }
    } finally {
      if (!controller.signal.aborted) handlers.onSettled?.();
    }
  }
  void run();
  return () => controller.abort();
}
