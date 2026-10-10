"""Tests for the DOCX builder — output must be a valid OOXML zip."""
from __future__ import annotations

import base64
import io
import zipfile

from app.docx.build_docx import build_docx

RESUME = {
    "name": "Alex Rivera",
    "contact": "alex@example.com | Austin, TX",
    "summary": "Backend engineer with 5 years building scalable APIs.",
    "experience": [{
        "title": "Senior Backend Engineer", "company": "PayCore",
        "location": "Austin, TX", "dates": "Jan 2021 – Present",
        "bullets": ["Built payment APIs in Python", "Cut fraud losses by 23%"],
    }],
    "education": [{
        "degree": "B.Sc. Computer Science", "school": "State University",
        "location": "Austin, TX", "dates": "Aug 2015 – May 2019",
    }],
    "skills": {"Languages": ["Python", "TypeScript"]},
    "projects": [],
    "certifications": ["AWS Certified Developer | Amazon | 2022"],
    "additional_sections": [{"title": "Awards", "entries": ["Best Engineer 2022"]}],
}


def test_build_docx_valid_zip():
    b64 = build_docx(RESUME)
    assert b64
    raw = base64.b64decode(b64)
    zf = zipfile.ZipFile(io.BytesIO(raw))
    assert zf.testzip() is None  # no corrupt entries
    names = zf.namelist()
    assert "[Content_Types].xml" in names
    assert "word/document.xml" in names
    doc = zf.read("word/document.xml").decode("utf-8")
    assert "Alex Rivera" in doc
    assert "Senior Backend Engineer" in doc
    assert "Awards" in doc


def test_build_docx_empty_sections_omitted():
    sparse = {"name": "A", "contact": "a@b.com", "experience": [], "education": [], "skills": {}, "projects": [], "certifications": []}
    b64 = build_docx(sparse)
    assert b64
    zf = zipfile.ZipFile(io.BytesIO(base64.b64decode(b64)))
    doc = zf.read("word/document.xml").decode("utf-8")
    assert "Professional Summary" not in doc
    assert "Work Experience" not in doc
