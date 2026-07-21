import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle, AlertCircle, CreditCard, Building2, Phone, Mail, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PayInvoiceData {
  invoiceNumber: string;
  balance: string;
  total: string;
  amountPaid: string;
  dueDate: string;
  status: string;
  clientName: string | null;
  companyName: string | null;
  companyEmail: string | null;
  companyPhone: string | null;
  stripeEnabled: boolean;
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}

export default function InvoicePay() {
  const token = window.location.pathname.split("/pay/")[1] ?? "";
  const params = new URLSearchParams(window.location.search);
  const paymentSuccess = params.get("payment") === "success";

  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const { data, isLoading, error, isError } = useQuery<PayInvoiceData>({
    queryKey: ["/api/pay", token],
    queryFn: async () => {
      const res = await fetch(`/api/pay/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        throw new Error(body.error || `Error ${res.status}`);
      }
      return res.json();
    },
    retry: false,
    enabled: !!token,
  });

  async function startCheckout() {
    setCheckoutPending(true);
    setCheckoutError(null);
    try {
      const res = await fetch(`/api/pay/${token}/checkout`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to start checkout");
      if (body.url) {
        window.location.href = body.url;
      }
    } catch (err) {
      setCheckoutError((err as Error).message);
      setCheckoutPending(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (isError || !data) {
    const msg = (error as Error)?.message ?? "This payment link is invalid or has expired.";
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
          <h1 className="text-xl font-semibold text-gray-800">Link not found</h1>
          <p className="text-gray-500 text-sm">{msg}</p>
        </div>
      </div>
    );
  }

  const isPaid = paymentSuccess || data.status === "paid" || Number(data.balance) <= 0;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          {data.companyName && (
            <h1 className="text-2xl font-bold text-gray-900" data-testid="text-company-name">
              {data.companyName}
            </h1>
          )}
          <p className="text-gray-500 text-sm mt-1">Invoice Payment</p>
        </div>

        <Card className="shadow-md">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-gray-700">
                Invoice #{data.invoiceNumber}
              </CardTitle>
              <Badge
                data-testid="status-invoice"
                variant={isPaid ? "secondary" : "destructive"}
                className="text-xs"
              >
                {isPaid ? "Paid" : "Overdue"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isPaid ? (
              <div className="flex flex-col items-center py-6 gap-3" data-testid="status-paid">
                <CheckCircle className="h-14 w-14 text-green-500" />
                <p className="text-lg font-semibold text-gray-800">All paid — thank you!</p>
                <p className="text-sm text-gray-500">
                  {paymentSuccess
                    ? "Your payment has been submitted. We'll send a confirmation shortly."
                    : "This invoice has been fully settled."}
                </p>
              </div>
            ) : (
              <>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Invoice Total</span>
                    <span className="font-medium" data-testid="text-total">{formatCurrency(data.total)}</span>
                  </div>
                  {Number(data.amountPaid) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Already Paid</span>
                      <span className="font-medium text-green-600" data-testid="text-amount-paid">
                        {formatCurrency(data.amountPaid)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-red-200 pt-2 mt-1">
                    <span className="font-semibold text-gray-800">Amount Due</span>
                    <span className="text-xl font-bold text-red-600" data-testid="text-balance">
                      {formatCurrency(data.balance)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    Due: {new Date(data.dueDate).toLocaleDateString()}
                  </p>
                </div>

                {data.clientName && (
                  <p className="text-sm text-gray-600" data-testid="text-client-name">
                    For: <span className="font-medium">{data.clientName}</span>
                  </p>
                )}

                {data.stripeEnabled ? (
                  <div className="space-y-2">
                    <Button
                      className="w-full"
                      size="lg"
                      onClick={startCheckout}
                      disabled={checkoutPending}
                      data-testid="button-pay-now"
                    >
                      {checkoutPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Redirecting…
                        </>
                      ) : (
                        <>
                          <CreditCard className="h-4 w-4 mr-2" />
                          Pay {formatCurrency(data.balance)} Now
                          <ExternalLink className="h-3 w-3 ml-2 opacity-60" />
                        </>
                      )}
                    </Button>
                    {checkoutError && (
                      <p className="text-xs text-red-600 text-center" data-testid="text-checkout-error">
                        {checkoutError}
                      </p>
                    )}
                    <p className="text-xs text-center text-gray-400">Powered by Stripe — card payments are secure</p>
                  </div>
                ) : (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2 text-blue-700 font-medium text-sm">
                      <CreditCard className="h-4 w-4" />
                      How to pay
                    </div>
                    <p className="text-sm text-gray-600">
                      Please contact us using the details below to arrange payment. Reference invoice{" "}
                      <strong>#{data.invoiceNumber}</strong>.
                    </p>
                  </div>
                )}
              </>
            )}

            {(data.companyEmail || data.companyPhone) && (
              <div className="border-t pt-4 space-y-2">
                {data.companyName && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Building2 className="h-4 w-4 text-gray-400" />
                    <span data-testid="text-footer-company">{data.companyName}</span>
                  </div>
                )}
                {data.companyEmail && (
                  <a
                    href={`mailto:${data.companyEmail}`}
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                    data-testid="link-company-email"
                  >
                    <Mail className="h-4 w-4" />
                    {data.companyEmail}
                  </a>
                )}
                {data.companyPhone && (
                  <a
                    href={`tel:${data.companyPhone}`}
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                    data-testid="link-company-phone"
                  >
                    <Phone className="h-4 w-4" />
                    {data.companyPhone}
                  </a>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-gray-400">
          This link expires 30 days after it was sent.
        </p>
      </div>
    </div>
  );
}
