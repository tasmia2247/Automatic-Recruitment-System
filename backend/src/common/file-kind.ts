/** What a ".doc" file really holds: Word 97-2003 (OLE), a renamed DOCX, RTF, or a web page saved as .doc; null for anything else. */
export function docKind(buffer: Buffer): 'ole' | 'docx' | 'rtf' | 'html' | null {
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0xd0cf11e0 && buffer.readUInt32BE(4) === 0xa1b11ae1) return 'ole';
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'docx';
  const head = buffer.subarray(0, 512).toString('latin1').replace(/^﻿|^ï»¿/, '').trimStart().toLowerCase();
  if (head.startsWith('{\\rtf')) return 'rtf';
  if (/^(<!doctype html|<html|<\?xml|mime-version:)/.test(head) || head.includes('<html')) return 'html';
  return null;
}
