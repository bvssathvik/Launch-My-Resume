// ─────────────────────────────────────────
// Tech-Focused Dense
// The most information-dense template: 9.5pt body, 0.45in margins,
// near-zero list spacing, uppercase headers, and a monospaced Skills
// line (\ttfamily — core LaTeX, no package needed) to visually signal
// "stack/tools list" the way a terminal prompt would.
// ─────────────────────────────────────────

export function techFocusedDenseTemplate(sections: {
  header: string;
  summary: string;
  experience: string;
  education: string;
  skills: string;
  projects?: string;
  certifications?: string;
  additionalSections?: string;
}): string {
  return `\\documentclass[9.5pt,a4paper]{article}
\\usepackage[margin=0.45in]{geometry}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage[hidelinks]{hyperref}
\\usepackage[T1]{fontenc}

\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlist[itemize]{leftmargin=0.15in,itemsep=0.5pt,topsep=1pt,parsep=0pt}

\\titleformat{\\section}{\\bfseries\\uppercase}{}{0em}{}[\\titlerule]
\\titlespacing{\\section}{0pt}{6pt}{2pt}

\\begin{document}

${sections.header}

${sections.summary ? `\\section{Summary}\n\\noindent ${sections.summary}\n` : ""}

${sections.education ? `\\section{Education}\n${sections.education}\n` : ""}

${sections.experience ? `\\section{Experience}\n${sections.experience}\n` : ""}

${sections.projects ? `\\section{Projects}\n${sections.projects}\n` : ""}

${sections.skills ? `\\section{Skills}\n{\\ttfamily\\small\\raggedright\\sloppy ${sections.skills}\\par}\n` : ""}

${sections.certifications ? `\\section{Achievements}\n${sections.certifications}\n` : ""}

${sections.additionalSections || ""}

\\end{document}`;
}
