import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import { Users, Plus, Trash2, Tag } from "lucide-react";
import { format } from "date-fns";
import { parseScheduleDate } from "@/pages/scheduling-logic";
import type { Job, Client, Employee, EmployeeAssignment } from "@shared/schema";

const jobFormSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  address: z.string().optional(),
  status: z.enum(["quoted", "scheduled", "in_progress", "completed"]),
  squareFootage: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  estimatedTotal: z.string().optional(),
  employeeIds: z.array(z.string()).optional(),
  referenceCodes: z.array(z.object({ label: z.string(), code: z.string() })).optional(),
});

type JobFormValues = z.infer<typeof jobFormSchema>;

export default function JobForm({
  job,
  onSuccess,
  onClose,
}: {
  job?: Job;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!job;

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: existingAssignments } = useQuery<EmployeeAssignment[]>({
    queryKey: ["/api/jobs", job?.id, "assignments"],
    enabled: isEdit && !!job?.id,
  });

  const existingCodes = (job?.referenceCodes as { label: string; code: string }[] | null | undefined) ?? [];

  const form = useForm<JobFormValues>({
    resolver: zodResolver(jobFormSchema),
    defaultValues: {
      clientId: job?.clientId || "",
      title: job?.title || "",
      description: job?.description || "",
      address: job?.address || "",
      status: (job?.status as JobFormValues["status"]) || "quoted",
      squareFootage: job?.squareFootage?.toString() || "",
      startDate: job?.startDate ? format(parseScheduleDate(job.startDate)!, "yyyy-MM-dd") : "",
      endDate: job?.endDate ? format(parseScheduleDate(job.endDate)!, "yyyy-MM-dd") : "",
      estimatedTotal: job?.estimatedTotal?.toString() || "",
      employeeIds: [],
      referenceCodes: existingCodes,
    },
  });

  const { fields: refFields, append: appendRef, remove: removeRef } = useFieldArray({
    control: form.control,
    name: "referenceCodes",
  });

  if (isEdit && existingAssignments && form.getValues("employeeIds")?.length === 0 && existingAssignments.length > 0) {
    form.setValue("employeeIds", existingAssignments.map((a) => a.employeeId));
  }

  const mutation = useMutation({
    mutationFn: async (data: JobFormValues) => {
      const url = isEdit ? `/api/jobs/${job.id}` : "/api/jobs";
      const method = isEdit ? "PATCH" : "POST";
      const { employeeIds, ...jobData } = data;
      const payload = {
        ...jobData,
        squareFootage: jobData.squareFootage ? parseFloat(jobData.squareFootage) : null,
        estimatedTotal: jobData.estimatedTotal ? parseFloat(jobData.estimatedTotal) : null,
        startDate: jobData.startDate ? new Date(jobData.startDate).toISOString() : null,
        endDate: jobData.endDate ? new Date(jobData.endDate).toISOString() : null,
        referenceCodes: jobData.referenceCodes ?? [],
      };
      const res = await apiRequest(method, url, payload);
      const savedJob = await res.json();
      await apiRequest("PUT", `/api/jobs/${savedJob.id}/assignments`, {
        employeeIds: employeeIds || [],
      });
      return savedJob;
    },
    onSuccess: (savedJob: Job) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      trackEvent("job_saved", {
        action: isEdit ? "updated" : "created",
        status: savedJob.status,
      });
      toast({
        title: isEdit ? "Job updated" : "Job created",
        description: `${form.getValues("title")} has been ${isEdit ? "updated" : "added"} successfully.`,
      });
      onSuccess();
      onClose();
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.details) {
        Object.entries(error.details).forEach(([field, messages]) => {
          form.setError(field as keyof JobFormValues, {
            type: "server",
            message: Array.isArray(messages) ? messages[0] : String(messages),
          });
        });
        toast({ title: "Please fix the errors below", variant: "destructive" });
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <FormField
          control={form.control}
          name="clientId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Client *</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-job-client">
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {clients?.map((client) => (
                    <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job Title *</FormLabel>
              <FormControl>
                <Input placeholder="Interior painting - Living Room" {...field} data-testid="input-job-title" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea placeholder="Job details and requirements" {...field} data-testid="input-job-description" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job Address</FormLabel>
              <FormControl>
                <AddressAutocomplete
                  value={field.value || ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                  placeholder="Start typing a street address"
                  data-testid="input-job-address"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-job-status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="quoted">Quoted</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="squareFootage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Square Footage</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="1500" {...field} data-testid="input-job-sqft" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-job-start-date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="endDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>End Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-job-end-date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="estimatedTotal"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Estimated Total ($)</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" placeholder="2500.00" {...field} data-testid="input-job-total" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* Reference Codes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Tag className="h-4 w-4" />
              Reference Codes
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => appendRef({ label: "", code: "" })}
              data-testid="button-add-reference-code"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Code
            </Button>
          </div>
          {refFields.length === 0 && (
            <p className="text-xs text-muted-foreground py-1">
              No reference codes — add permit numbers, PO numbers, project IDs, etc.
            </p>
          )}
          <div className="space-y-2">
            {refFields.map((field, index) => (
              <div key={field.id} className="flex gap-2 items-start">
                <FormField
                  control={form.control}
                  name={`referenceCodes.${index}.label`}
                  render={({ field: f }) => (
                    <FormItem className="flex-1 min-w-0">
                      <FormControl>
                        <Input
                          placeholder="Label (e.g. PO No.)"
                          {...f}
                          className="text-sm"
                          data-testid={`input-ref-label-${index}`}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`referenceCodes.${index}.code`}
                  render={({ field: f }) => (
                    <FormItem className="flex-1 min-w-0">
                      <FormControl>
                        <Input
                          placeholder="Code (e.g. PO-2024-001)"
                          {...f}
                          className="text-sm"
                          data-testid={`input-ref-code-${index}`}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRef(index)}
                  data-testid={`button-remove-ref-${index}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {employees && employees.length > 0 && (
          <FormField
            control={form.control}
            name="employeeIds"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  Assigned Employees
                </FormLabel>
                <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
                  {employees.map((emp) => {
                    const checked = field.value?.includes(emp.id) ?? false;
                    return (
                      <label
                        key={emp.id}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                        data-testid={`checkbox-employee-${emp.id}`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(val) => {
                            const current = field.value ?? [];
                            field.onChange(val ? [...current, emp.id] : current.filter((id) => id !== emp.id));
                          }}
                        />
                        <span className="text-sm">{emp.name}</span>
                        {emp.position && (
                          <span className="text-xs text-muted-foreground ml-auto">{emp.position}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-job">
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-job">
            {mutation.isPending ? "Saving..." : isEdit ? "Update Job" : "Create Job"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
