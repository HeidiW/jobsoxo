import { describe, expect, it } from "vitest";
import { parseGooglePlaceDetails } from "./address-autocomplete";

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