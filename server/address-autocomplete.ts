const PLACES_BASE_URL = "https://places.googleapis.com/v1";

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