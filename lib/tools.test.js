"use strict";

const { expect } = require("chai");
const { isArray, isObject, translateText } = require("./tools");

describe("lib/tools", () => {
  describe("isArray", () => {
    it("returns true for arrays", () => {
      expect(isArray([1, 2, 3])).to.equal(true);
    });

    it("returns false for non-arrays", () => {
      expect(isArray({ a: 1 })).to.equal(false);
      expect(isArray(null)).to.equal(false);
      expect(isArray("abc")).to.equal(false);
    });
  });

  describe("isObject", () => {
    it("returns true for plain objects", () => {
      expect(isObject({ a: 1 })).to.equal(true);
    });

    it("returns false for arrays, null and primitives", () => {
      expect(isObject([1, 2, 3])).to.equal(false);
      expect(isObject(null)).to.equal(false);
      expect(isObject("abc")).to.equal(false);
      expect(isObject(42)).to.equal(false);
    });
  });

  describe("translateText", () => {
    it("returns input as-is when target language is en", async () => {
      const result = await translateText("Hello", "en");
      expect(result).to.equal("Hello");
    });

    it("returns empty string for empty input", async () => {
      const result = await translateText("", "de");
      expect(result).to.equal("");
    });
  });
});
