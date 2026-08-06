import { describe, it, expect } from 'vitest';
import { parseSubtitles, parseSubtitleTime, formatSubtitleTime } from '../parser';

describe('Subtitle Parser Edge Cases & Security Sanitization', () => {

  describe('SRT Format Parser Resilience', () => {

    it('parses standard SRT format correctly', () => {
      const srt = `1
00:00:01,000 --> 00:00:04,000
Hello World!

2
00:00:05,500 --> 00:00:08,250
Second line of captions`;

      const result = parseSubtitles(srt);
      expect(result.length).toBe(2);
      expect(result[0].text).toBe('Hello World!');
      expect(result[0].startTime).toBe(1);
      expect(result[0].endTime).toBe(4);
      expect(result[1].startTime).toBe(5.5);
      expect(result[1].endTime).toBe(8.25);
    });

    it('handles malformed line breaks and extra blank spaces gracefully', () => {
      const srt = `\n\r\n1\r\n00:00:00,000 --> 00:00:02,000\r\nSpaced out text\r\n\r\n\r\n2\r\n00:00:03,000 --> 00:00:05,000\r\nDone\r\n`;
      const result = parseSubtitles(srt);
      expect(result.length).toBe(2);
      expect(result[0].text).toBe('Spaced out text');
    });

    it('handles UTF-8 BOM byte prefixes without throwing', () => {
      const bomSrt = `\uFEFF1\n00:00:01,000 --> 00:00:03,000\nBOM caption`;
      const result = parseSubtitles(bomSrt);
      expect(result.length).toBe(1);
      expect(result[0].text).toBe('BOM caption');
    });

    it('sanitizes and strips HTML formatting tags safely from subtitle text', () => {
      const srt = `1\n00:00:01,000 --> 00:00:03,000\n<b>Bold text</b> & <i>Italics</i>`;
      const result = parseSubtitles(srt);
      expect(result.length).toBe(1);
      expect(result[0].text).toBe('Bold text & Italics');
    });

  });

  describe('Timestamp Format & Converter Resilience', () => {

    it('parses timestamps in HH:MM:SS,mmm format to seconds', () => {
      expect(parseSubtitleTime('00:01:30,500')).toBe(90.5);
      expect(parseSubtitleTime('01:00:00,000')).toBe(3600);
      expect(parseSubtitleTime('00:00:00.250')).toBe(0.25);
    });

    it('formats seconds into SRT and WebVTT timestamp formats accurately', () => {
      expect(formatSubtitleTime(90.5, 'srt')).toBe('00:01:30,500');
      expect(formatSubtitleTime(90.5, 'vtt')).toBe('00:01:30.500');
    });

  });

  describe('WebVTT Format Parser Resilience', () => {

    it('parses WebVTT format including headers', () => {
      const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Welcome to Clypra

00:00:05.000 --> 00:00:07.500
Enjoy your editing session`;

      const result = parseSubtitles(vtt);
      expect(result.length).toBe(2);
      expect(result[0].text).toBe('Welcome to Clypra');
      expect(result[0].startTime).toBe(1);
      expect(result[0].endTime).toBe(4);
    });

  });

});
