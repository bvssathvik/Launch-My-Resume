// ─────────────────────────────────────────
// Minimal Clean Tech
// Single column, dark-gray (not black, not a brand color) section
// headers with a thin underline, sans-serif body, tight-but-airy
// spacing. Sits between "ultra plain" and "colored accent" templates.
// ─────────────────────────────────────────

export function minimalCleanTechTemplate(sections: {
  header: string;
  summary: string;
  experience: string;
  education: string;
  skills: string;
  projects?: string;
  certifications?: string;
  additionalSections?: string;
}): string {
  return `\\documentclass[10.5pt,a4paper]{article}
\\usepackage[margin=0.65in]{geometry}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage[hidelinks]{hyperref}
\\usepackage{xcolor}
\\usepackage[T1]{fontenc}
% NOTE: lmodern intentionally NOT used — it isn't guaranteed to be present
% on every LaTeX install (confirmed missing even in local testing), and
% \\sfdefault/\\rmdefault already resolve to Computer Modern Sans/Roman,
% which ship with base LaTeX and need no extra package.
\\renewcommand{\\familydefault}{\\sfdefault}

\\definecolor{mctgray}{HTML}{2B2B2B}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\raggedbottom

\\titleformat{\\section}{\\bfseries\\large\\color{mctgray}}{}{0em}{}[\\vspace{-5pt}{\\color{mctgray!60}\\titlerule[0.5pt]}\\vspace{3pt}]
\\titlespacing{\\section}{0pt}{11pt}{4pt}
\\setlist[itemize]{leftmargin=0.18in,itemsep=1pt,topsep=2pt}

\\begin{document}

${sections.header}

${sections.summary ? `\\section{Summary}\n\\noindent ${sections.summary}\n` : ""}

${sections.education ? `\\section{Education}\n${sections.education}\n` : ""}

${sections.experience ? `\\section{Experience}\n${sections.experience}\n` : ""}

${sections.projects ? `\\section{Projects}\n${sections.projects}\n` : ""}

${sections.skills ? `\\section{Skills}\n${sections.skills}\n` : ""}

${sections.certifications ? `\\section{Certifications}\n${sections.certifications}\n` : ""}


${sections.additionalSections || ""}

\\end{document}`;
}
