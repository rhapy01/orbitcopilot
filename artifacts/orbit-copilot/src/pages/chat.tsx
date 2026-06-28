import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Send, Sparkles, Trash2 } from "lucide-react";
import { 
  useGetChatMessages, 
  useSendChatMessage, 
  getGetChatMessagesQueryKey,
  useClearChatHistory
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const SUGGESTED_PROMPTS = [
  "Send 50 USDC to Bob",
  "Find yield opportunities for XLM",
  "Swap 100 XLM to USDC",
  "Explain Stellar trustlines"
];

export default function ChatPage() {
  const queryClient = useQueryClient();
  const { data: messages = [], isLoading } = useGetChatMessages();
  const sendMutation = useSendChatMessage();
  const clearMutation = useClearChatHistory();
  
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sendMutation.isPending]);

  const handleSend = (content: string) => {
    if (!content.trim()) return;
    
    setInput("");
    sendMutation.mutate({ data: { content } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetChatMessagesQueryKey() });
      }
    });
  };

  const handleClear = () => {
    clearMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetChatMessagesQueryKey() });
      }
    });
  };

  return (
    <div className="flex flex-col h-full h-[calc(100vh-4rem)] md:h-screen">
      <header className="flex items-center justify-between p-4 border-b shrink-0 bg-background/80 backdrop-blur-sm z-10 sticky top-0">
        <div>
          <h1 className="text-xl font-bold">Orbit Copilot</h1>
          <p className="text-sm text-muted-foreground">Your AI financial assistant</p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="icon" onClick={handleClear} disabled={clearMutation.isPending}>
            <Trash2 className="w-5 h-5 text-muted-foreground" />
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-6" ref={scrollRef}>
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-16 w-[80%] rounded-2xl rounded-tl-sm" />
            <Skeleton className="h-16 w-[80%] ml-auto rounded-2xl rounded-tr-sm" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center max-w-md mx-auto space-y-8 text-center px-4">
            <div className="w-16 h-16 rounded-full bg-orbit-gradient flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold">How can I help you today?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSend(prompt)}
                  className="p-3 text-sm text-left border rounded-xl hover:bg-accent/5 transition-colors text-muted-foreground hover:text-foreground"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl mx-auto w-full pb-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex w-full",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "px-4 py-3 rounded-2xl max-w-[85%] sm:max-w-[75%]",
                    msg.role === "user" 
                      ? "bg-orbit-gradient text-white rounded-tr-sm shadow-md" 
                      : "bg-card border shadow-sm rounded-tl-sm text-card-foreground"
                  )}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            
            {sendMutation.isPending && (
              <div className="flex w-full justify-start">
                <div className="px-4 py-4 rounded-2xl bg-card border shadow-sm rounded-tl-sm flex gap-1 items-center">
                  <div className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-4 border-t bg-background shrink-0 pb-safe">
        <form
          className="max-w-3xl mx-auto relative flex items-center"
          onSubmit={(e) => {
            e.preventDefault();
            handleSend(input);
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Orbit to send, swap, or analyze..."
            className="pr-12 py-6 rounded-2xl bg-muted/50 border-transparent focus-visible:ring-primary/50 text-base"
            disabled={sendMutation.isPending}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || sendMutation.isPending}
            className="absolute right-2 h-8 w-8 rounded-xl bg-orbit-gradient text-white border-0 hover:opacity-90 transition-opacity"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
