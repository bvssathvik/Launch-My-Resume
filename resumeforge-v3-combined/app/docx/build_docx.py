"""JSON → DOCX builder — port of docx/build-docx.ts.

DOCX is PRIMARY output (95%+ ATS parse rate). Built from the SAME
ResumeJSON as LaTeX (single source of truth). The previous Deno code
included a hand-rolled ZIP writer with a known offset bug; this Python
port uses the stdlib `zipfile` module, which produces spec-correct
archives that Word, LibreOffice, python-docx and ATS parsers accept.
"""
from __future__ import annotations

import base64
import io
import logging
import zipfile

log = logging.getLogger("resumeforge.docx")


def _xml_escape(s: object) -> str:
    if not s:
        return ""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _build_document_xml(resume: dict) -> str:
    sections: list[str] = []

    def bold_para(text: str, size: int = 28) -> str:
        return (
            '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr>'
            f'<w:b/><w:sz w:val="{size}"/></w:rPr><w:t>{_xml_escape(text)}</w:t></w:r></w:p>'
        )

    def para(text: str, indent: int = 0) -> str:
        ppr = f'<w:pPr><w:ind w:left="{indent}"/></w:pPr>' if indent else ""
        return f'<w:p>{ppr}<w:r><w:t xml:space="preserve">{_xml_escape(text)}</w:t></w:r></w:p>'

    def section_header(title: str) -> str:
        return (
            '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr>'
            f'<w:b/><w:color w:val="0F3773"/></w:rPr><w:t>{_xml_escape(title)}</w:t></w:r></w:p>'
        )

    def bullet(text: str) -> str:
        return (
            '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
            f'<w:r><w:t xml:space="preserve">{_xml_escape(text)}</w:t></w:r></w:p>'
        )

    def job_header(title: str, company: str, location: str, dates: str) -> str:
        return (
            "<w:p><w:r><w:rPr><w:b/></w:rPr>"
            f'<w:t xml:space="preserve">{_xml_escape(title)} — {_xml_escape(company)}</w:t></w:r>'
            '<w:r><w:rPr><w:color w:val="666666"/></w:rPr>'
            f'<w:t xml:space="preserve">   {_xml_escape(location)} | {_xml_escape(dates)}</w:t></w:r></w:p>'
        )

    sections.append(bold_para(resume.get("name") or "", 32))
    sections.append(
        '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="555555"/>'
        f'<w:sz w:val="18"/></w:rPr><w:t>{_xml_escape(resume.get("contact"))}</w:t></w:r></w:p>'
    )
    sections.append('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="0F3773"/></w:pBdr></w:pPr></w:p>')

    if resume.get("summary"):
        sections.append(section_header("Professional Summary"))
        sections.append(para(resume["summary"]))

    if resume.get("experience"):
        sections.append(section_header("Work Experience"))
        for job in resume["experience"]:
            sections.append(job_header(job.get("title", ""), job.get("company", ""), job.get("location", ""), job.get("dates", "")))
            sections.extend(bullet(b) for b in job.get("bullets") or [])
            sections.append("<w:p/>")

    if resume.get("education"):
        sections.append(section_header("Education"))
        for edu in resume["education"]:
            sections.append(
                "<w:p><w:r><w:rPr><w:b/></w:rPr>"
                f'<w:t>{_xml_escape(edu.get("degree"))}</w:t></w:r><w:r><w:rPr><w:color w:val="666666"/></w:rPr>'
                f'<w:t xml:space="preserve">   {_xml_escape(edu.get("school"))} | {_xml_escape(edu.get("dates"))}</w:t></w:r></w:p>'
            )
            if edu.get("details"):
                sections.append(
                    "<w:p><w:r><w:rPr><w:sz w:val=\"18\"/><w:color w:val=\"555555\"/></w:rPr>"
                    f"<w:t>{_xml_escape(edu['details'])}</w:t></w:r></w:p>"
                )

    if resume.get("skills"):
        sections.append(section_header("Skills"))
        for cat, items in resume["skills"].items():
            sections.append(
                '<w:p><w:r><w:rPr><w:b/></w:rPr>'
                f'<w:t xml:space="preserve">{_xml_escape(cat)}: </w:t></w:r><w:r><w:t>{_xml_escape(", ".join(items))}</w:t></w:r></w:p>'
            )

    if resume.get("projects"):
        sections.append(section_header("Projects"))
        for p in resume["projects"]:
            link_run = ""
            if p.get("link"):
                link_run = (
                    '<w:r><w:tab/></w:r><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="666666"/></w:rPr>'
                    f'<w:t xml:space="preserve">{_xml_escape(p["link"])}</w:t></w:r>'
                )
            sections.append(
                '<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9350"/></w:tabs></w:pPr><w:r><w:rPr><w:b/></w:rPr>'
                f'<w:t xml:space="preserve">{_xml_escape(p.get("name"))} </w:t></w:r><w:r><w:rPr><w:i/><w:sz w:val="18"/></w:rPr>'
                f'<w:t>— {_xml_escape(p.get("tech"))}</w:t></w:r>{link_run}</w:p>'
            )
            sections.extend(bullet(b) for b in p.get("bullets") or [])
            sections.append("<w:p/>")

    if resume.get("certifications"):
        sections.append(section_header("Certifications"))
        sections.extend(bullet(c) for c in resume["certifications"])

    for sec in resume.get("additional_sections") or []:
        if not sec.get("title", "").strip() or not sec.get("entries"):
            continue
        sections.append(section_header(sec["title"]))
        sections.extend(bullet(e) for e in sec["entries"])

    body = "\n    ".join(sections)
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"\n'
        '  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"\n'
        '  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n'
        "  <w:body>\n"
        f"    {body}\n"
        "    <w:sectPr>\n"
        '      <w:pgMar w:top="720" w:right="864" w:bottom="720" w:left="864"/>\n'
        "    </w:sectPr>\n"
        "  </w:body>\n"
        "</w:document>"
    )


