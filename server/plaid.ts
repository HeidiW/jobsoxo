import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";

function getPlaidClient(): PlaidApi | null {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.PLAID_ENV || "sandbox";

  if (!clientId || !secret) {
    return null;
  }

  const envMap: Record<string, string> = {
    sandbox: PlaidEnvironments.sandbox,
    development: PlaidEnvironments.development,
    production: PlaidEnvironments.production,
  };

  const configuration = new Configuration({
    basePath: envMap[env] || PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  return new PlaidApi(configuration);
}

export function isPlaidConfigured(): boolean {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export async function createLinkToken(userId: string, products: string[] = ["transactions", "auth"]): Promise<string> {
  const client = getPlaidClient();
  if (!client) throw new Error("Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET.");

  const response = await client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "JobsOxo",
    products: products as Products[],
    country_codes: [CountryCode.Us],
    language: "en",
  });

  return response.data.link_token;
}

export async function exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }> {
  const client = getPlaidClient();
  if (!client) throw new Error("Plaid is not configured.");

  const response = await client.itemPublicTokenExchange({ public_token: publicToken });
  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  };
}

export interface PlaidAccountInfo {
  accountId: string;
  institutionName: string;
  accountName: string;
  accountMask: string;
  accountType: string;
  routingNumber: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
}

export async function getAccountInfo(accessToken: string): Promise<PlaidAccountInfo> {
  const client = getPlaidClient();
  if (!client) throw new Error("Plaid is not configured.");

  const [authRes, itemRes] = await Promise.all([
    client.authGet({ access_token: accessToken }),
    client.itemGet({ access_token: accessToken }),
  ]);

  const account = authRes.data.accounts[0];
  if (!account) throw new Error("No accounts found for this access token.");

  // Extract routing number from ACH numbers returned by Auth
  let routingNumber: string | null = null;
  const achNumbers = authRes.data.numbers?.ach ?? [];
  const achForAccount = achNumbers.find((n: any) => n.account_id === account.account_id);
  if (achForAccount?.routing) {
    routingNumber = String(achForAccount.routing);
  }

  let institutionName = "Unknown Bank";
  if (itemRes.data.item.institution_id) {
    try {
      const instRes = await client.institutionsGetById({
        institution_id: itemRes.data.item.institution_id,
        country_codes: [CountryCode.Us],
      });
      institutionName = instRes.data.institution.name;
    } catch {}
  }

  return {
    accountId: account.account_id,
    institutionName,
    accountName: account.name,
    accountMask: account.mask || "0000",
    accountType: account.type,
    routingNumber,
    currentBalance: account.balances.current ?? null,
    availableBalance: account.balances.available ?? null,
  };
}

export async function getBalance(accessToken: string): Promise<{ current: number | null; available: number | null }> {
  const client = getPlaidClient();
  if (!client) throw new Error("Plaid is not configured.");

  const response = await client.accountsBalanceGet({ access_token: accessToken });
  const account = response.data.accounts[0];
  return {
    current: account?.balances.current ?? null,
    available: account?.balances.available ?? null,
  };
}

export interface PlaidTransaction {
  transactionId: string;
  date: string;
  amount: number;
  name: string;
  merchantName?: string;
}

export type TransactionResult =
  | { ready: true; transactions: PlaidTransaction[] }
  | { ready: false; reason: "product_not_ready" | "no_account" };

export async function getTransactions(accessToken: string, days: number = 30): Promise<PlaidTransaction[]> {
  const client = getPlaidClient();
  if (!client) throw new Error("Plaid is not configured.");

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  try {
    const response = await client.transactionsGet({
      access_token: accessToken,
      start_date: startDate.toISOString().split("T")[0],
      end_date: endDate.toISOString().split("T")[0],
    });

    return response.data.transactions.map((t) => ({
      transactionId: t.transaction_id,
      date: t.date,
      amount: t.amount,
      name: t.name,
      merchantName: t.merchant_name ?? undefined,
    }));
  } catch (error: any) {
    const code = error?.response?.data?.error_code;
    if (code === "PRODUCT_NOT_READY" || code === "PRODUCTS_NOT_READY") {
      throw Object.assign(new Error("Transactions are still being prepared by your bank. Please try again in a moment."), { code: "PRODUCT_NOT_READY" });
    }
    throw error;
  }
}
