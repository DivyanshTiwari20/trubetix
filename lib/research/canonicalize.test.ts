import { describe, expect, it } from "vitest";
import { canonicalizeUrl, extractHostname, isValidHttpUrl } from "./canonicalize";

describe("canonicalizeUrl", () => {
  it("lowercases the host, drops www and the fragment", () => {
    expect(canonicalizeUrl("HTTPS://WWW.Example.com/Path#frag")).toBe(
      "https://example.com/Path",
    );
  });

  it("removes tracking parameters and sorts the remaining query", () => {
    expect(canonicalizeUrl("https://example.com/a?b=2&utm_source=x&a=1&fbclid=z")).toBe(
      "https://example.com/a?a=1&b=2",
    );
  });

  it("drops default ports but keeps meaningful paths", () => {
    expect(canonicalizeUrl("https://example.com:443/press/release/")).toBe(
      "https://example.com/press/release",
    );
  });

  it("returns the trimmed input when the URL cannot be parsed", () => {
    expect(canonicalizeUrl("  not a url  ")).toBe("not a url");
  });
});

describe("isValidHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isValidHttpUrl("http://example.com")).toBe(true);
    expect(isValidHttpUrl("https://example.com")).toBe(true);
  });

  it("rejects non-http protocols and garbage", () => {
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("ftp://example.com")).toBe(false);
    expect(isValidHttpUrl("not a url")).toBe(false);
  });
});

describe("extractHostname", () => {
  it("normalizes case and strips www", () => {
    expect(extractHostname("https://www.Example.com/x")).toBe("example.com");
  });

  it("returns null for unparseable input", () => {
    expect(extractHostname("nope")).toBeNull();
  });
});
