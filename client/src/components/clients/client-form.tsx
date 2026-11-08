import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Client } from "@shared/schema";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { apiRequest, ApiError, queryClient } from "@/lib/queryClient";
import { formatPhone } from "@/lib/formatPhone";
import { useToast } from "@/hooks/use-toast";
import { EmailListEditor } from "@/components/email-list-editor";

const clientFormSchema = z.object({
  name: z.string().trim().min(1, "Client name is required"),
  generalContractorName: z.string().optional(),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  additionalEmails: z.array(z.string().email()),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  notes: z.string().optional(),
});

type ClientFormValues = z.infer<typeof clientFormSchema>;

export function ClientForm({
  client,
  onClose,
}: {
  client?: Client;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const isEdit = Boolean(client);
  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: {
      name: client?.name ?? "",
      generalContractorName: client?.generalContractorName ?? "",
      email: client?.email ?? "",
      additionalEmails: client?.additionalEmails ?? [],
      phone: client?.phone ?? "",
      address: client?.address ?? "",
      city: client?.city ?? "",
      state: client?.state ?? "",
      zipCode: client?.zipCode ?? "",
      notes: client?.notes ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: ClientFormValues) => {
      const response = await apiRequest(
        isEdit ? "PATCH" : "POST",
        isEdit ? `/api/clients/${client?.id}` : "/api/clients",
        data,
      );
      return response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: isEdit ? "Client updated" : "Client added",
        description: `${form.getValues("name")} has been ${isEdit ? "updated" : "added"}.`,
      });
      onClose();
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.details) {
        Object.entries(error.details).forEach(([field, messages]) => {
          form.setError(field as keyof ClientFormValues, {
            type: "server",
            message: Array.isArray(messages) ? String(messages[0]) : String(messages),
          });
        });
        toast({
          title: "Please check the highlighted fields",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: isEdit ? "Couldn’t update client" : "Couldn’t add client",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => {
          if (!mutation.isPending) mutation.mutate(values);
        })}
        className="space-y-5"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="min-w-0 space-y-1.5">
                <FormLabel htmlFor="client-name" className="text-[13px] font-semibold text-jx-ink">
                  Client name <span aria-hidden="true">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id="client-name"
                    placeholder="Company or person"
                    autoComplete="organization"
                    className="h-12 rounded-[14px] border-2 border-jx-ink-3 bg-card px-4 text-[15px] font-medium text-jx-ink placeholder:text-jx-ink-3 focus-visible:ring-jx-green"
                    data-testid="input-client-name"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="generalContractorName"
            render={({ field }) => (
              <FormItem className="min-w-0 space-y-1.5">
                <FormLabel htmlFor="client-gc-name" className="text-[13px] font-semibold text-jx-ink">
                  General contractor <span className="font-normal text-jx-ink-3">(optional)</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id="client-gc-name"
                    placeholder="GC company name"
                    className="h-12 rounded-[14px] border-2 border-jx-ink-3 bg-card px-4 text-[15px] font-medium text-jx-ink placeholder:text-jx-ink-3 focus-visible:ring-jx-green"
                    data-testid="input-client-gc-name"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="min-w-0 space-y-1.5">
                <FormLabel htmlFor="client-email" className="text-[13px] font-semibold text-jx-ink">
                  Primary email
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id="client-email"
                    type="email"
                    autoComplete="email"
                    placeholder="Email address"
                    className="h-12 rounded-[14px] border-2 border-jx-ink-3 bg-card px-4 text-[15px] font-medium text-jx-ink placeholder:text-jx-ink-3 focus-visible:ring-jx-green"
                    data-testid="input-client-email"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem className="min-w-0 space-y-1.5">
                <FormLabel htmlFor="client-phone" className="text-[13px] font-semibold text-jx-ink">
                  Phone
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id="client-phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="Phone number"
                    onChange={(event) => field.onChange(formatPhone(event.target.value))}
                    className="h-12 rounded-[14px] border-2 border-jx-ink-3 bg-card px-4 text-[15px] font-medium text-jx-ink placeholder:text-jx-ink-3 focus-visible:ring-jx-green"
                    data-testid="input-client-phone"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="additionalEmails"
          render={({ field }) => (
            <FormItem className="min-w-0 space-y-1.5">
              <FormLabel className="text-[13px] font-semibold text-jx-ink">Additional emails</FormLabel>
              <p className="text-[13px] text-jx-ink-3">
                Other people at this company who should receive invoices, such as accounts payable or the project manager.
              </p>
              <EmailListEditor
                value={field.value}
                onChange={field.onChange}
                exclude={form.watch("email") ? [form.watch("email")!] : []}
                testIdPrefix="client-additional-emails"
              />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem className="min-w-0 space-y-1.5">
              <FormLabel htmlFor="client-address" className="text-[13px] font-semibold text-jx-ink">
                Street address
              </FormLabel>
              <FormControl>
                <AddressAutocomplete
                  {...field}
                  id="client-address"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  className="h-12 rounded-[14px] border-2 border-jx-ink-3 bg-card px-4 text-[15px] font-medium text-jx-ink placeholder:text-jx-ink-3 focus-visible:ring-jx-green"
                  placeholder="Start typing an address"
                  data-testid="input-client-address"
                  onAddressSelect={(result) => {
                    form.setValue("address", result.streetAddress || result.formattedAddress, { shouldDirty: true });
                    form.setValue("city", result.city, { shouldDirty: true });
                    form.setValue("state", result.state, { shouldDirty: true });
                    form.setValue("zipCode", result.postalCode, { shouldDirty: true });
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(72px,.55fr)_minmax(96px,.7fr)] gap-3">
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem className="min-w-0 space-y-1.5">
                <FormLabel htmlFor="client-city" className="text-[13px] font-semibold text-jx-ink">City</FormLabel>
                <FormControl>
                  <Input {...field} id="client-city" placeholder="City" className="h-12 rounded-[14px] border-2 border-jx-ink-3 bg-card px-3 text-[15px] text-jx-ink placeholder:text-jx-ink-3 focus-visible:ring-jx-green sm:px-4" data-testid="input-client-city" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="state"
            render={({ field }) => (
              <FormItem className="min-w-0 space-y-1.5">
                <FormLabel htmlFor="client-state" className="text-[13px] font-semibold text-jx-ink">State</FormLabel>
                <FormControl>
                  <Input {...field} id="client-state" placeholder="State" className="h-12 rounded-[14px] border-2 border-jx-ink-3 bg-card px-3 text-[15px] text-jx-ink placeholder:text-jx-ink-3 sm:px-4" data-testid="input-client-state" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="zipCode"
            render={({ field }) => (
              <FormItem className="min-w-0 space-y-1.5">
                <FormLabel htmlFor="client-zip" className="text-[13px] font-semibold text-jx-ink">ZIP code</FormLabel>
                <FormControl>
                  <Input {...field} id="client-zip" autoComplete="postal-code" placeholder="ZIP" className="h-12 rounded-[14px] border-2 border-jx-ink-3 bg-card px-3 text-[15px] text-jx-ink placeholder:text-jx-ink-3 sm:px-4" data-testid="input-client-zip" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel htmlFor="client-notes" className="text-[13px] font-semibold text-jx-ink">
                Notes
              </FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  id="client-notes"
                  rows={3}
                  placeholder="Anything useful to remember about this client"
                  className="min-h-[96px] resize-y rounded-[14px] border-2 border-jx-ink-3 bg-card px-4 py-3 text-[15px] text-jx-ink placeholder:text-jx-ink-3 focus-visible:ring-jx-green"
                  data-testid="input-client-notes"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-col-reverse gap-2 border-t border-jx-line pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={mutation.isPending}
            className="min-h-12 rounded-full border-2 border-jx-ink px-6 font-semibold text-jx-ink"
            data-testid="button-cancel-client"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="min-h-12 rounded-full bg-jx-green px-7 font-bold text-white hover:bg-jx-green-hover"
            data-testid="button-save-client"
          >
            {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add client"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
