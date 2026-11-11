"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  MessageSquare,
  Send,
  ArrowLeft,
  Clock,
  Check,
  CheckCheck,
} from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { id } from "date-fns/locale";
import { useAuthStore } from "@/stores/auth";
import type { Message as ApiMessage } from "@cipansor/shared";
import { useMessages, useMessageThread } from "@/hooks/use-messages";
import { buildConversations, type Conversation } from "@/lib/message-threads";

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  isMe: boolean;
  content: string;
  createdAt: string;
  read: boolean;
}

export default function ParentMessagesPage() {
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const me = useAuthStore((state) => state.user?.id);

  const {
    data: messagesData,
    isLoading: loadingMessages,
    replyMessage,
    markAsRead,
  } = useMessages({ type: "all", limit: 100 });
  const { data: selectedMessageDetail } = useMessageThread(
    selectedConversation?.id || "",
  );

  // One row per conversation, newest activity first (lib/message-threads).
  const conversations = useMemo(
    () => buildConversations((messagesData?.data ?? []) as ApiMessage[], me),
    [messagesData, me],
  );

  const messages = useMemo((): Message[] => {
    if (!selectedMessageDetail) return [];
    const thread = [
      selectedMessageDetail,
      ...(selectedMessageDetail.replies ?? []),
    ];
    return thread
      .map((msg) => ({
        id: msg.id,
        senderId: msg.senderId,
        senderName: msg.sender?.name || "—",
        isMe: msg.senderId === me,
        content: msg.content,
        createdAt: msg.createdAt,
        read: msg.isRead,
      }))
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
  }, [selectedMessageDetail, me]);

  // Opening a thread with something unread for the wali marks the whole
  // thread read (the API reads every reply in it addressed to them).
  //
  // The stored object is the snapshot taken when the thread was opened; the
  // live list is what carries a reply that arrived since. Read the badge from
  // the live copy, so a reply that lands while the thread is open — or on
  // refocus — still marks it read. The ref records the unread episode already
  // sent to the API: a failed call must not fire again on every render, and a
  // genuinely new reply (a newer lastMessageAt) is what starts a new attempt.
  const activeConversation =
    conversations.find((c) => c.id === selectedConversation?.id) ??
    selectedConversation;
  const { mutate: markThreadRead, isPending: isMarkingRead } = markAsRead;
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConversation?.unread) return;
    const episode = `${activeConversation.id}:${activeConversation.lastMessageAt}`;
    if (markedRef.current === episode || isMarkingRead) return;
    markedRef.current = episode;
    markThreadRead(activeConversation.id);
  }, [
    activeConversation?.id,
    activeConversation?.unread,
    activeConversation?.lastMessageAt,
    isMarkingRead,
    markThreadRead,
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || !selectedConversation) return;
    try {
      await replyMessage.mutateAsync({
        id: selectedConversation.id,
        content: newMessage,
      });
      setNewMessage("");
      toast.success("Pesan terkirim");
    } catch {
      // The shared client already shows the API's reason.
    }
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  // Loading state
  if (loadingMessages) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-3 h-[calc(100vh-220px)]">
          <Skeleton className="h-full" />
          <Skeleton className="lg:col-span-2 h-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/parent">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Pesan</h1>
          <p className="text-muted-foreground">
            Komunikasi dengan guru dan wali kelas
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 h-[calc(100vh-220px)]">
        {/* Conversation List */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Percakapan
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[500px]">
              {conversations.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Belum ada pesan. Pesan dari wali kelas muncul di sini; untuk
                  menulis lebih dulu, buka{" "}
                  <Link
                    href="/parent/buku-penghubung"
                    className="text-primary underline"
                  >
                    Buku Penghubung
                  </Link>
                  .
                </div>
              )}
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => setSelectedConversation(conv)}
                  className={`flex items-start gap-3 p-4 cursor-pointer border-b transition-colors hover:bg-muted/50 ${
                    selectedConversation?.id === conv.id ? "bg-primary/5" : ""
                  }`}
                >
                  <Avatar>
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {getInitials(conv.otherName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-medium truncate">{conv.otherName}</p>
                      {conv.unread && <Badge className="ml-2">Baru</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {conv.subject}
                    </p>
                    <p className="text-sm text-muted-foreground truncate mt-1">
                      {conv.lastMessage}
                    </p>
                  </div>
                </div>
              ))}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Chat Area */}
        <Card className="lg:col-span-2 flex flex-col">
          {selectedConversation ? (
            <>
              {/* Chat Header */}
              <CardHeader className="pb-3 border-b">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {getInitials(selectedConversation.otherName)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle className="text-lg">
                      {selectedConversation.otherName}
                    </CardTitle>
                    <CardDescription>
                      {selectedConversation.subject}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              {/* Messages */}
              <CardContent className="flex-1 p-4 overflow-hidden">
                <ScrollArea className="h-[350px] pr-4">
                  <div className="space-y-4">
                    {messages.map((msg) => {
                      const isMe = msg.isMe;
                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[70%] rounded-lg p-3 ${
                              isMe
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted"
                            }`}
                          >
                            <p className="text-sm">{msg.content}</p>
                            <div
                              className={`flex items-center justify-end gap-1 mt-1 text-xs ${
                                isMe
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground"
                              }`}
                            >
                              <Clock className="h-3 w-3" />
                              {formatDistanceToNow(new Date(msg.createdAt), {
                                addSuffix: true,
                                locale: id,
                              })}
                              {isMe &&
                                (msg.read ? (
                                  <CheckCheck className="h-3 w-3 ml-1" />
                                ) : (
                                  <Check className="h-3 w-3 ml-1" />
                                ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>
              </CardContent>

              {/* Message Input */}
              <div className="p-4 border-t">
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Ketik pesan..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    className="min-h-[60px] resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                  />
                  <Button
                    onClick={handleSend}
                    disabled={!newMessage.trim() || replyMessage.isPending}
                    className="px-4"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Pilih percakapan untuk mulai chat</p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