def _content_types_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
        '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
        '  <Default Extension="xml" ContentType="application/xml"/>\n'
        '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n'
        '  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>\n'
        '  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>\n'
        "</Types>"
    )


def _root_rels_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n'
        "</Relationships>"
    )


def _doc_rels_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>\n'
        '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n'
        "</Relationships>"
    )


def _numbering_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n'
        '  <w:abstractNum w:abstractNumId="0">\n'
        '    <w:multiLevelType w:val="hybridMultilevel"/>\n'
        '    <w:lvl w:ilvl="0">\n'
        '      <w:start w:val="1"/>\n'
        '      <w:numFmt w:val="bullet"/>\n'
        '      <w:lvlText w:val="•"/>\n'
        '      <w:lvlJc w:val="left"/>\n'
        '      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>\n'
        '      <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:cs="Symbol"/></w:rPr>\n'
        "    </w:lvl>\n"
        "  </w:abstractNum>\n"
        '  <w:num w:numId="1">\n'
        '    <w:abstractNumId w:val="0"/>\n'
        "  </w:num>\n"
        "</w:numbering>"
    )


def _styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n'
        "  <w:docDefaults>\n"
        '    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>\n'
        '    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>\n'
        "  </w:docDefaults>\n"
        '  <w:style w:type="paragraph" w:styleId="Heading1">\n'
        '    <w:name w:val="heading 1"/>\n'
        '    <w:basedOn w:val="Normal"/>\n'
        '    <w:next w:val="Normal"/>\n'
        "    <w:pPr><w:spacing w:before=\"240\" w:after=\"60\"/></w:pPr>\n"
        '    <w:rPr><w:b/><w:color w:val="0F3773"/><w:sz w:val="28"/></w:rPr>\n'
        "  </w:style>\n"
        "</w:styles>"
    )


def build_docx(resume: dict) -> str | None:
    """Build a complete DOCX from ResumeJSON; returns base64 or None on error."""
    try:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("[Content_Types].xml", _content_types_xml())
            zf.writestr("_rels/.rels", _root_rels_xml())
            zf.writestr("word/document.xml", _build_document_xml(resume))
            zf.writestr("word/_rels/document.xml.rels", _doc_rels_xml())
            zf.writestr("word/numbering.xml", _numbering_xml())
            zf.writestr("word/styles.xml", _styles_xml())
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as exc:  # noqa: BLE001 — never crash the pipeline
        log.error("DOCX build error: %s", exc)
        return None
