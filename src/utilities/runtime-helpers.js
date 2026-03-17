import { useCallback } from "react";

/**
 * Hook to handle streaming fetch response: calls onChunk with partial text and onFinish with full message.
 * @param {{ onChunk: (chunk: string) => void, onFinish: (message: string) => void }} options
 */
export function useHandleStreamResponse({ onChunk, onFinish }) {
  return useCallback(async (response) => {
    const reader = response.body?.getReader();
    if (!reader) {
      onFinish("");
      return;
    }
    const decoder = new TextDecoder();
    let full = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        onChunk(full);
      }
    } finally {
      reader.releaseLock();
    }
    onFinish(full);
  }, [onChunk, onFinish]);
}
