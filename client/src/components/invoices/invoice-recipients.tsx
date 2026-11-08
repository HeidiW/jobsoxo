import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Client } from "@shared/schema";
import { clientEmailOptions, dedupeEmails } from "@shared/client-emails";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emailEntryError } from "@/components/email-list-editor";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Chooses which of a client's email addresses an invoice is sent to. Adding a
 * new address also saves it to the client for future invoices.
 */
export function InvoiceRecipients({
  client,
  value,
  onChange,
}: {
  client: Client;
  value: readonly string[];
  onChange: (emails: string[]) => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const options = clientEmailOptions(client);
  const isChosen = (email: string) => value.some((v) => v.toLowerCase() === email.toLowerCase());

  const saveToClient = useMutation({
    mutationFn: async (email: string) => {
      const additionalEmails = dedupeEmails([...(client.additionalEmails ?? []), email]);
      const res = await apiRequest("PATCH", `/api/clients/${client.id}`, { additionalEmails });
      return res.json();
    },
    onSuccess: (_data, email) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      onChange(dedupeEmails([...value, email]));
      setDraft("");
      toast({ title: "Email added", description: `${email} was saved to ${client.name}.` });
    },
    onError: (err: Error) => {
      setError(err.message.replace(/^\d+:\s*/, "") || "Couldn't save the email");
    },
  });

  const add = () => {
    const message = emailEntryError(draft, options);
    if (message) return setError(message);
    saveToClient.mutate(draft.trim());
  };

  return (
    <div className="space-y-2" data-testid="invoice-recipients">
      {options.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">This client has no email address yet. Add one to send this invoice.</p>
      ) : (
        <ul className="space-y-1.5">
          {options.map((email, index) => (
            <li key={email}>
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <Checkbox
                  checked={isChosen(email)}
                  onCheckedChange={(checked) =>
                    onChange(checked ? dedupeEmails([...value, email]) : value.filter((v) => v.toLowerCase() !== email.toLowerCase()))
                  }
                  data-testid={`checkbox-recipient-${email}`}
                />
                <span className="break-all">{email}</span>
                {index === 0 && client.email && <span className="text-muted-foreground">(primary)</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          type="email"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="Add another email"
          disabled={saveToClient.isPending}
          data-testid="input-add-recipient"
        />
        <Button type="button" variant="outline" onClick={add} disabled={saveToClient.isPending} className="shrink-0" data-testid="button-add-recipient">
          Add
        </Button>
      </div>
      {error && <p className="text-[13px] text-destructive" role="alert">{error}</p>}
    </div>
  );
}
