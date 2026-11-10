import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "@/lib/api";
import { Message, CreateMessageInput, MessageCategory } from "@cipansor/shared";

export function useMessages(params?: {
  page?: number;
  limit?: number;
  type?: "inbox" | "sent" | "all";
  category?: MessageCategory;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["messages", params];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await api.get("/messages", { params });
      return response.data;
    },
  });

  const createMessage = useMutation({
    mutationFn: async (data: CreateMessageInput) => {
      const response = await api.post("/messages", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
  });

  const replyMessage = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const response = await api.post(`/messages/${id}/reply`, { content });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
  });

  const markAsRead = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.patch(`/messages/${id}/read`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["unread-messages-count"] });
    },
  });

  return {
    ...query,
    createMessage,
    replyMessage,
    markAsRead,
  };
}

export function useUnreadMessagesCount() {
  return useQuery({
    queryKey: ["unread-messages-count"],
    queryFn: async () => {
      const response = await api.get("/messages/unread-count");
      return response.data.data.unreadCount as number;
    },
    // Poll every minute
    refetchInterval: 60000,
  });
}

/**
 * One conversation: its first message and the replies under it
 * (`GET /messages/:id`). Only the two people in it can open it; opening it
 * reads what was sent to the caller.
 */
export function useMessageThread(id: string) {
  return useQuery({
    queryKey: ["messages", "thread", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Message>>(`/messages/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}
