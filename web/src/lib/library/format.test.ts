import { describe, expect, it } from "vitest";

import {
  dropboxHomeUrl,
  fileNameFromPath,
  formatAudioSpec,
  formatDuration,
  formatExactTime,
  formatMVersion,
  formatMegabytes,
  formatRelativeTime,
  formatReleaseDate,
  formatSampleRate,
  isValidIsoDate,
  parseDuration,
  safeExternalUrl,
} from "./format";

describe("duration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(185)).toBe("3:05");
    expect(formatDuration(185.6)).toBe("3:06");
    expect(formatDuration(3725)).toBe("62:05");
  });

  it("formats missing or bad values as empty", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
    expect(formatDuration(-4)).toBe("");
  });

  it("parses m:ss", () => {
    expect(parseDuration("3:05")).toBe(185);
    expect(parseDuration(" 0:30 ")).toBe(30);
    expect(parseDuration("12:00")).toBe(720);
  });

  it("reads a bare number as minutes", () => {
    expect(parseDuration("4")).toBe(240);
  });

  it("rejects bad input", () => {
    for (const bad of ["", "  ", "3:5", "3:75", "abc", "3:", ":30", "1:2:3", "-1:00", "3.5"]) {
      expect(parseDuration(bad)).toBeNull();
    }
    expect(parseDuration(null)).toBeNull();
  });

  it("round trips", () => {
    for (const s of [0, 1, 59, 60, 61, 185, 599, 3600]) expect(parseDuration(formatDuration(s))).toBe(s);
  });
});

describe("dates", () => {
  it("formats release dates", () => {
    expect(formatReleaseDate("2026-10-23")).toBe("23 Oct 2026");
    expect(formatReleaseDate("2026-01-05")).toBe("5 Jan 2026");
    expect(formatReleaseDate("2026-01-05T10:00:00Z")).toBe("5 Jan 2026");
  });

  it("shows a dash for missing or invalid dates", () => {
    expect(formatReleaseDate(null)).toBe("—");
    expect(formatReleaseDate("")).toBe("—");
    expect(formatReleaseDate("soon")).toBe("—");
    expect(formatReleaseDate("2026-13-01")).toBe("—");
  });

  it("validates calendar dates", () => {
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-2-9")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });

  it("formats relative time", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    expect(formatRelativeTime("2026-10-12T11:59:40Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-10-12T11:30:00Z", now)).toBe("30 min ago");
    expect(formatRelativeTime("2026-10-12T07:00:00Z", now)).toBe("5 h ago");
    expect(formatRelativeTime("2026-10-09T12:00:00Z", now)).toBe("3 d ago");
    expect(formatRelativeTime("2026-05-01T12:00:00Z", now)).toBe("1 May 2026");
    expect(formatRelativeTime("nope", now)).toBe("");
  });

  it("formats exact time in UTC", () => {
    expect(formatExactTime("2026-10-12T07:05:00Z")).toBe("12 Oct 2026 07:05 UTC");
  });
});

describe("file formatting", () => {
  it("formats sizes in MB", () => {
    expect(formatMegabytes(1_500_000)).toBe("1.50 MB");
    expect(formatMegabytes(25_340_000)).toBe("25.3 MB");
    expect(formatMegabytes(250_000_000)).toBe("250 MB");
    expect(formatMegabytes(null)).toBe("");
  });

  it("formats sample rate", () => {
    expect(formatSampleRate(44100)).toBe("44.1 kHz");
    expect(formatSampleRate(48000)).toBe("48 kHz");
    expect(formatSampleRate(null)).toBe("");
  });

  it("formats the audio spec line", () => {
    expect(formatAudioSpec({ sample_rate: 44100, bit_depth: 24, channels: 2 })).toBe("44.1 kHz · 24-bit · stereo");
    expect(formatAudioSpec({ sample_rate: 48000, bit_depth: null, channels: 1 })).toBe("48 kHz · mono");
    expect(formatAudioSpec({ sample_rate: null, bit_depth: null, channels: 6 })).toBe("6 ch");
    expect(formatAudioSpec({ sample_rate: null, bit_depth: null, channels: null })).toBe("");
  });

  it("formats master versions", () => {
    expect(formatMVersion([2])).toBe("M2");
    expect(formatMVersion([1, 2])).toBe("M1/M2");
    expect(formatMVersion([])).toBe("");
    expect(formatMVersion(null)).toBe("");
  });

  it("takes the file name from either path style", () => {
    expect(fileNameFromPath("Kyden - Fast/Master/fast_M2.wav")).toBe("fast_M2.wav");
    expect(fileNameFromPath("Y:\\x\\fast.wav")).toBe("fast.wav");
    expect(fileNameFromPath("fast.wav")).toBe("fast.wav");
  });
});

describe("safeExternalUrl", () => {
  it("keeps http(s) links", () => {
    expect(safeExternalUrl("https://www.dropbox.com/sh/abc?dl=0")).toBe("https://www.dropbox.com/sh/abc?dl=0");
    expect(safeExternalUrl("  http://example.com/a ")).toBe("http://example.com/a");
  });

  it("drops anything else", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.test/a", "not a url", "", "  "]) {
      expect(safeExternalUrl(bad)).toBeNull();
    }
    expect(safeExternalUrl(null)).toBeNull();
  });
});

describe("dropboxHomeUrl", () => {
  it("encodes each segment but keeps the slashes", () => {
    expect(dropboxHomeUrl("/TG Music/Kyden - Fast/fast #1 (M2).wav")).toBe(
      "https://www.dropbox.com/home/TG%20Music/Kyden%20-%20Fast/fast%20%231%20(M2).wav",
    );
  });

  it("works without a leading slash and with odd characters", () => {
    expect(dropboxHomeUrl("a/b&c?d/é.wav")).toBe("https://www.dropbox.com/home/a/b%26c%3Fd/%C3%A9.wav");
  });
});
