import { describe, expect, it } from "vitest";

import { extractFormFields } from "@/lib/forms/extract";

describe("extractFormFields", () => {
  it("returns absent when result is null", () => {
    const r = extractFormFields(null);
    expect(r.source).toBe("absent");
    expect(r.fields).toEqual([]);
  });

  it("flattens result.structured.fields.form into entries", () => {
    const result = {
      structured: {
        fields: {
          form: {
            full_name: "Alice Doe",
            date_of_birth: "1990-01-15",
            email: "alice@example.com",
            checked_options: ["yes", "agree"],
          },
        },
      },
    };
    const r = extractFormFields(result);
    expect(r.source).toBe("result.structured.fields.form");
    expect(r.byField.full_name).toBe("Alice Doe");
    expect(r.byField.date_of_birth).toBe("1990-01-15");
    expect(r.byField.checked_options).toBe("yes, agree");
    expect(r.fields.find((f) => f.field === "full_name")?.value).toBe("Alice Doe");
  });

  it("walks nested sections with dotted keys", () => {
    const result = {
      structured: {
        fields: {
          form: {
            applicant: { name: "Bob", phone: "555-1234" },
            employer: { company: "ACME" },
          },
        },
      },
    };
    const r = extractFormFields(result);
    expect(r.byField["applicant.name"]).toBe("Bob");
    expect(r.byField["applicant.phone"]).toBe("555-1234");
    expect(r.byField["employer.company"]).toBe("ACME");
  });

  it("falls back to per-page fields when structured.fields.form is missing", () => {
    const result = {
      structured: {
        pages: [
          { pageNumber: 1, fields: { form: { name: "Alice" } } },
          { pageNumber: 2, fields: { form: { signature: "AD" } } },
        ],
      },
    };
    const r = extractFormFields(result);
    expect(r.source).toBe("page-fields");
    expect(r.byField.name).toBe("Alice");
    expect(r.byField.signature).toBe("AD");
    const named = r.fields.find((f) => f.field === "name");
    expect(named?.page).toBe(1);
  });

  it("ignores empty strings, nulls, and undefined values", () => {
    const result = {
      structured: { fields: { form: { name: "", email: null, phone: undefined, age: 0 } } },
    };
    const r = extractFormFields(result);
    expect(r.byField.name).toBeUndefined();
    expect(r.byField.email).toBeUndefined();
    expect(r.byField.phone).toBeUndefined();
    expect(r.byField.age).toBe(0);
  });

  it("preserves boolean values verbatim", () => {
    const result = { structured: { fields: { form: { agreed: true, optedOut: false } } } };
    const r = extractFormFields(result);
    expect(r.byField.agreed).toBe(true);
    expect(r.byField.optedOut).toBe(false);
  });

  it("returns absent when the form object is empty", () => {
    expect(extractFormFields({ structured: { fields: { form: {} } } }).source).toBe("absent");
  });
});
