const PLACES_BASE_URL = "https://places.googleapis.com/v1";
const SUGGESTION_CACHE_TTL_MS = 60_000;
const DETAILS_CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 250;
const RATE_LIMIT_WINDOW_MS = 60_000;
const SUGGESTION_REQUEST_LIMIT = 30;
const DETAILS_REQUEST_LIMIT = 20;
const RATE_LIMIT_MAX_BUCKETS = 10_000;

type CacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

type RateLimitEntry = {
  count: number;
  windowStartedAt: number;
};

const suggestionCache = new Map<string, CacheEntry<AddressSuggestion[]>>();
const detailsCache = new Map<string, CacheEntry<AddressDetails>>();
const rateLimits = new Map<string, RateLimitEntry>();

export interface AddressSuggestion {
  placeId: string;
  label: string;
  mainText: string;
  secondaryText: string;
}

export interface AddressDetails {
  formattedAddress: string;
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

type GoogleAddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

export class AddressLookupRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many address lookup requests");
    this.name = "AddressLookupRateLimitError";
  }
}

function consumeRateLimit(userId: string, kind: "suggestions" | "details", limit: number) {
  const now = Date.now();
  const key = `${kind}:${userId}`;
  const existing = rateLimits.get(key);

  if (!existing || now - existing.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    if (!existing && rateLimits.size >= RATE_LIMIT_MAX_BUCKETS) {
      for (const [entryKey, entry] of rateLimits) {
        if (now - entry.windowStartedAt >= RATE_LIMIT_WINDOW_MS) rateLimits.delete(entryKey);
      }
      if (rateLimits.size >= RATE_LIMIT_MAX_BUCKETS) {
        throw new AddressLookupRateLimitError(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
      }
    }
    rateLimits.set(key, { count: 1, windowStartedAt: now });
  } else {
    if (existing.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil(
        (RATE_LIMIT_WINDOW_MS - (now - existing.windowStartedAt)) / 1000,
      ));
      throw new AddressLookupRateLimitError(retryAfterSeconds);
    }
    existing.count += 1;
  }
}

function getCached<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    cache.delete(key);
    cache.set(key, existing);
    return existing.value;
  }
  if (existing) cache.delete(key);

  const value = loader();
  cache.set(key, { expiresAt: now + ttlMs, value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return value;
}

function getApiKey(): string {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) throw new Error("Google Maps address suggestions are not configured");
  return apiKey;
}

async function readGoogleResponse(response: Response) {
  if (response.ok) return response.json();
  const body = await response.text();
  throw new Error(`Google Places request failed (${response.status}): ${body.slice(0, 500)}`);
}

export async function searchAddresses(input: string, sessionToken?: string): Promise<AddressSuggestion[]> {
  const response = await fetch(`${PLACES_BASE_URL}/places:autocomplete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": getApiKey(),
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify({
      input,
      languageCode: "en",
      regionCode: "US",
      sessionToken: sessionToken || undefined,
    }),
  });
  const data = await readGoogleResponse(response) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
      };
    }>;
  };

  return (data.suggestions ?? []).flatMap(({ placePrediction }) => {
    if (!placePrediction?.placeId || !placePrediction.text?.text) return [];
    return [{
      placeId: placePrediction.placeId,
      label: placePrediction.text.text,
      mainText: placePrediction.structuredFormat?.mainText?.text || placePrediction.text.text,
      secondaryText: placePrediction.structuredFormat?.secondaryText?.text || "",
    }];
  });
}

export function parseGooglePlaceDetails(data: {
  formattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
}): AddressDetails {
  const components = data.addressComponents ?? [];
  const component = (type: string) => components.find((item) => item.types?.includes(type));
  const streetNumber = component("street_number")?.longText || "";
  const route = component("route")?.longText || "";
  const city = component("locality")?.longText
    || component("postal_town")?.longText
    || component("sublocality")?.longText
    || component("administrative_area_level_2")?.longText
    || "";

  return {
    formattedAddress: data.formattedAddress || "",
    streetAddress: [streetNumber, route].filter(Boolean).join(" "),
    city,
    state: component("administrative_area_level_1")?.shortText || "",
    postalCode: component("postal_code")?.longText || "",
    country: component("country")?.shortText || "",
  };
}

export async function getAddressDetails(placeId: string, sessionToken?: string): Promise<AddressDetails> {
  const params = new URLSearchParams({ languageCode: "en", regionCode: "US" });
  if (sessionToken) params.set("sessionToken", sessionToken);
  const response = await fetch(`${PLACES_BASE_URL}/places/${encodeURIComponent(placeId)}?${params}`, {
    headers: {
      "X-Goog-Api-Key": getApiKey(),
      "X-Goog-FieldMask": "formattedAddress,addressComponents",
    },
  });
  return parseGooglePlaceDetails(await readGoogleResponse(response));
}

export function searchAddressesForUser(
  userId: string,
  input: string,
  sessionToken?: string,
): Promise<AddressSuggestion[]> {
  consumeRateLimit(userId, "suggestions", SUGGESTION_REQUEST_LIMIT);
  const cacheKey = input.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  return getCached(
    suggestionCache,
    cacheKey,
    SUGGESTION_CACHE_TTL_MS,
    () => searchAddresses(input, sessionToken),
  );
}

export function getAddressDetailsForUser(
  userId: string,
  placeId: string,
  sessionToken?: string,
): Promise<AddressDetails> {
  consumeRateLimit(userId, "details", DETAILS_REQUEST_LIMIT);
  return getCached(
    detailsCache,
    placeId,
    DETAILS_CACHE_TTL_MS,
    () => getAddressDetails(placeId, sessionToken),
  );
}

export function resetAddressLookupStateForTests() {
  suggestionCache.clear();
  detailsCache.clear();
  rateLimits.clear();
}