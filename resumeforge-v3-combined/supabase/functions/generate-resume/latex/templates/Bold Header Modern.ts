// ─────────────────────────────────────────
// Bold Header Modern
// Single column with the name/contact block reversed out of a solid
// navy color band (via \colorbox — no icon-font, no fontspec, stays
// pdflatex-safe). Sections below use a matching navy accent rule.
// ─────────────────────────────────────────

export function boldHeaderModernTemplate(sections: {
  header: string;
  summary: string;
  experience: string;
  education: string;
  skills: string;
  projects?: string;
  certifications?: string;
  additionalSections?: string;
}): string {
  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[margin=0.5in]{geometry}
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

\\definecolor{bhmnavy}{HTML}{14345A}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlist[itemize]{leftmargin=*,itemsep=1pt,topsep=2pt,label={\\color{bhmnavy}\\textbullet}}

\\titleformat{\\section}{\\bfseries\\color{bhmnavy}\\large}{}{0em}{}[\\titlerule]
\\titlespacing{\\section}{0pt}{8pt}{4pt}

\\begin{document}

\\noindent\\colorbox{bhmnavy}{\\parbox{\\dimexpr\\textwidth-2\\fboxsep\\relax}{\\color{white}
${sections.header}
}}
\\vspace{8pt}

${sections.summary ? `\\section{Summary}\n\\noindent ${sections.summary}\n` : ""}

${sections.education ? `\\section{Education}\n${sections.education}\n` : ""}

${sections.experience ? `\\section{Experience}\n${sections.experience}\n` : ""}

${sections.projects ? `\\section{Projects}\n${sections.projects}\n` : ""}

${sections.skills ? `\\section{Skills}\n${sections.skills}\n` : ""}

${sections.certifications ? `\\section{Achievements}\n${sections.certifications}\n` : ""}


${sections.additionalSections || ""}

\\end{document}`;
}
