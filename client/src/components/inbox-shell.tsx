import { useLocation, useSearch } from "wouter";
import { Inbox, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import InboxTasks from "@/pages/inbox-tasks";
import GmailTodos from "@/pages/gmail-todos";

type InboxView = "business" | "gmail";

function currentView(search: string): InboxView {
  return new URLSearchParams(search).get("view") === "gmail" ? "gmail" : "business";
}

export default function InboxShell() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const view = currentView(search);

  function changeView(next: InboxView) {
    const params = new URLSearchParams(search);
    params.set("view", next);
    setLocation(`/inbox?${params.toString()}`);
  }

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-[1120px] px-5 pb-5 pt-8 md:px-10 md:pt-10">
        <Tabs value={view} onValueChange={(next) => changeView(next as InboxView)}>
        <div data-testid="inbox-header" className="mb-6 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="kicker">Keep work moving</p>
            <h1 className="mt-2 text-4xl font-bold leading-none tracking-display text-jx-ink">Inbox</h1>
            <p className="mt-3 text-sm text-jx-ink-2">Business follow-ups and client email, in one place.</p>
          </div>
            <TabsList aria-label="Inbox sections" className="h-auto flex-wrap gap-2 rounded-none bg-transparent p-0">
              <TabsTrigger
                value="business"
                className="h-11 rounded-full border-2 border-jx-ink-3 bg-card px-5 text-sm font-semibold text-jx-ink shadow-none data-[state=active]:border-jx-green data-[state=active]:bg-jx-green data-[state=active]:text-white data-[state=active]:shadow-none"
                data-testid="tab-inbox-business"
              >
                <Inbox className="mr-2 h-4 w-4" /> Business tasks
                {view === "business" && <Badge className="ml-2 border-0 bg-white/20 text-white">To do</Badge>}
              </TabsTrigger>
              <TabsTrigger
                value="gmail"
                className="h-11 rounded-full border-2 border-jx-ink-3 bg-card px-5 text-sm font-semibold text-jx-ink shadow-none data-[state=active]:border-jx-green data-[state=active]:bg-jx-green data-[state=active]:text-white data-[state=active]:shadow-none"
                data-testid="tab-inbox-gmail"
              >
                <Mail className="mr-2 h-4 w-4" /> Gmail
              </TabsTrigger>
            </TabsList>
        </div>
            <TabsContent value="business" className="mt-0">
              <InboxTasks embedded />
            </TabsContent>
            <TabsContent value="gmail" className="mt-0">
              <GmailTodos embedded />
            </TabsContent>
          </Tabs>
      </div>
    </div>
  );
}
