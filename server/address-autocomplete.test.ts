import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AddressLookupRateLimitError,
  getAddressDetailsForUser,
  parseGooglePlaceDetails,
  resetAddressLookupStateForTests,
  searchAddressesForUser,
} from "./address-autocomplete";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetAddressLookupStateForTests();
});

describe("parseGooglePlaceDetails", () => {
  it("extracts structured US address fields", () => {
    expect(parseGooglePlaceDetails({
      formattedAddress: "350 5th Ave, New York, NY 10118, USA",
      addressComponents: [
        { longText: "350", shortText: "350", types: ["street_number"] },
        { longText: "5th Avenue", shortText: "5th Ave", types: ["route"] },
        { longText: "New York", shortText: "New York", types: ["locality"] },
        { longText: "New York", shortText: "NY", types: ["administrative_area_level_1"] },
        { longText: "10118", shortText: "10118", types: ["postal_code"] },
        { longText: "United States", shortText: "US", types: ["country"] },
      ],
    })).toEqual({
      formattedAddress: "350 5th Ave, New York, NY 10118, USA",
      streetAddress: "350 5th Avenue",
      city: "New York",
      state: "NY",
      postalCode: "10118",
      country: "US",
    });
  });

  it("returns empty fields when Google omits optional components", () => {
    expect(parseGooglePlaceDetails({})).toEqual({
      formattedAddress: "",
      streetAddress: "",
      city: "",
      state: "",
      postalCode: "",
      country: "",
    });
  });
});

describe("protected address lookups", () => {
  it("coalesces and caches repeated normalized suggestion queries", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      suggestions: [{
        placePrediction: {
          placeId: "place-1",
          text: { text: "10 Main St" },
        },
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      searchAddressesForUser("user-1", "10  Main St", "session-1"),
      searchAddressesForUser("user-1", " 10 main st ", "session-2"),
    ]);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches place details by place ID", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      formattedAddress: "10 Main St, Boston, MA",
      addressComponents: [],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await getAddressDetailsForUser("user-1", "place-1", "session-1");
    await getAddressDetailsForUser("user-2", "place-1", "session-2");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rate-limits suggestion requests independently per user", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ suggestions: [] }), { status: 200 }),
    ));

    for (let index = 0; index < 30; index += 1) {
      await searchAddressesForUser("busy-user", `query-${index}`);
    }

    expect(() => searchAddressesForUser("busy-user", "one-too-many"))
      .toThrow(AddressLookupRateLimitError);
    await expect(searchAddressesForUser("other-user", "still-allowed")).resolves.toEqual([]);
  });

  it("rate-limits detail requests separately from suggestions", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ formattedAddress: "10 Main St" }), { status: 200 }),
    ));

    for (let index = 0; index < 20; index += 1) {
      await getAddressDetailsForUser("busy-user", `place-${index}`);
    }

    expect(() => getAddressDetailsForUser("busy-user", "one-too-many"))
      .toThrow(AddressLookupRateLimitError);
    await expect(searchAddressesForUser("busy-user", "still separate")).resolves.toEqual([]);
  });

  it("does not cache failed Google requests", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ suggestions: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchAddressesForUser("user-1", "10 Main St")).rejects.toThrow(
      "Google Places request failed (503)",
    );
    await expect(searchAddressesForUser("user-1", "10 Main St")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});