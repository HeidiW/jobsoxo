import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus,
  Search,
  Users,
  Clock,
  DollarSign,
  Edit,
  MoreHorizontal,
  Calendar,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import type { Employee, TimeEntry, PayrollRecord, Job } from "@shared/schema";

const employeeFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  hourlyRate: z.string().min(1, "Hourly rate is required"),
  position: z.string().optional(),
  status: z.enum(["active", "inactive"]),
});

const timeEntryFormSchema = z.object({
  employeeId: z.string().min(1, "Employee is required"),
  jobId: z.string().optional(),
  date: z.string().min(1, "Date is required"),
  hoursWorked: z.string().min(1, "Hours are required"),
  description: z.string().optional(),
});

type EmployeeFormValues = z.infer<typeof employeeFormSchema>;
type TimeEntryFormValues = z.infer<typeof timeEntryFormSchema>;

interface EmployeeWithStats extends Employee {
  hoursThisPeriod: number;
  totalPay: number;
}

interface TimeEntryWithRelations extends TimeEntry {
  employee: Employee;
  job?: Job;
}

function EmployeeForm({
  employee,
  onSuccess,
  onClose,
}: {
  employee?: Employee;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!employee;

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      name: employee?.name || "",
      email: employee?.email || "",
      phone: employee?.phone || "",
      hourlyRate: employee?.hourlyRate?.toString() || "",
      position: employee?.position || "",
      status: (employee?.status as EmployeeFormValues["status"]) || "active",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: EmployeeFormValues) => {
      const url = isEdit ? `/api/employees/${employee.id}` : "/api/employees";
      const method = isEdit ? "PATCH" : "POST";
      const payload = {
        ...data,
        hourlyRate: parseFloat(data.hourlyRate),
      };
      const res = await apiRequest(method, url, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({
        title: isEdit ? "Employee updated" : "Employee added",
        description: `${form.getValues("name")} has been ${isEdit ? "updated" : "added"} successfully.`,
      });
      onSuccess();
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: EmployeeFormValues) => {
    mutation.mutate(data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name *</FormLabel>
              <FormControl>
                <Input placeholder="Employee name" {...field} data-testid="input-employee-name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="email@example.com" {...field} data-testid="input-employee-email" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <Input placeholder="(555) 123-4567" {...field} data-testid="input-employee-phone" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="hourlyRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Hourly Rate ($) *</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" placeholder="25.00" {...field} data-testid="input-employee-rate" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="position"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Position</FormLabel>
                <FormControl>
                  <Input placeholder="Painter, Foreman, etc." {...field} data-testid="input-employee-position" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-employee-status">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-employee">
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-employee">
            {mutation.isPending ? "Saving..." : isEdit ? "Update Employee" : "Add Employee"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function TimeEntryForm({
  onSuccess,
  onClose,
}: {
  onSuccess: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: jobs } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
  });

  const form = useForm<TimeEntryFormValues>({
    resolver: zodResolver(timeEntryFormSchema),
    defaultValues: {
      employeeId: "",
      jobId: "",
      date: format(new Date(), "yyyy-MM-dd"),
      hoursWorked: "",
      description: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: TimeEntryFormValues) => {
      const payload = {
        ...data,
        hoursWorked: parseFloat(data.hoursWorked),
        date: new Date(data.date).toISOString(),
        jobId: data.jobId || null,
      };
      const res = await apiRequest("POST", "/api/time-entries", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({
        title: "Time entry added",
        description: "The time entry has been recorded.",
      });
      onSuccess();
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: TimeEntryFormValues) => {
    mutation.mutate(data);
  };

  const activeEmployees = employees?.filter((e) => e.status === "active");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="employeeId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Employee *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-time-entry-employee">
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {activeEmployees?.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="jobId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job (Optional)</FormLabel>
              <Select onValueChange={(v) => field.onChange(v === "none" ? "" : v)} value={field.value || "none"}>
                <FormControl>
                  <SelectTrigger data-testid="select-time-entry-job">
                    <SelectValue placeholder="Select job" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">No job</SelectItem>
                  {jobs?.filter((j) => j.status !== "completed").map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date *</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-time-entry-date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="hoursWorked"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Hours Worked *</FormLabel>
                <FormControl>
                  <Input type="number" step="0.25" placeholder="8" {...field} data-testid="input-time-entry-hours" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input placeholder="Work performed" {...field} data-testid="input-time-entry-description" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-time-entry">
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-time-entry">
            {mutation.isPending ? "Saving..." : "Add Entry"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function PayrollTableSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 p-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

export default function Payroll() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
  const [isTimeEntryDialogOpen, setIsTimeEntryDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  const { data: employees, isLoading: employeesLoading } = useQuery<EmployeeWithStats[]>({
    queryKey: ["/api/employees"],
  });

  const { data: timeEntries, isLoading: timeEntriesLoading } = useQuery<TimeEntryWithRelations[]>({
    queryKey: ["/api/time-entries"],
  });

  const filteredEmployees = employees?.filter((employee) =>
    employee.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    employee.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    employee.position?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const totalPayroll = employees?.reduce((sum, emp) => sum + (emp.totalPay || 0), 0) || 0;
  const totalHours = employees?.reduce((sum, emp) => sum + (emp.hoursThisPeriod || 0), 0) || 0;
  const activeEmployees = employees?.filter((e) => e.status === "active").length || 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-semibold">Payroll</h1>
          <p className="text-muted-foreground mt-1">Manage employees and time tracking</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isTimeEntryDialogOpen} onOpenChange={setIsTimeEntryDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-log-hours">
                <Clock className="h-4 w-4 mr-2" />
                Log Hours
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Log Time Entry</DialogTitle>
              </DialogHeader>
              <TimeEntryForm
                onSuccess={() => {}}
                onClose={() => setIsTimeEntryDialogOpen(false)}
              />
            </DialogContent>
          </Dialog>
          <Dialog open={isEmployeeDialogOpen} onOpenChange={(open) => {
            setIsEmployeeDialogOpen(open);
            if (!open) setEditingEmployee(null);
          }}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-employee">
                <Plus className="h-4 w-4 mr-2" />
                Add Employee
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editingEmployee ? "Edit Employee" : "Add Employee"}</DialogTitle>
              </DialogHeader>
              <EmployeeForm
                employee={editingEmployee || undefined}
                onSuccess={() => {}}
                onClose={() => {
                  setIsEmployeeDialogOpen(false);
                  setEditingEmployee(null);
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Active Employees</div>
                <div className="text-2xl font-bold">{activeEmployees}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Total Hours (Period)</div>
                <div className="text-2xl font-bold">{totalHours.toFixed(1)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Total Payroll</div>
                <div className="text-2xl font-bold font-mono">{formatCurrency(totalPayroll)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="employees" className="space-y-4">
        <TabsList>
          <TabsTrigger value="employees" data-testid="tab-employees">Employees</TabsTrigger>
          <TabsTrigger value="time-entries" data-testid="tab-time-entries">Time Entries</TabsTrigger>
        </TabsList>

        <TabsContent value="employees">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  All Employees
                  {employees && (
                    <Badge variant="secondary" className="ml-2">
                      {employees.length}
                    </Badge>
                  )}
                </CardTitle>
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search employees..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-employees"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {employeesLoading ? (
                <PayrollTableSkeleton />
              ) : !filteredEmployees || filteredEmployees.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-medium text-lg">No employees found</h3>
                  <p className="text-muted-foreground mt-1 mb-4">
                    {searchQuery ? "Try a different search term" : "Add your first employee to get started"}
                  </p>
                  {!searchQuery && (
                    <Button onClick={() => setIsEmployeeDialogOpen(true)} data-testid="button-add-first-employee">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Employee
                    </Button>
                  )}
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead className="hidden md:table-cell">Position</TableHead>
                        <TableHead className="text-right">Hourly Rate</TableHead>
                        <TableHead className="text-right hidden lg:table-cell">Hours (Period)</TableHead>
                        <TableHead className="text-right hidden lg:table-cell">Total Pay</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEmployees.map((employee) => (
                        <TableRow key={employee.id} className="hover-elevate">
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium">{employee.name}</span>
                              {employee.email && (
                                <span className="text-sm text-muted-foreground">{employee.email}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <span className="text-sm">{employee.position || "—"}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="font-mono text-sm">
                              {formatCurrency(Number(employee.hourlyRate))}/hr
                            </span>
                          </TableCell>
                          <TableCell className="text-right hidden lg:table-cell">
                            <span className="font-mono text-sm">
                              {(employee.hoursThisPeriod || 0).toFixed(1)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right hidden lg:table-cell">
                            <span className="font-mono font-medium">
                              {formatCurrency(employee.totalPay || 0)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={employee.status === "active" ? "default" : "secondary"}>
                              {employee.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" data-testid={`button-employee-actions-${employee.id}`}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEditingEmployee(employee);
                                    setIsEmployeeDialogOpen(true);
                                  }}
                                  data-testid={`button-edit-employee-${employee.id}`}
                                >
                                  <Edit className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="time-entries">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Recent Time Entries
                {timeEntries && (
                  <Badge variant="secondary" className="ml-2">
                    {timeEntries.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {timeEntriesLoading ? (
                <PayrollTableSkeleton />
              ) : !timeEntries || timeEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-medium text-lg">No time entries yet</h3>
                  <p className="text-muted-foreground mt-1 mb-4">
                    Start logging hours to track employee work
                  </p>
                  <Button onClick={() => setIsTimeEntryDialogOpen(true)} data-testid="button-log-first-hours">
                    <Clock className="h-4 w-4 mr-2" />
                    Log Hours
                  </Button>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Employee</TableHead>
                        <TableHead className="hidden md:table-cell">Job</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="hidden lg:table-cell">Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {timeEntries.slice(0, 20).map((entry) => (
                        <TableRow key={entry.id} className="hover-elevate">
                          <TableCell>
                            <span className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              {format(new Date(entry.date), "MMM d, yyyy")}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium">{entry.employee?.name || "—"}</span>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <span className="text-sm">{entry.job?.title || "—"}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="font-mono font-medium">
                              {Number(entry.hoursWorked).toFixed(1)} hrs
                            </span>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <span className="text-sm text-muted-foreground truncate max-w-xs block">
                              {entry.description || "—"}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
