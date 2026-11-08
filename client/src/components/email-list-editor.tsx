import { useState } from "react";
import { X } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dedupeEmails, MAX_EMAILS } from "@shared/client-emails";

const isEmail = (value: string) => z.string().email().safeParse(value).success;

/** Validates a typed address against an existing list; returns an error message or null. */
export function emailEntryError(value: string, existing: readonly string[]): string | null {
  const email = value.trim();
  if (!email) return "Enter an email address";
  if (!isEmail(email)) return "Enter a valid email";
  if (existing.some((e) => e.toLowerCase() === email.toLowerCase())) return "That email is already listed";
  if (existing.length >= MAX_EMAILS) return `Up to ${MAX_EMAILS} email addresses`;
  return null;
}

/** An editable list of email addresses: removable chips plus an input to add more. */
export function EmailListEditor({
  value,
  onChange,
  exclude = [],
  placeholder = "name@company.com",
  testIdPrefix = "email-list",
  disabled = false,
}: {
  value: readonly string[];
  onChange: (emails: string[]) => void;
  /** Addresses already used elsewhere (e.g. the primary email), rejected as duplicates. */
  exclude?: readonly string[];
  placeholder?: string;
  testIdPrefix?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const message = emailEntryError(draft, [...exclude, ...value]);
    if (message) {
      setError(message);
      return;
    }
    onChange(dedupeEmails([...value, draft]));
    setDraft("");
    setError(null);
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" data-testid={`${testIdPrefix}-items`}>
          {value.map((email) => (
            <li key={email} className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm">
              <span className="break-all">{email}</span>
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={() => onChange(value.filter((e) => e !== email))}
                disabled={disabled}
                aria-label={`Remove ${email}`}
                data-testid={`${testIdPrefix}-remove-${email}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
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
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={!!error}
          data-testid={`${testIdPrefix}-input`}
        />
        <Button type="button" variant="outline" onClick={add} disabled={disabled} className="shrink-0" data-testid={`${testIdPrefix}-add`}>
          Add
        </Button>
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
