import { forwardRef, useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AddressDetails {
  formattedAddress: string;
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

type Suggestion = {
  placeId: string;
  label: string;
  mainText: string;
  secondaryText: string;
};

interface AddressAutocompleteProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value?: string;
  onChange: (value: string) => void;
  onAddressSelect?: (address: AddressDetails) => void;
}

export const AddressAutocomplete = forwardRef<HTMLInputElement, AddressAutocompleteProps>(
  ({ value = "", onChange, onAddressSelect, className, onBlur, onFocus, ...props }, ref) => {
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [lookupNotice, setLookupNotice] = useState("");
    const sessionToken = useRef(crypto.randomUUID());
    const blurTimer = useRef<ReturnType<typeof setTimeout>>();
    const skipNextLookup = useRef(false);
    const focused = useRef(false);
    const dismissed = useRef(false);

    useEffect(() => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    }, []);

    useEffect(() => {
      const query = value.trim();
      if (skipNextLookup.current) {
        skipNextLookup.current = false;
        setSuggestions([]);
        setOpen(false);
        setLoading(false);
        return;
      }
      if (query.length < 3) {
        setSuggestions([]);
        setOpen(false);
        setLoading(false);
        setLookupNotice("");
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(async () => {
        setLoading(true);
        try {
          const params = new URLSearchParams({ q: query, sessionToken: sessionToken.current });
          const response = await fetch(`/api/address-suggestions?${params}`, {
            credentials: "include",
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          if (response.status === 429) {
            setLookupNotice("Address suggestions are paused briefly. You can keep entering the address manually.");
            setSuggestions([]);
            setOpen(false);
            return;
          }
          if (!response.ok) throw new Error("Address lookup failed");
          const results = await response.json() as Suggestion[];
          if (controller.signal.aborted) return;
          setLookupNotice("");
          setSuggestions(results);
          setOpen(focused.current && !dismissed.current && results.length > 0);
          setActiveIndex(-1);
        } catch (error) {
          if (!controller.signal.aborted && (error as Error).name !== "AbortError") {
            setSuggestions([]);
            setOpen(false);
          }
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      }, 275);

      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }, [value]);

    const choose = async (suggestion: Suggestion) => {
      dismissed.current = true;
      skipNextLookup.current = true;
      onChange(suggestion.label);
      setOpen(false);
      try {
        const params = new URLSearchParams({ placeId: suggestion.placeId, sessionToken: sessionToken.current });
        const response = await fetch(`/api/address-details?${params}`, { credentials: "include" });
        if (response.status === 429) {
          setLookupNotice("Address details are paused briefly. Please check or complete the address fields manually.");
          return;
        }
        if (!response.ok) throw new Error("Address details failed");
        const details = await response.json() as AddressDetails;
        setLookupNotice("");
        onChange(details.formattedAddress || suggestion.label);
        onAddressSelect?.(details);
      } catch {
        // Keep the selected suggestion text when the optional detail lookup fails.
      } finally {
        sessionToken.current = crypto.randomUUID();
      }
    };

    return (
      <div className="relative">
        <input
          {...props}
          ref={ref}
          value={value}
          autoComplete="off"
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 pr-9 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm",
            className,
          )}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="address-suggestion-list"
          aria-activedescendant={activeIndex >= 0 ? `address-suggestion-${activeIndex}` : undefined}
          onChange={(event) => {
            dismissed.current = false;
            skipNextLookup.current = false;
            onChange(event.target.value);
          }}
          onFocus={(event) => {
            focused.current = true;
            dismissed.current = false;
            if (blurTimer.current) clearTimeout(blurTimer.current);
            if (suggestions.length) setOpen(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            focused.current = false;
            blurTimer.current = setTimeout(() => setOpen(false), 150);
            onBlur?.(event);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              dismissed.current = true;
              if (open) {
                event.preventDefault();
                event.stopPropagation();
              }
              setOpen(false);
              return;
            }
            if (!open || suggestions.length === 0) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              void choose(suggestions[activeIndex]);
            }
          }}
        />
        {loading && <Loader2 className="absolute right-3 top-[18px] h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        {lookupNotice && (
          <p className="mt-1 text-xs text-muted-foreground" role="status">{lookupNotice}</p>
        )}
        {open && (
          <div
            id="address-suggestion-list"
            role="listbox"
            className="absolute z-50 mt-1 max-h-64 w-full overflow-auto border border-border bg-popover text-popover-foreground shadow-lg"
          >
            {suggestions.map((suggestion, index) => (
              <button
                id={`address-suggestion-${index}`}
                key={suggestion.placeId}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-border/60 px-3 py-2.5 text-left last:border-0 hover:bg-accent",
                  activeIndex === index && "bg-accent",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void choose(suggestion)}
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{suggestion.mainText}</span>
                  {suggestion.secondaryText && <span className="block truncate text-xs text-muted-foreground">{suggestion.secondaryText}</span>}
                </span>
              </button>
            ))}
            <p className="border-t border-border px-3 py-1.5 text-right text-[10px] text-muted-foreground">Powered by Google</p>
          </div>
        )}
      </div>
    );
  },
);

AddressAutocomplete.displayName = "AddressAutocomplete";
