// ─────────────────────────────────────────
// build-docx.ts — JSON → DOCX Builder
// DOCX is PRIMARY output (95%+ ATS parse rate)
// Same source JSON as LaTeX — single source of truth
// Generates base64 DOCX using proper ZIP structure
// ─────────────────────────────────────────

import type { ResumeJSON } from "../types.ts";

function xmlEscape(s: unknown): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Build the main document XML content
function buildDocumentXML(resume: ResumeJSON): string {
  const sections: string[] = [];

  const boldPara = (text: string, size = 28) =>
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr><w:t>${xmlEscape(text)}</w:t></w:r></w:p>`;

  const para = (text: string, indent = 0) =>
    `<w:p>${indent ? `<w:pPr><w:ind w:left="${indent}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;

  const sectionHeader = (title: string) =>
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="0F3773"/></w:rPr><w:t>${xmlEscape(title)}</w:t></w:r></w:p>`;

  const bullet = (text: string) =>
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;

  const jobHeader = (title: string, company: string, location: string, dates: string) =>
    `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(title)} — ${xmlEscape(company)}</w:t></w:r><w:r><w:rPr><w:color w:val="666666"/></w:rPr><w:t xml:space="preserve">   ${xmlEscape(location)} | ${xmlEscape(dates)}</w:t></w:r></w:p>`;

  // Header
  sections.push(boldPara(resume.name || "", 32));
  sections.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="555555"/><w:sz w:val="18"/></w:rPr><w:t>${xmlEscape(resume.contact)}</w:t></w:r></w:p>`);
  sections.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="0F3773"/></w:pBdr></w:pPr></w:p>`);

  // Professional Summary — omitted entirely (no heading, no content) when
  // the candidate genuinely has no summary, rather than printing an empty
  // "Professional Summary" heading over nothing.
  if (resume.summary) {
    sections.push(sectionHeader("Professional Summary"));
    sections.push(para(resume.summary));
  }

  // Work Experience — a candidate with no experience yet (student/new
  // grad) is normal; omit the section rather than printing an empty
  // heading or inventing a role.
  if (resume.experience?.length) {
    sections.push(sectionHeader("Work Experience"));
    resume.experience.forEach(job => {
      sections.push(jobHeader(job.title, job.company, job.location, job.dates));
      (job.bullets || []).forEach(b => sections.push(bullet(b)));
      sections.push(`<w:p/>`);
    });
  }

  // Education
  if (resume.education?.length) {
    sections.push(sectionHeader("Education"));
    resume.education.forEach(edu => {
      sections.push(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${xmlEscape(edu.degree)}</w:t></w:r><w:r><w:rPr><w:color w:val="666666"/></w:rPr><w:t xml:space="preserve">   ${xmlEscape(edu.school)} | ${xmlEscape(edu.dates)}</w:t></w:r></w:p>`);
      if (edu.details) sections.push(`<w:p><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="555555"/></w:rPr><w:t>${xmlEscape(edu.details)}</w:t></w:r></w:p>`);
    });
  }

  // Skills
  if (resume.skills && Object.keys(resume.skills).length) {
    sections.push(sectionHeader("Skills"));
    Object.entries(resume.skills).forEach(([cat, items]) => {
      sections.push(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(cat)}: </w:t></w:r><w:r><w:t>${xmlEscape((items as string[]).join(", "))}</w:t></w:r></w:p>`);
    });
  }

  // Projects
  // NOTE: p.link is rendered here (right-aligned, monospace-ish via a
  // trailing run) to match the LaTeX builder's \hfill link treatment —
  // previously this field was silently dropped in DOCX output while
  // present in every PDF, a real PDF/DOCX content-parity gap.
  if (resume.projects?.length) {
    sections.push(sectionHeader("Projects"));
    resume.projects.forEach(p => {
      const linkRun = p.link
        ? `<w:r><w:tab/></w:r><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="666666"/></w:rPr><w:t xml:space="preserve">${xmlEscape(p.link)}</w:t></w:r>`
        : "";
      sections.push(`<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9350"/></w:tabs></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(p.name)} </w:t></w:r><w:r><w:rPr><w:i/><w:sz w:val="18"/></w:rPr><w:t>— ${xmlEscape(p.tech)}</w:t></w:r>${linkRun}</w:p>`);
      (p.bullets || []).forEach(b => sections.push(bullet(b)));
      sections.push(`<w:p/>`);
    });
  }

  // Certifications
  if (resume.certifications?.length) {
    sections.push(sectionHeader("Certifications"));
    resume.certifications.forEach(c => sections.push(bullet(c)));
  }

  // Additional / custom sections (Awards, Publications, Research,
  // Leadership, Volunteer Experience, Languages, or any other title the
  // original resume actually used). Rendered under its OWN title — never
  // renamed — and skipped entirely when it has no entries. See
  // types.ts (ResumeAdditionalSection) and the template-adaptation
  // master prompt this pipeline follows: legitimate sections beyond the
  // fixed fields above must never be silently dropped.
  (resume.additional_sections || []).forEach(sec => {
    if (!sec.title?.trim() || !sec.entries?.length) return;
    sections.push(sectionHeader(sec.title));
    sec.entries.forEach(e => sections.push(bullet(e)));
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${sections.join("\n    ")}
    <w:sectPr>
      <w:pgMar w:top="720" w:right="864" w:bottom="720" w:left="864"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

// Required DOCX files
function contentTypesXML(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
}

function rootRelsXML(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function docRelsXML(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function numberingXML(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:cs="Symbol"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
</w:numbering>`;
}

function stylesXML(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr><w:spacing w:before="240" w:after="60"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="0F3773"/><w:sz w:val="28"/></w:rPr>
  </w:style>
</w:styles>`;
}

// Simple ZIP implementation for Deno (stored/uncompressed entries).
//
// BUG FIX: the previous version hard-coded the central directory's
// "relative offset of local file header" field to 0 for every entry.
// That field is not decorative — every ZIP reader (Word, LibreOffice,
// python-docx, most ATS parsers) uses it to seek directly to each file's
// local header instead of linearly scanning the archive. With every
// offset wrongly set to 0, only the FIRST file in the archive resolved
// correctly; every other entry pointed back at the first file's header,
// corrupting the archive for any strict reader (verified: Python's
// `zipfile.ZipFile.testzip()` failed with "File name in directory
// '_rels/.rels' and header b'[Content_Types].xml' differ" — a demonstrably
// broken DOCX, not a hypothetical one). This version tracks the real,
// cumulative byte offset of every local file header as it is written and
// stores that value in each central directory entry, which is the
// correct ZIP format behavior.
class SimpleZip {
  private files: Map<string, Uint8Array> = new Map();

  addFile(name: string, content: string | Uint8Array): void {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    this.files.set(name, bytes);
  }

  async generate(): Promise<Uint8Array> {
    const fileEntries: { name: string; data: Uint8Array; crc32: number; localHeaderOffset: number }[] = [];
    let offset = 0;

    // Pass 1: compute the real offset of each local file header as it
    // will be written, in the SAME order files are written in pass 2.
    for (const [name, data] of this.files) {
      const crc32 = this.crc32(data);
      const header = this.createLocalFileHeader(name, data.length, crc32);
      fileEntries.push({ name, data, crc32, localHeaderOffset: offset });
      offset += header.length + data.length;
    }
    const centralDirStart = offset;

    // Pass 2: build central directory entries using the REAL offsets
    // computed above (this was the bug — it previously passed 0).
    const centralDirEntries: Uint8Array[] = fileEntries.map((entry) =>
      this.createCentralDirectoryHeader(entry)
    );
    const centralDirSize = centralDirEntries.reduce((sum, h) => sum + h.length, 0);

    const endOfCentralDir = this.createEndOfCentralDirectory(fileEntries.length, centralDirSize, centralDirStart);

    const totalSize = centralDirStart + centralDirSize + endOfCentralDir.length;
    const result = new Uint8Array(totalSize);
    let pos = 0;

    // Write local file headers + data (must match the offsets computed above)
    for (const entry of fileEntries) {
      const header = this.createLocalFileHeader(entry.name, entry.data.length, entry.crc32);
      result.set(header, pos);
      pos += header.length;
      result.set(entry.data, pos);
      pos += entry.data.length;
    }

    // Central directory
    for (const header of centralDirEntries) {
      result.set(header, pos);
      pos += header.length;
    }

    // End of central directory
    result.set(endOfCentralDir, pos);

    return result;
  }

  private crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    const table = this.makeCRCTable();
    for (let i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  private makeCRCTable(): number[] {
    const table = new Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  }

  private createLocalFileHeader(name: string, size: number, crc32: number): Uint8Array {
    const nameBytes = new TextEncoder().encode(name);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // Local file header signature
    view.setUint16(4, 20, true); // Version needed
    view.setUint16(6, 0, true); // General purpose flag
    view.setUint16(8, 0, true); // Compression method (0 = store)
    view.setUint16(10, 0, true); // File time
    view.setUint16(12, 0, true); // File date
    view.setUint32(14, crc32, true); // CRC-32
    view.setUint32(18, size, true); // Compressed size
    view.setUint32(22, size, true); // Uncompressed size
    view.setUint16(26, nameBytes.length, true); // File name length
    view.setUint16(28, 0, true); // Extra field length
    header.set(nameBytes, 30);
    return header;
  }

  private createCentralDirectoryHeader(entry: { name: string; data: Uint8Array; crc32: number; localHeaderOffset: number }): Uint8Array {
    const nameBytes = new TextEncoder().encode(entry.name);
    const header = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true); // Central directory signature
    view.setUint16(4, 20, true); // Version made by
    view.setUint16(6, 20, true); // Version needed
    view.setUint16(8, 0, true); // General purpose flag
    view.setUint16(10, 0, true); // Compression method
    view.setUint16(12, 0, true); // File time
    view.setUint16(14, 0, true); // File date
    view.setUint32(16, entry.crc32, true); // CRC-32
    view.setUint32(20, entry.data.length, true); // Compressed size (stored = uncompressed size)
    view.setUint32(24, entry.data.length, true); // Uncompressed size
    view.setUint16(28, nameBytes.length, true); // File name length
    view.setUint16(30, 0, true); // Extra field length
    view.setUint16(32, 0, true); // File comment length
    view.setUint16(34, 0, true); // Disk number start
    view.setUint16(36, 0, true); // Internal file attributes
    view.setUint32(38, 0, true); // External file attributes
    view.setUint32(42, entry.localHeaderOffset, true); // Relative offset of local header — REAL offset, not 0
    header.set(nameBytes, 46);
    return header;
  }

  private createEndOfCentralDirectory(numEntries: number, centralDirSize: number, centralDirOffset: number): Uint8Array {
    const header = new Uint8Array(22);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x06054b50, true); // End of central directory signature
    view.setUint16(4, 0, true); // Number of this disk
    view.setUint16(6, 0, true); // Disk where central dir starts
    view.setUint16(8, numEntries, true); // Number of entries on this disk
    view.setUint16(10, numEntries, true); // Total number of entries
    view.setUint32(12, centralDirSize, true); // Size of central directory
    view.setUint32(16, centralDirOffset, true); // Offset of central directory
    view.setUint16(20, 0, true); // Comment length
    return header;
  }
}

// Main function — build complete DOCX as base64
export async function buildDOCX(resume: ResumeJSON): Promise<string | null> {
  try {
    const documentXML = buildDocumentXML(resume);
    const zip = new SimpleZip();

    zip.addFile("[Content_Types].xml", contentTypesXML());
    zip.addFile("_rels/.rels", rootRelsXML());
    zip.addFile("word/document.xml", documentXML);
    zip.addFile("word/_rels/document.xml.rels", docRelsXML());
    zip.addFile("word/numbering.xml", numberingXML());
    zip.addFile("word/styles.xml", stylesXML());

    const zipBytes = await zip.generate();
    let binary = "";
    for (let i = 0; i < zipBytes.length; i++) {
      binary += String.fromCharCode(zipBytes[i]);
    }
    return btoa(binary);
  } catch (err) {
    console.error("DOCX build error:", err);
    return null;
  }
}
